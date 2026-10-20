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

// Challenges live in the webauthn_challenges table (see supabase/webauthn_challenges.sql).
// Worker isolates don't share memory, so an in-memory map loses challenges between
// begin and complete. Each challenge is single-use: complete deletes the row it reads.
const CHALLENGE_TTL_MS = 2 * 60_000;

// Only the app's own origin may call the worker from a browser.
const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin',
});

const json = (data, status = 200, env = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env) },
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
  // Store a challenge and return its row id (handed to the client as challengeId)
  async issueChallenge(kind, challenge, userId = null) {
    // Opportunistic cleanup of expired rows; failure here is harmless
    this.deleteWhere('webauthn_challenges', `expires_at=lt.${new Date().toISOString()}`).catch(() => {});
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/webauthn_challenges`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        kind,
        challenge,
        user_id: userId,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`Could not store challenge (${res.status})`);
    const [row] = await res.json();
    return row.id;
  },
  // Atomically delete and return a challenge, so it can only ever be used once.
  // Returns null if it doesn't exist, is the wrong kind, or has expired.
  async consumeChallenge(id, kind) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/webauthn_challenges?id=eq.${id}&kind=eq.${kind}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=representation',
        },
      }
    );
    if (!res.ok) return null;
    const [row] = await res.json();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
  },
  async deleteWhere(table, filter) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });
  },
  // Look up a user id by email via the admin API's filter (no full user listing)
  async findUserIdByEmail(email) {
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const users = data?.users || [];
    const target = String(email).trim().toLowerCase();
    return users.find(u => (u.email || '').toLowerCase() === target)?.id || null;
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
    // Don't log the body — it contains a live sign-in token
    const text = await res.text();
    console.log('[generateLink] status:', res.status);
    try { return JSON.parse(text); } catch { return {}; }
  },
});

const routeIs = (url, path) =>
  url.pathname === path || url.pathname === `/auth/webauthn${path}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (request.method !== 'POST') return json({ error: 'Not found' }, 404, env);

    try {
      const db = supa(env);

      // ── POST /register/begin ────────────────────────────────────────────────
      if (routeIs(url, '/register/begin')) {
        const { jwt } = await request.json();
        const user = await db.getUser(jwt);
        if (!user?.id) return json({ error: 'Unauthorized' }, 401, env);

        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: RP_ID,
          userID: new TextEncoder().encode(user.id),
          userName: user.email,
          userDisplayName: user.email,
          attestationType: 'none',
          // Existing credentials are replaced only after the new one verifies (see complete)
          excludeCredentials: [],
          authenticatorSelection: {
            authenticatorAttachment: 'platform', // Face ID / Touch ID only
            userVerification: 'required',
            residentKey: 'preferred',
          },
        });

        const challengeId = await db.issueChallenge('register', options.challenge, user.id);
        return json({ options, challengeId }, 200, env);
      }

      // ── POST /register/complete ─────────────────────────────────────────────
      if (routeIs(url, '/register/complete')) {
        const { jwt, credential, deviceName, challengeId } = await request.json();
        const user = await db.getUser(jwt);
        if (!user?.id) return json({ error: 'Unauthorized' }, 401, env);

        const stored = await db.consumeChallenge(challengeId, 'register');
        if (!stored || stored.user_id !== user.id) {
          return json({ error: 'Challenge expired - please try again' }, 400, env);
        }

        const verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge: stored.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
        });
        if (!verification.verified) {
          return json({ error: 'Verification failed' }, 400, env);
        }

        // SimpleWebAuthn v9+ uses registrationInfo.credential.{id,publicKey,counter}
        // v8 and below uses registrationInfo.{credentialID,credentialPublicKey,counter}
        const info = verification.registrationInfo;
        const credId = info?.credential?.id ?? info?.credentialID;
        const credPubKey = info?.credential?.publicKey ?? info?.credentialPublicKey;
        const credCounter = info?.credential?.counter ?? info?.counter ?? 0;
        if (!credId || !credPubKey) {
          console.log('[register] missing credential fields:', Object.keys(info || {}));
          return json({ error: 'Registration failed' }, 500, env);
        }

        // Replace any previous credentials now that the new one is verified.
        // (A passkey deleted from the device would otherwise leave a dead row behind.)
        await db.delete('webauthn_credentials', { user_id: user.id });
        await db.upsert('webauthn_credentials', {
          user_id: user.id,
          // Store both as base64url for consistency
          credential_id: typeof credId === 'string' ? credId : toBase64url(credId),
          public_key: typeof credPubKey === 'string' ? credPubKey : toBase64url(credPubKey),
          counter: credCounter,
          device_name: deviceName || 'iPhone',
        });

        return json({ verified: true }, 200, env);
      }

      // ── POST /authenticate/begin ────────────────────────────────────────────
      if (routeIs(url, '/authenticate/begin')) {
        const { email } = await request.json();
        if (!email) return json({ error: 'Email required' }, 400, env);

        // Same response whether the account doesn't exist or has no Face ID,
        // so this endpoint can't be used to discover who has an account.
        const noCredentials = () => json({ error: 'No credentials registered' }, 404, env);

        const userId = await db.findUserIdByEmail(email);
        if (!userId) return noCredentials();

        const credentials = await db.query('webauthn_credentials', { user_id: userId });
        const validCredentials = (Array.isArray(credentials) ? credentials : []).filter(c =>
          typeof c.credential_id === 'string' && c.credential_id.length > 10
        );
        if (!validCredentials.length) return noCredentials();

        const options = await generateAuthenticationOptions({
          rpID: RP_ID,
          userVerification: 'required',
        });
        // Inject allowCredentials manually as base64url strings — SimpleWebAuthn v9
        // serializes IDs as Uint8Array which becomes a plain object in JSON, breaking
        // the client's base64urlToUint8 call. Raw strings are safe across the wire.
        options.allowCredentials = validCredentials.map(c => ({
          id: c.credential_id, // already stored as base64url string
          type: 'public-key',
        }));

        const challengeId = await db.issueChallenge('authenticate', options.challenge, userId);
        return json({ options, challengeId }, 200, env);
      }

      // ── POST /authenticate/complete ─────────────────────────────────────────
      if (routeIs(url, '/authenticate/complete')) {
        const { credential, challengeId } = await request.json();

        // The challenge must be one this worker issued, unused and unexpired.
        // Never accept a challenge supplied by the client — that allows replaying
        // a previously captured Face ID assertion.
        const stored = await db.consumeChallenge(challengeId, 'authenticate');
        if (!stored) return json({ error: 'Challenge expired - please try again' }, 400, env);

        const creds = await db.query('webauthn_credentials', {
          user_id: stored.user_id,
          credential_id: credential?.id,
        });
        const cred = Array.isArray(creds) ? creds[0] : null;
        if (!cred) return json({ error: 'Credential not found' }, 404, env);

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
            expectedChallenge: stored.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
              id: cred.credential_id,
              publicKey: fromBase64url(String(cred.public_key)),
              counter: Number(cred.counter ?? 0),
            },
            requireUserVerification: true,
          });
        } catch (verifyErr) {
          console.log('[auth/complete] verify error:', verifyErr.message);
          return json({ error: 'Verification failed' }, 400, env);
        }
        if (!verifyResult.verified) {
          return json({ error: 'Verification failed' }, 400, env);
        }

        await db.update(
          'webauthn_credentials',
          { credential_id: cred.credential_id },
          { counter: verifyResult.authenticationInfo?.newCounter ?? Number(cred.counter ?? 0) }
        );

        const linkData = await db.generateLink(cred.user_id);
        const hashedToken = linkData?.properties?.hashed_token || linkData?.hashed_token;
        if (!hashedToken) return json({ error: 'Failed to create session' }, 500, env);

        return json({ verified: true, token: hashedToken, type: 'magiclink' }, 200, env);
      }

      return json({ error: 'Not found' }, 404, env);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error' }, 500, env);
    }
  },
};
