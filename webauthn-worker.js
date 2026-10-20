/**
 * Forknight WebAuthn Cloudflare Worker
 * Deploy: wrangler deploy webauthn-worker.js --name forknight-webauthn
 *
 * Environment variables to set in wrangler.toml or Cloudflare dashboard:
 *   SUPABASE_URL       = https://cekgmugupbbmehpeoqnp.supabase.co
 *   SUPABASE_SERVICE_KEY = your service role key (not anon key)
 *   ALLOWED_ORIGIN     = https://forknight.app
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';


// Web Crypto compatible base64url helpers (no Buffer needed in CF Workers)
function toBase64url(uint8arr) {
  return btoa(Array.from(uint8arr, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function fromBase64url(input) {
  const str = String(input);
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  return Uint8Array.from(atob(b64 + '='.repeat(pad)), c => c.charCodeAt(0));
}
function toBase64(uint8arr) {
  return btoa(Array.from(uint8arr, b => String.fromCharCode(b)).join(''));
}
function fromBase64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

const RP_ID = 'forknight.app';
const RP_NAME = 'Forknight';
const ORIGIN = 'https://forknight.app';

// In-memory challenge store — Cloudflare Workers KV would be better for prod
// but challenges are short-lived (60s) so memory is fine for low traffic
const challenges = new Map();

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

const json = (data, status = 200, origin) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });

// Supabase helpers using service role (bypasses RLS)
const supa = (env) => ({
  async query(table, filters = {}) {
      const params = new URLSearchParams(
        Object.entries(filters).map(([k, v]) => [k, `eq.${v}`])
      );
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/${table}?${params}`,
        {
          headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            Accept: 'application/json',
          },
        }
      );
      return res.json();
    },
  async upsert(table, data) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(data),
    });
  },
  async update(table, match, data) {
    const params = new URLSearchParams(
      Object.entries(match).map(([k, v]) => [k, `eq.${v}`])
    );
    return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  },
  async delete(table, match) {
    const params = new URLSearchParams(
      Object.entries(match).map(([k, v]) => [k, `eq.${v}`])
    );
    return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  },
  // Verify a user's JWT and return their user_id
  async getUser(jwt) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!res.ok) return null;
    return res.json();
  },
  // Mint a short-lived magic link session for a user (used after WebAuthn verify)
  async generateLink(userId) {
    // Correct Supabase admin API: generate a magic link OTP for a user by ID
    // First get the user's email, then generate OTP
    const userRes = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const userText = await userRes.text();
    let email;
    try { email = JSON.parse(userText).email; } catch {}
    if (!email) { console.log('[generateLink] could not get email for userId:', userId); return {}; }

    // Generate magic link using the correct endpoint
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/generate_link`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'magiclink', email }),
      }
    );
    const text = await res.text();
    console.log('[generateLink] status:', res.status, 'body:', text.slice(0, 300));
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 100) }; }
  },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      // ── POST /register/begin ────────────────────────────────────────────────
      if ((url.pathname === '/register/begin' || url.pathname === '/auth/webauthn/register/begin') && request.method === 'POST') {
        const { jwt } = await request.json();
        const db = supa(env);
        const user = await db.getUser(jwt);
        if (!user?.id) return json({ error: 'Unauthorized' }, 401, origin);

        // Delete any existing credentials for this user so re-enrollment works cleanly.
        // If a passkey was deleted from the device, the DB row would block registration.
        const existing = await db.query('webauthn_credentials', { user_id: user.id });
        if (existing?.length) {
          console.log('[register/begin] deleting', existing.length, 'existing credential(s) for re-enrollment');
          for (const c of existing) {
            await db.delete('webauthn_credentials', { credential_id: c.credential_id });
          }
        }

        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: RP_ID,
          userID: new TextEncoder().encode(user.id),
          userName: user.email,
          userDisplayName: user.email,
          attestationType: 'none',
          excludeCredentials: [], // cleared above, no exclusions needed
          authenticatorSelection: {
            authenticatorAttachment: 'platform', // Face ID / Touch ID only
            userVerification: 'required',
            residentKey: 'preferred',
          },
        });

        // Store challenge for 60s
        challenges.set(user.id, {
          challenge: options.challenge,
          expires: Date.now() + 60_000,
        });

        return json({ options }, 200, origin);
      }

      // ── POST /register/complete ─────────────────────────────────────────────
      if ((url.pathname === '/register/complete' || url.pathname === '/auth/webauthn/register/complete') && request.method === 'POST') {
        const { jwt, credential, deviceName } = await request.json();
        const db = supa(env);
        const user = await db.getUser(jwt);
        if (!user?.id) return json({ error: 'Unauthorized' }, 401, origin);

        const stored = challenges.get(user.id);
        if (!stored || Date.now() > stored.expires) {
          return json({ error: 'Challenge expired' }, 400, origin);
        }
        challenges.delete(user.id);

        const verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge: stored.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
        });

        if (!verification.verified) {
          return json({ error: 'Verification failed' }, 400, origin);
        }

        // SimpleWebAuthn v9+ uses registrationInfo.credential.{id,publicKey,counter}
        // v8 and below uses registrationInfo.{credentialID,credentialPublicKey,counter}
        const info = verification.registrationInfo;
        console.log('[register] registrationInfo keys:', Object.keys(info || {}));

        const credId = info?.credential?.id ?? info?.credentialID;
        const credPubKey = info?.credential?.publicKey ?? info?.credentialPublicKey;
        const credCounter = info?.credential?.counter ?? info?.counter ?? 0;

        console.log('[register] credId type:', typeof credId, 'length:', credId?.length);
        console.log('[register] credPubKey type:', typeof credPubKey, 'length:', credPubKey?.length);

        if (!credId || !credPubKey) {
          return json({ error: `Missing credential fields. Keys: ${Object.keys(info || {}).join(',')}` }, 500, origin);
        }

        await db.upsert('webauthn_credentials', {
          user_id: user.id,
          // Store both as base64url for consistency
          credential_id: typeof credId === 'string' ? credId : toBase64url(credId),
          public_key: typeof credPubKey === 'string' ? credPubKey : toBase64url(credPubKey),
          counter: credCounter,
          device_name: deviceName || 'iPhone',
        });

        return json({ verified: true }, 200, origin);
      }

      // ── POST /authenticate/begin ────────────────────────────────────────────
      if ((url.pathname === '/authenticate/begin' || url.pathname === '/auth/webauthn/authenticate/begin') && request.method === 'POST') {
        const { email } = await request.json();
        const db = supa(env);

        let userId = null;
        let credentials = [];

        if (email) {
          // Look up user by email — Supabase admin API
          const userRes = await fetch(
            `${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
            {
              headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              },
            }
          );
          const userData = await userRes.json();
          console.log('[auth/begin] userRes status:', userRes.status, 'total users:', userData?.users?.length || userData?.total);
          const allUsers = userData?.users || userData?.data?.users || [];
          const foundUser = allUsers.find(u => u.email === email);
          userId = foundUser?.id;
          console.log('[auth/begin] email:', email, 'userId:', userId);
          if (!userId) return json({ error: 'User not found', debug: { status: userRes.status, userCount: allUsers.length, sampleEmails: allUsers.slice(0,3).map(u=>u.email) } }, 404, origin);

          credentials = await db.query('webauthn_credentials', { user_id: userId });
          console.log('[auth/begin] credentials found:', credentials?.length, JSON.stringify(credentials?.map(c=>c.credential_id)));
          if (!credentials?.length) {
            return json({ error: 'No credentials registered' }, 404, origin);
          }
        } else {
          // No email — discoverable credential flow: browser presents any passkey for this RP
          // userId resolved from userHandle in authenticate/complete
          console.log('[auth/begin] no email — discoverable credential flow');
        }

        console.log('[auth/begin] credentials found:', credentials?.length, 'sample id type:', typeof credentials?.[0]?.credential_id, 'value:', String(credentials?.[0]?.credential_id).slice(0,30));

        const validCredentials = (credentials || []).filter(c => {
          const id = c.credential_id;
          return id && typeof id === 'string' && id.length > 10;
        });

        if (!validCredentials.length) {
          return json({ error: 'No valid credentials', debug: { raw: credentials?.map(c=>({id:c.credential_id,type:typeof c.credential_id,len:String(c.credential_id).length})) } }, 404, origin);
        }

        const options = await generateAuthenticationOptions({
          rpID: RP_ID,
          userVerification: 'required',
        });

        // Inject allowCredentials manually as base64url strings — SimpleWebAuthn v9
        // serializes IDs as Uint8Array which becomes a plain object in JSON, breaking
        // the client's base64urlToUint8 call. Raw strings are safe across the wire.
        if (credentials.length) {
          options.allowCredentials = credentials.map(c => ({
            id: c.credential_id, // already stored as base64url string
            type: 'public-key',
          }));
        }
        console.log('[auth/begin] allowCredentials count:', options.allowCredentials?.length || 0);

        // Store challenge server-side — keyed by email if known, else discoverable key
        const challengeKey = email ? `auth_${email}` : 'auth_discoverable';
        challenges.set(challengeKey, {
          challenge: options.challenge,
          userId,
          expires: Date.now() + 60_000,
        });

        return json({ options, userId, email }, 200, origin);
      }

      // ── POST /debug/cdj ── temporary debug endpoint ───────────────────────
      if ((url.pathname === '/debug/cdj' || url.pathname === '/auth/webauthn/debug/cdj') && request.method === 'POST') {
        const { clientDataJSON, authenticatorData, signature } = await request.json();
        const tryDecode = (field, val) => {
          if (!val) return { error: 'missing' };
          try {
            const b64 = val.replace(/-/g, '+').replace(/_/g, '/');
            const pad = (4 - b64.length % 4) % 4;
            const bytes = atob(b64 + '='.repeat(pad));
            return { length: val.length, decodedBytes: bytes.length, first10hex: [...bytes.slice(0,10)].map(c=>c.charCodeAt(0).toString(16)).join('') };
          } catch(e) { return { error: e.message, raw: val.slice(0,30) }; }
        };
        return json({
          clientDataJSON: tryDecode('clientDataJSON', clientDataJSON),
          authenticatorData: tryDecode('authenticatorData', authenticatorData),
          signature: tryDecode('signature', signature),
        }, 200, origin);
      }

      // ── POST /authenticate/complete ─────────────────────────────────────────
      if ((url.pathname === '/authenticate/complete' || url.pathname === '/auth/webauthn/authenticate/complete') && request.method === 'POST') {
        const { email, credential, userId: clientUserId, challenge: clientChallenge } = await request.json();
        const db = supa(env);

        const stored = challenges.get(`auth_${email}`) || challenges.get('auth_discoverable');
        const userId = stored?.userId || clientUserId || credential.response?.userHandle || null;
        const challenge = stored?.challenge || clientChallenge;

        if (!challenge) {
          return json({ error: 'Challenge missing - please try again' }, 400, origin);
        }
        if (stored) { challenges.delete(`auth_${email}`); challenges.delete('auth_discoverable'); }

        // Find credential by ID — if no userId, search across all credentials
        let allCreds = [];
        if (userId) {
          const raw = await db.query('webauthn_credentials', { user_id: userId });
          allCreds = Array.isArray(raw) ? raw : [];
        }
        // If not found by userId, fall back to searching by credential_id directly
        if (!allCreds.find(c => c.credential_id === credential.id)) {
          console.log('[auth/complete] credential not found by userId, searching by credential_id');
          const byId = await db.query('webauthn_credentials', { credential_id: credential.id });
          if (Array.isArray(byId) && byId.length) allCreds = byId;
        }
        const cred = allCreds.find(c => c.credential_id === credential.id) || allCreds[0];
        if (!cred) return json({ error: 'Credential not found', debug: { credentialId: credential.id, userId, found: allCreds?.length } }, 404, origin);

        console.log('[auth/complete] cred found, id length:', cred.credential_id?.length, 'pubkey length:', cred.public_key?.length);

        // Debug: try to decode the stored public key
        try {
          const pkBytes = fromBase64url(String(cred.public_key));
          console.log('[auth/complete] pubkey decoded bytes:', pkBytes.length, 'first4hex:', [...pkBytes.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join(''));
        } catch(e) {
          console.log('[auth/complete] pubkey decode failed:', e.message);
          return json({ error: 'Public key decode failed: ' + e.message }, 500, origin);
        }

        // SimpleWebAuthn v9 expects expectedChallenge as the raw base64url string
        // but some versions want Uint8Array — try string first
        // SimpleWebAuthn may need base64url with padding restored
        const addPad = (s) => { const p = (4 - s.length % 4) % 4; return s + '='.repeat(p); };

        // Decode clientDataJSON to confirm it parses correctly before verification
        let cdj = null;
        try {
          const padded = addPad(credential.response.clientDataJSON).replace(/-/g,'+').replace(/_/g,'/');
          cdj = JSON.parse(atob(padded));
          console.log('[auth/complete] clientDataJSON type:', cdj.type, 'origin:', cdj.origin, 'challengeStart:', cdj.challenge?.slice(0,20));
          console.log('[auth/complete] expectedChallenge start:', String(challenge).slice(0,20));
        } catch(e) {
          console.log('[auth/complete] clientDataJSON decode failed:', e.message);
          // Return the raw value so we can debug
          return json({ error: 'clientDataJSON decode failed: ' + e.message, raw: credential.response.clientDataJSON?.slice(0,100) }, 500, origin);
        }

        // Verify using SimpleWebAuthn — handles CBOR, DER sig, counter checks
        let verifyResult;
        try {
          verifyResult = await verifyAuthenticationResponse({
            response: {
              id: credential.id,
              rawId: credential.id,
              type: 'public-key',
              response: {
                clientDataJSON: credential.response.clientDataJSON,
                authenticatorData: credential.response.authenticatorData,
                signature: credential.response.signature,
                userHandle: credential.response.userHandle || null,
              },
            },
            expectedChallenge: String(challenge),
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
              id: cred.credential_id,
              publicKey: fromBase64url(String(cred.public_key)),
              counter: Number(cred.counter ?? 0),
            },
            requireUserVerification: true,
          });
          console.log('[auth/complete] verifyAuthenticationResponse:', verifyResult.verified);
        } catch(verifyErr) {
          console.log('[auth/complete] verify error:', verifyErr.message);
          return json({ error: 'Verification error: ' + verifyErr.message }, 500, origin);
        }

        if (!verifyResult.verified) {
          return json({ error: 'Verification failed' }, 400, origin);
        }
        await db.update(
          'webauthn_credentials',
          { credential_id: cred.credential_id },
          { counter: verifyResult.authenticationInfo?.newCounter ?? Number(cred.counter ?? 0) }
        );

        // Generate a magic link token — use cred.user_id (authoritative from DB)
        // userId from the challenge map may be null for discoverable credential flow
        const resolvedUserId = cred.user_id || userId;
        console.log('[auth/complete] generating link for resolvedUserId:', resolvedUserId, '(cred.user_id:', cred.user_id, 'challenge userId:', userId, ')');
        const linkData = await db.generateLink(resolvedUserId);
        console.log('[auth/complete] generateLink response keys:', Object.keys(linkData||{}));
        const hashedToken = linkData?.properties?.hashed_token || linkData?.hashed_token;
        if (!hashedToken) {
          return json({ error: 'Failed to create session', debug: { linkKeys: Object.keys(linkData||{}) } }, 500, origin);
        }

        return json(
          {
            verified: true,
            token: hashedToken,
            type: 'magiclink',
          },
          200,
          origin
        );
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500, origin);
    }
  },
};
