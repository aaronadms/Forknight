import { useState, useRef, useEffect } from "react";
import { Beef, Bird, Fish, Leaf, Utensils, Check, ChevronLeft, ArrowRight, RefreshCw, Eye, EyeOff, Share2, Ham, MailOpen, User, Users, Egg, Home } from "lucide-react";
import { supabase } from "./supabaseClient.js";

// ── Face ID / WebAuthn ────────────────────────────────────────────────────────
const WEBAUTHN_URL = "https://forknight.app/auth/webauthn";
const FACEID_KEY = "forknight_faceid_email"; // stores email of registered user

const isFaceIdAvailable = () => {
  try {
    return window.PublicKeyCredential !== undefined &&
      typeof window.PublicKeyCredential === 'function';
  } catch { return false; }
};

const isFaceIdRegistered = (email) => {
  try { return localStorage.getItem(FACEID_KEY) === email; } catch { return false; }
};

const setFaceIdRegistered = (email) => {
  try { localStorage.setItem(FACEID_KEY, email); } catch {}
};

// Convert base64url ↔ Uint8Array (required by WebAuthn API)
const base64urlToUint8 = (b64) => {
  const b = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), c => c.charCodeAt(0));
};
const uint8ToBase64url = (arr) => {
  const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const attemptFaceIdSignIn = async (email) => {
  try {
    // 1. Get challenge from worker
    const beginRes = await fetch(`${WEBAUTHN_URL}/authenticate/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const beginText = await beginRes.text();
    console.log("[WebAuthn] begin response:", beginRes.status);
    if (!beginRes.ok) {
      const body = JSON.parse(beginText);
      const reason = (body?.error?.includes("No credentials") || body?.error?.includes("User not found")) ? "no_credentials" : "server_error";
      return { success: false, reason };
    }
    const { options, challengeId } = JSON.parse(beginText);

    // 2. Browser prompts Face ID
    options.challenge = base64urlToUint8(options.challenge);
    options.allowCredentials = (options.allowCredentials || []).map(c => ({
      ...c, id: base64urlToUint8(c.id),
    }));
    const assertion = await navigator.credentials.get({ publicKey: options });

    // 3. Send assertion to worker, referencing the challenge it issued
    const completeRes = await fetch(`${WEBAUTHN_URL}/authenticate/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        credential: {
          id: assertion.id,
          rawId: uint8ToBase64url(new Uint8Array(assertion.rawId)),
          type: assertion.type,
          response: {
            authenticatorData: uint8ToBase64url(new Uint8Array(assertion.response.authenticatorData)),
            clientDataJSON: uint8ToBase64url(new Uint8Array(assertion.response.clientDataJSON)),
            signature: uint8ToBase64url(new Uint8Array(assertion.response.signature)),
            userHandle: assertion.response.userHandle
              ? uint8ToBase64url(new Uint8Array(assertion.response.userHandle))
              : null,
          },
        },
      }),
    });
    const completeText = await completeRes.text();
    console.log('[WebAuthn] complete response:', completeRes.status, completeText.slice(0, 300));
    if (!completeRes.ok) return { success: false, reason: 'complete_failed' };
    const { verified, token, type } = JSON.parse(completeText);
    if (!verified) return { success: false };

    // 4. Exchange token for Supabase session
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'magiclink',
    });
    if (error || !data?.session) return { success: false };
    return { success: true, session: data.session };
  } catch (err) {
    console.log('[FaceID] attempt failed:', err.name, err.message);
    return { success: false };
  }
};

const registerFaceId = async (jwt, email) => {
  try {
    // 1. Begin registration
    const beginRes = await fetch(`${WEBAUTHN_URL}/register/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt }),
    });
    const beginText = await beginRes.text();
    console.log("[WebAuthn] register/begin response:", beginRes.status);
    if (!beginRes.ok) return false;
    const { options, challengeId } = JSON.parse(beginText);

    // 2. Browser prompts Face ID enrollment
    options.challenge = base64urlToUint8(options.challenge);
    options.user.id = base64urlToUint8(options.user.id);
    // Filter to algorithms Safari supports (remove Ed25519 -8 which Safari rejects)
    options.pubKeyCredParams = (options.pubKeyCredParams || []).filter(p => p.alg !== -8);
    console.log('[WebAuthn] calling credentials.create, challenge length:', options.challenge?.length, 'user.id length:', options.user.id?.length, 'algos:', options.pubKeyCredParams?.map(p=>p.alg));
    let credential;
    try {
      credential = await navigator.credentials.create({ publicKey: options });
    } catch(err) {
      console.log('[WebAuthn] credentials.create failed:', err.name, err.message);
      throw err;
    }

    // 3. Send to worker
    const completeRes = await fetch(`${WEBAUTHN_URL}/register/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jwt,
        challengeId,
        deviceName: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Device',
        credential: {
          id: credential.id,
          rawId: uint8ToBase64url(new Uint8Array(credential.rawId)),
          type: credential.type,
          response: {
            attestationObject: uint8ToBase64url(new Uint8Array(credential.response.attestationObject)),
            clientDataJSON: uint8ToBase64url(new Uint8Array(credential.response.clientDataJSON)),
          },
        },
      }),
    });
    const completeText = await completeRes.text();
    console.log("[WebAuthn] register complete:", completeRes.status, completeText.slice(0,200));
    if (!completeRes.ok) return false;
    const { verified } = JSON.parse(completeText);
    console.log("[WebAuthn] verified:", verified);
    if (verified) setFaceIdRegistered(email);
    return verified;
  } catch (err) {
    console.log('[FaceID] registration failed:', err.message);
    return false;
  }
};

// ── Design tokens (match main app) ───────────────────────────────────────────
const THEMES_AUTH = {
  light:{ bg:"#F5F5F0", card:"#FFFFFF", cardAlt:"#F8F8F3", border:"#E2E2DC", text:"#1A1A1A", textSub:"#555555", muted:"#888", mutedBg:"#D0D0C8", accent:"#FF6B35", accentTint:"#FFF0EB", errorTint:"#FFF5F5", green:"#4A7A4A", star:"#C9A84C", subtle:"#EEEEE8", cancelBtn:"#E8E8E0", overlay:"rgba(0,0,0,0.45)" },
  dark: { bg:"#0D0D0B", card:"#1A1A18", cardAlt:"#222220", border:"#2C2C2A", text:"#E8E8E2", textSub:"#9A9A94", muted:"#606060", mutedBg:"#2E2E2C", accent:"#FF6B35", accentTint:"#2A1608", errorTint:"#200A0A", green:"#5FAA5F", star:"#C9A84C", subtle:"#222220", cancelBtn:"#2A2A28", overlay:"rgba(0,0,0,0.72)" },
};
function getAuthC(){
  const stored=localStorage.getItem("forknight_theme")||"system";
  const eff=stored==="system"?(window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light"):stored;
  return THEMES_AUTH[eff]||THEMES_AUTH.light;
}
// C is read once at module load; ForknightAuth re-mounts fresh so this is fine
const C=getAuthC();
// Apply background immediately at module load — before any React renders
// This prevents the white flash when transitioning between auth screens
if (typeof document !== "undefined") {
  document.documentElement.style.background = C.bg;
  document.body.style.background = C.bg;
}

const PROTEINS = [
  { id:"beef",         label:"Beef",         Icon: Beef   },
  { id:"chicken",      label:"Chicken",      Icon: Bird   },
  { id:"seafood",      label:"Seafood",      Icon: Fish   },
  { id:"pork",         label:"Pork",         Icon: Ham    },
  { id:"plant-based",  label:"Meatless",     Icon: Leaf   },
  { id:"breakfast",    label:"Breakfast",    Icon: Egg    },
];

// ── Shared components ─────────────────────────────────────────────────────────

function Logo({ size = 36 }) {
  return (
    <div style={{
      fontFamily:"'Playfair Display', Georgia, serif",
      fontSize: size,
      fontWeight: 600,
      color: C.text,
      letterSpacing: "-0.5px",
      lineHeight: 1,
    }}>
      Forknight
      <sup style={{
        fontSize: "0.22em",
        fontWeight: 400,
        verticalAlign: "super",
        position: "relative",
        top: "-6px",
        letterSpacing: 0,
      }}>®</sup>
    </div>
  );
}

function Screen({ children, centered = false }) {
  // Prevent white flash in dark mode by setting html/body bg immediately
  if (typeof document !== "undefined") {
    document.documentElement.style.background = C.bg;
    document.body.style.background = C.bg;
    // Inject global keyframes if not already present
    if (!document.getElementById("fk-keyframes")) {
      const s = document.createElement("style");
      s.id = "fk-keyframes";
      s.textContent = "@keyframes houseWiggle{0%,85%,100%{transform:rotate(0deg)}88%{transform:rotate(-10deg)}91%{transform:rotate(10deg)}94%{transform:rotate(-6deg)}97%{transform:rotate(6deg)}}";
      document.head.appendChild(s);
    }
  }
  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, sans-serif",
      background: C.bg,
      minHeight: "100dvh",
      maxWidth: 480,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      padding: "0 24px",
      boxSizing: "border-box",
      justifyContent: centered ? "center" : "flex-start",
      position: "relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet"/>
      <style>{`
        input::placeholder { color: ${C.muted}; opacity: 1; }
        input { color-scheme: ${C.bg === '#0D0D0B' ? 'dark' : 'light'}; }
      `}</style>
      {children}
    </div>
  );
}

function PrimaryButton({ label, onClick, disabled = false, icon }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "17px",
        borderRadius: 14,
        border: "none",
        background: disabled ? C.mutedBg : C.text,
        color: C.bg,  // contrast: bg is dark in dark mode, text is light
        fontSize: 16,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background 0.2s",
        minHeight: 54,
      }}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

function SecondaryButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "17px",
        borderRadius: 14,
        border: `1.5px solid ${C.border}`,
        background: C.card,
        color: C.text,
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
        minHeight: 54,
      }}
    >
      {label}
    </button>
  );
}

function BackButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        top: 16,
        left: 18,
        background: "none",
        border: "none",
        cursor: "pointer",
        color: C.muted,
        padding: "4px 0",
        display: "flex",
        alignItems: "center",
        zIndex: 1,
      }}
    >
      <ChevronLeft size={26} strokeWidth={2}/>
    </button>
  );
}

function StepDots({ total, current }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 7,
          height: 7,
          borderRadius: 4,
          background: i === current ? C.accent : C.border,
          transition: "width 0.3s ease, background 0.3s ease",
        }}/>
      ))}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", autoFocus = false, onKeyDown }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      autoCapitalize={type === "email" ? "none" : "words"}
      autoCorrect="off"
      style={{
        width: "100%",
        padding: "15px 16px",
        borderRadius: 12,
        border: `1.5px solid ${C.border}`,
        background: C.cardAlt,
        fontSize: 16,
        color: C.text,
        caretColor: C.accent,
        outline: "none",
        boxSizing: "border-box",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    />
  );
}

// ── Passcode boxes (reused for verification) ──────────────────────────────────
function PasscodeBoxes({ digits, err, shake, active = true }) {
  return (
    <>
      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%,60%{transform:translateX(-8px)}
          40%,80%{transform:translateX(8px)}
        }
        @keyframes blink {
          0%,100%{opacity:1}
          50%{opacity:0}
        }
        .blink { animation: blink 1s ease infinite; }
      `}</style>
      <div style={{
        display: "flex",
        gap: 14,
        animation: shake ? "shake 0.4s ease" : "none",
        justifyContent: "center",
      }}>
        {digits.map((d, i) => {
          const filled = digits.filter(Boolean).length;
          const isActive = i === filled && active;
          return (
            <div key={i} style={{
              width: 62,
              height: 74,
              borderRadius: 16,
              border: `2px solid ${err ? "#E05050" : isActive ? C.accent : d ? C.text : C.border}`,
              background: err ? C.errorTint : C.card,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              color: C.text,
              transition: "border-color 0.15s",
              boxShadow: isActive ? `0 0 0 3px ${C.accent}22` : "none",
            }}>
              {d ? "●" : isActive ? <span className="blink" style={{ display:"inline-block", width:2, height:32, background:C.accent, borderRadius:1 }}/> : ""}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Screen 1: Landing ─────────────────────────────────────────────────────────

// ── Onboarding progress dots ──────────────────────────────────────────────────
const ONBOARDING_SCREENS=["create-account","join-or-create","onboard-proteins","onboard-size","invite"];
function OnboardingDots({ screen }) {
  const idx = ONBOARDING_SCREENS.indexOf(screen);
  if (idx < 0) return null;
  return (
    <div style={{ display:"flex", justifyContent:"center", gap:6, paddingBottom:18 }}>
      {ONBOARDING_SCREENS.map((_,i) => (
        <div key={i} style={{
          width: i === idx ? 20 : 6, height: 6, borderRadius: 3,
          background: i === idx ? C.accent : C.mutedBg,
          transition: "all 0.25s ease",
        }}/>
      ))}
    </div>
  );
}

function TosModal({ onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:200 }}/>
      <div style={{
        position:"fixed",left:"50%",top:"50%",transform:"translate(-50%,-50%)",
        width:"min(90vw,480px)",maxHeight:"80dvh",overflowY:"auto",
        background:C.card,borderRadius:20,padding:"28px 24px",zIndex:201,
        boxShadow:"0 8px 40px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontFamily:"'Playfair Display',Georgia,serif",fontSize:20,fontWeight:600,color:C.text,marginBottom:6 }}>
          Terms of Service & Privacy Policy
        </div>
        <div style={{ fontSize:11,color:C.muted,marginBottom:20 }}>Effective: 2026 · Forknight</div>

        {[
          ["Your Data", "Your meal plans, household membership, and profile information are stored securely using industry-standard encryption at rest and in transit via Supabase. We do not sell or share your personal data with third parties for advertising purposes. However, we take no responsibility for data lost, stolen, or compromised as a result of circumstances outside our direct control, including but not limited to third-party service outages, unauthorized access, or user error."],
          ["Account Access", "Forknight accounts are household-based. Any member of a household may view the shared meal plan. Household administrators may remove any member at any time. Forknight reserves the right to suspend or permanently terminate any account or household at any time, for any reason, at our sole discretion, without prior notice or liability."],
          ["Meals & Food Safety", "All recipes, ingredient lists, nutritional information, and cooking instructions provided in Forknight are for general informational purposes only. By using this service you acknowledge that you prepare and consume all meals entirely at your own risk. Look - we don't want to be the people writing legal disclaimers about pasta. But some people will eat something they're allergic to and look for someone to blame, and unfortunately that someone might be us. So: Forknight accepts no responsibility for injury, illness, allergic reactions, property damage, or any other harm arising from incorrect information, typographical errors, ingredient substitutions, or user error in preparation. If you have a serious food allergy, please check the ingredients yourself - every time, no exceptions. When in doubt, consult a qualified culinary or medical professional. We genuinely just want you to have a nice dinner."],
          ["Limitation of Liability", "Forknight is provided 'as is' without warranty of any kind, express or implied. To the maximum extent permitted by applicable law, Forknight and its creators shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the service."],
          ["Changes", "We may update these terms at any time. Continued use of Forknight after changes constitutes acceptance of the revised terms."],
        ].map(([title, body]) => (
          <div key={title} style={{ marginBottom:16 }}>
            <div style={{ fontSize:13,fontWeight:700,color:C.text,marginBottom:4 }}>{title}</div>
            <div style={{ fontSize:12,color:C.textSub,lineHeight:1.7 }}>{body}</div>
          </div>
        ))}

        <button onClick={onClose} style={{
          marginTop:8,width:"100%",padding:"14px",borderRadius:12,border:"none",
          background:C.accent,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",
        }}>
          Got it
        </button>
      </div>
    </>
  );
}


// ── Face ID enrollment prompt ─────────────────────────────────────────────────
function FaceIdPrompt({ session, onDone }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleEnable = async () => {
    console.log("[FaceID] Enable tapped, session:", session?.user?.email, "jwt length:", session?.access_token?.length);
    setLoading(true);
    try {
      const ok = await registerFaceId(session.access_token, session.user.email);
      console.log("[FaceID] registerFaceId result:", ok);
      setLoading(false);
      if (ok) setDone(true);
      setTimeout(onDone, done ? 1200 : 0);
    } catch(e) {
      console.error("[FaceID] registerFaceId threw:", e.message);
      setLoading(false);
      setTimeout(onDone, 0);
    }
  };

  return (
    <Screen>
      <div style={{ paddingTop: "20dvh", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ display:"flex", justifyContent:"center" }}><FaceIdIcon size={64} color={C.text}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.4px" }}>
          {done ? "Face ID enabled!" : "Enable Face ID"}
        </h1>
        <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, maxWidth: 280, margin: 0 }}>
          {done
            ? "Next time you visit, you'll sign in instantly."
            : "Skip the email next time. One look and you're in."}
        </p>
        {!done && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 8 }}>
            <PrimaryButton
              label={loading ? "Setting up…" : "Enable Face ID"}
              onClick={handleEnable}
              disabled={loading}
            />
            <SecondaryButton label="Not now" onClick={onDone}/>
          </div>
        )}
        {done && (
          <div style={{ fontSize: 40 }}>✓</div>
        )}
      </div>
    </Screen>
  );
}


// Face ID icon — matches Apple's Face ID symbol precisely
function FaceIdIcon({ size = 24, color = "#3C3C3C" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Corner brackets — rounded L-shapes */}
      <path d="M22 8 L13 8 Q8 8 8 13 L8 22" stroke={color} strokeWidth="7" strokeLinecap="round" fill="none"/>
      <path d="M78 8 L87 8 Q92 8 92 13 L92 22" stroke={color} strokeWidth="7" strokeLinecap="round" fill="none"/>
      <path d="M8 78 L8 87 Q8 92 13 92 L22 92" stroke={color} strokeWidth="7" strokeLinecap="round" fill="none"/>
      <path d="M92 78 L92 87 Q92 92 87 92 L78 92" stroke={color} strokeWidth="7" strokeLinecap="round" fill="none"/>
      {/* Left eye */}
      <line x1="34" y1="36" x2="34" y2="47" stroke={color} strokeWidth="6.5" strokeLinecap="round"/>
      {/* Right eye */}
      <line x1="66" y1="36" x2="66" y2="47" stroke={color} strokeWidth="6.5" strokeLinecap="round"/>
      {/* Nose bridge — vertical line down then short horizontal */}
      <path d="M50 44 L50 58" stroke={color} strokeWidth="6" strokeLinecap="round"/>
      {/* Nose flare */}
      <path d="M44 64 Q50 68 56 64" stroke={color} strokeWidth="5.5" strokeLinecap="round" fill="none"/>
      {/* Mouth / smile */}
      <path d="M34 74 Q42 83 50 83 Q58 83 66 74" stroke={color} strokeWidth="6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

function LandingScreen({ onSignUp, onSignIn }) {
  const [showTos, setShowTos] = useState(false);
  return (
    <Screen centered>
      {showTos && <TosModal onClose={() => setShowTos(false)}/>}
      {/* Wordmark block */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <Logo size={42}/>
      </div>
      <p style={{
        textAlign: "center",
        fontSize: 15,
        color: C.muted,
        lineHeight: 1.6,
        marginBottom: 48,
        marginTop: 10,
      }}>
        Plan together. Eat together.
      </p>

      {/* CTAs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PrimaryButton label="Create an account" onClick={onSignUp}/>
        <SecondaryButton label="Sign in" onClick={onSignIn}/>
      </div>


      <p style={{
        textAlign: "center",
        fontSize: 11,
        color: C.muted,
        marginTop: 28,
        lineHeight: 1.6,
      }}>
        By continuing you agree to our{" "}
        <button onClick={() => setShowTos(true)} style={{
          background:"none",border:"none",cursor:"pointer",
          fontSize:11,color:C.accent,textDecoration:"underline",padding:0,
        }}>
          Terms of Service &amp; Privacy Policy
        </button>
      </p>
    </Screen>
  );
}


// ── Resend magic link button ──────────────────────────────────────────────────
function ResendButton({ email, onResend }) {
  const [state, setState] = useState("idle");
  const [countdown, setCountdown] = useState(0);
  const handleResend = async () => {
    if (state === "sending" || countdown > 0) return;
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: "https://forknight.app", shouldCreateUser: true },
    });
    if (error) {
      setState("error");
      // Don't auto-clear — let the user see it, button stays visible
      return;
    }
    setState("sent");
    let t = 30; setCountdown(t);
    const iv = setInterval(() => { t--; setCountdown(t); if (t <= 0) { clearInterval(iv); setState("idle"); } }, 1000);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, width:"100%" }}>
      <button onClick={handleResend}
        disabled={state === "sending" || countdown > 0}
        style={{
          width:"100%",
          background:"none", border:`1.5px solid ${state==="sent"?C.green:C.border}`, borderRadius:10,
          cursor: (countdown > 0 || state==="sending") ? "default" : "pointer", fontSize:13,
          color: countdown > 0 ? C.muted : state==="sent" ? C.green : C.accent,
          fontWeight:600, padding:"12px 20px",
          opacity: (countdown > 0 || state==="sending") ? 0.6 : 1,
          transition:"all 0.2s",
        }}>
        {state === "sending" ? "Sending..." :
         state === "sent" ? `Sent - check your inbox` :
         countdown > 0 ? `Resend in ${countdown}s` :
         "Resend magic link"}
      </button>
      {state === "error" && (
        <p style={{ fontSize:12, color:"#E05050", fontWeight:600, margin:0, textAlign:"center" }}>
          Please wait a moment and try again.
        </p>
      )}
    </div>
  );
}

// ── Screen 2: Email entry (sign up + sign in both use magic link) ─────────────
function SignUpEmailScreen({ onBack, onNext }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async () => {
    if (!isValid || loading) return;
    setLoading(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: "https://forknight.app",
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  };

  if (sent) {
    return (
      <Screen>
        <div style={{ paddingTop: "12dvh", textAlign: "center", display:"flex", flexDirection:"column", alignItems:"center" }}>
          <Logo size={36}/>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: C.text, margin: "24px 0 10px", letterSpacing: "-0.4px" }}>
            Check your email
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.7, marginBottom: 4 }}>
            We sent a magic link to
          </p>
          <p style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 36, userSelect:"none", WebkitUserSelect:"none" }}>{email}</p>

          <div style={{ width:"100%", marginBottom: 32 }}>
            <ResendButton email={email} onResend={handleSubmit}/>
          </div>

          <div style={{
            display:"flex", alignItems:"center", gap: 10,
            fontSize: 12, color: C.muted, lineHeight: 1.6,
            background: C.bg==="0D0D0B" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.07)",
            borderRadius: 10, padding: '10px 14px',
            width:"100%", boxSizing:"border-box", textAlign:"left",
          }}>
            <MailOpen size={16} strokeWidth={1.8} color={C.muted} style={{flexShrink:0}}/>
            Check your spam or junk folder if the email doesn't arrive within a minute.
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh", paddingBottom: 24 }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginTop: 24, marginBottom: 4 }}>
          <Logo size={36}/>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 6px", letterSpacing: "-0.4px" }}>
          Create your account
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 1.6 }}>
          We'll send a magic link to your email.
        </p>

        <TextInput
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="your@email.com"
          autoFocus
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
        />

        {err && <p style={{ color:"#E05050", fontSize:13, fontWeight:600, marginTop:10 }}>{err}</p>}

        <div style={{ marginTop: 16 }}>
          <PrimaryButton
            label={loading ? "Sending…" : "Send magic link"}
            onClick={handleSubmit}
            disabled={!isValid || loading}
          />
        </div>
      </div>
    </Screen>
  );
}

// ── Screen 2b: Create password ────────────────────────────────────────────────
const PASSWORD_RULES = [
  { id:"len",   label:"At least 8 characters",     test: p => p.length >= 8       },
  { id:"upper", label:"One uppercase letter (A–Z)", test: p => /[A-Z]/.test(p)     },
  { id:"lower", label:"One lowercase letter (a–z)", test: p => /[a-z]/.test(p)     },
  { id:"digit", label:"One number (0–9)",           test: p => /[0-9]/.test(p)     },
];

function PasswordRequirements({ password }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0" }}>
      {PASSWORD_RULES.map(rule => {
        const met = rule.test(password);
        return (
          <li key={rule.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "5px 0",
            fontSize: 13,
            color: met ? C.green : password.length > 0 ? "#888" : C.muted,
            transition: "color 0.2s",
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              border: `1.5px solid ${met ? C.green : C.border}`,
              background: met ? C.green : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s",
            }}>
              {met && <Check size={10} strokeWidth={3} color="#fff"/>}
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

// ── Screen 3 (post-verify): Create account - password + display name ──────────
function CreateAccountScreen({ onBack, onNext, screenName="create-account" }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const allMet = name.trim().length > 0;

  const handleSubmit = async () => {
    if (!allMet || loading) return;
    setLoading(true); setErr("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setErr("Session expired - please go back and re-enter your email."); setLoading(false); return; }
      await supabase.from("profiles").upsert({
        id: session.user.id,
        display_name: name.trim(),
        chef_names: [name.trim()],
        chef_count: 1,
      });
      setLoading(false);
      onNext(name.trim());
    } catch(e) {
      setErr(e.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh", paddingBottom: 80 }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginTop: 20, marginBottom: 4 }}>
          <Logo size={36}/>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 28px", letterSpacing: "-0.4px" }}>
          What should we call you, chef?
        </h1>

        <TextInput
          value={name}
          onChange={v => setName(v.slice(0, 15))}
          placeholder="e.g. Aaron"
          autoFocus
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
        />

        {err && <p style={{ color:"#E05050", fontSize:13, fontWeight:600, marginTop:12 }}>{err}</p>}

        <div style={{ marginTop: 28 }}>
          <PrimaryButton
            label={loading ? "Saving…" : "Continue"}
            onClick={handleSubmit}
            disabled={!allMet || loading}
          />
        </div>
      </div>
      <div style={{ position:"fixed", bottom:24, left:0, right:0, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <OnboardingDots screen={screenName}/>
      </div>
    </Screen>
  );
}

// ── Screen 3: Code verification ───────────────────────────────────────────────
function VerifyCodeScreen({ email, onBack, onVerified }) {
  const [digits, setDigits] = useState(["","","","","",""]);  // 6-digit OTP
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const hiddenRef = useRef();

  useEffect(() => {
    const t = setTimeout(() => hiddenRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const attempt = async (code) => {
    if (loading) return;
    setLoading(true); setErr("");
    // Supabase sends OTP via the magic link template - type must be "magiclink"
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "magiclink" });
    setLoading(false);
    if (error) {
      setErr("Incorrect code - please try again.");
      setShake(true);
      setDigits(["","","","","",""]);
      if (hiddenRef.current) { hiddenRef.current.value = ""; hiddenRef.current.focus(); }
      setTimeout(() => setShake(false), 500);
      setTimeout(() => setErr(""), 3000);
    } else {
      onVerified();
    }
  };

  const handleChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    const next = ["","","","","",""];
    for (let i = 0; i < raw.length; i++) next[i] = raw[i];
    setDigits(next);
    if (raw.length === 6) setTimeout(() => attempt(raw), 80);
    e.target.value = raw;
  };

  const handleKey = (e) => {
    if (e.key === "Backspace") {
      const filled = digits.filter(Boolean).length;
      if (filled > 0) {
        const next = [...digits]; next[filled - 1] = ""; setDigits(next);
      }
    }
  };

  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "https://forknight.app" } });
    setResent(true); setResending(false);
    setTimeout(() => setResent(false), 3000);
  };

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh" }}>
        <BackButton onClick={onBack}/>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Logo size={36}/>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "20px 0 8px", letterSpacing: "-0.4px" }}>
            Check your email
          </h1>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>
            We sent a 6-digit code to
          </p>
          <p style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 36 }}>
            {email}
          </p>
        </div>

        <input
          ref={hiddenRef}
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          onChange={handleChange}
          onKeyDown={handleKey}
          disabled={loading}
          style={{ position: "fixed", opacity: 0, pointerEvents: "none", width: 1, height: 1, top: "30%", left: "50%" }}
        />

        <div onClick={() => !loading && hiddenRef.current?.focus()} style={{ cursor: "pointer" }}>
          <PasscodeBoxes digits={digits} err={!!err} shake={shake} active={!loading}/>
        </div>

        {loading && (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13, marginTop: 16 }}>Verifying…</p>
        )}
        {err && !loading && (
          <p style={{ textAlign: "center", color: "#E05050", fontSize: 13, fontWeight: 600, marginTop: 16 }}>
            {err}
          </p>
        )}

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button
            onClick={handleResend}
            disabled={resending}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: resent ? C.green : C.accent, fontWeight: 600, display:"inline-flex", alignItems:"center", gap:4 }}
          >
            {resent ? <><Check size={13} strokeWidth={2.5}/> Code resent</> : resending ? "Resending…" : "Resend code"}
          </button>
        </div>
      </div>
    </Screen>
  );
}

// ── Screen 4–6: Onboarding ────────────────────────────────────────────────────

// Step 1: How many chefs?
function OnboardingChefsScreen({ onNext }) {
  const [count, setCount] = useState(null);

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh" }}>
        <StepDots total={3} current={0}/>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          Who's cooking?
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 36, lineHeight: 1.6 }}>
          How many people share cooking duties in your household?
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { val: 1, label: "Just me", sub: "I plan and cook solo" },
            { val: 2, label: "Two of us", sub: "We share cooking duties" },
            { val: 3, label: "Three or more", sub: "It takes a village" },
          ].map(opt => (
            <button
              key={opt.val}
              onClick={() => setCount(opt.val)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                borderRadius: 14,
                border: `2px solid ${count === opt.val ? C.accent : C.border}`,
                background: count === opt.val ? "#FFF2EC" : "#fff",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                border: `2px solid ${count === opt.val ? C.accent : C.border}`,
                background: count === opt.val ? C.accent : "transparent",
                flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {count === opt.val && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }}/>}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: count === opt.val ? C.accent : C.text }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: count === opt.val ? C.accent+"99" : C.muted, marginTop: 2 }}>{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <PrimaryButton
            label="Continue"
            onClick={() => onNext(count)}
            disabled={!count}
          />
        </div>
      </div>
    </Screen>
  );
}

// Step 2: Chef names
function OnboardingNamesScreen({ chefCount, onNext, onBack }) {
  const labels = ["First cook", "Second cook", "Third cook"];
  const [names, setNames] = useState(Array(Math.min(chefCount, 3)).fill(""));

  const update = (i, val) => {
    const n = [...names]; n[i] = val; setNames(n);
  };

  const allFilled = names.every(n => n.trim().length > 0);

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh" }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginTop: 16 }}>
          <StepDots total={3} current={1}/>
        </div>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          {chefCount === 1 ? "What's your name?" : "What are your names?"}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 1.6 }}>
          {chefCount === 1
            ? "We'll use your name on meal cards."
            : "We'll show who's cooking each night."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {names.map((name, i) => (
            <div key={i}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                {labels[i]}
              </label>
              <TextInput
                value={name}
                onChange={val => update(i, val)}
                placeholder={i === 0 ? "e.g. Aaron" : i === 1 ? "e.g. Alona" : "e.g. Jamie"}
                autoFocus={i === 0}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28 }}>
          <PrimaryButton
            label="Continue"
            onClick={() => onNext(names.map(n => n.trim()))}
            disabled={!allFilled}
          />
        </div>
      </div>
    </Screen>
  );
}

// Step 3: Favorite proteins
function OnboardingProteinsScreen({ onNext, onBack, screenName="onboard-proteins" }) {
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const toggle = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const handleFinish = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({ id: user.id, preferred_proteins: [...selected] });
    }
    setLoading(false);
    onNext([...selected]);
  };

  return (
    <Screen>
      <div style={{ paddingTop: "8dvh", paddingBottom: 80 }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          What are your go-to proteins?
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 28, lineHeight: 1.6 }}>
          Pick your favorites - we'll suggest more of these.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
          {PROTEINS.map(p => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  padding: "20px 12px",
                  borderRadius: 14,
                  border: `2px solid ${on ? C.accent : C.border}`,
                  background: on ? C.accentTint : C.card,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  position: "relative",
                }}
              >
                {on && (
                  <div style={{
                    position: "absolute", top: 8, right: 8,
                    width: 18, height: 18, borderRadius: "50%",
                    background: C.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Check size={10} strokeWidth={3} color="#fff"/>
                  </div>
                )}
                <p.Icon size={26} strokeWidth={1.6} color={on ? C.accent : "#888"}/>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: on ? C.accent : C.text,
                }}>
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>

        <PrimaryButton
          label={loading ? "Saving…" : selected.size === 0 ? "Skip for now" : `Continue with ${selected.size} selected`}
          onClick={handleFinish}
          disabled={loading}
        />
      </div>
      <div style={{ position:"fixed", bottom:24, left:0, right:0, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <OnboardingDots screen={screenName}/>
      </div>
    </Screen>
  );
}

// ── Screen: Household Size ─────────────────────────────────────────────────────
const CHEF_COLORS = ["#5A8FAA","#C0785A","#7A6AA0","#4A7A6A","#A06A4A","#8FAA5A","#AA5A7A","#5A8FAA"];

function HouseholdSizeAvatars({ size, memberNames=[] }) {
  const large = 2; // first two are large
  return (
    <div style={{ display:"flex", alignItems:"center", marginLeft: 4 }}>
      {Array.from({length: size}).map((_, i) => {
        const isLarge = i < large;
        const w = isLarge ? 40 : 28;
        const name = memberNames[i];
        return (
          <div key={i} style={{
            width: w, height: w, borderRadius: "50%",
            background: CHEF_COLORS[i % CHEF_COLORS.length],
            border: "2px solid #fff",
            marginLeft: i === 0 ? 0 : isLarge ? -6 : -10,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: isLarge ? 15 : 11, fontWeight: 700,
            flexShrink: 0, zIndex: size - i,
            position: "relative",
          }}>
            {name ? name[0].toUpperCase() : <User size={isLarge?16:11} strokeWidth={2}/>}
          </div>
        );
      })}
    </div>
  );
}

function OnboardingHouseholdSizeScreen({ onNext, onBack, screenName="onboard-size" }) {
  const [size, setSize] = useState(2);

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh", paddingBottom: 80 }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          How many are you feeding?
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 1.6 }}>
          We'll scale all recipes to match.
        </p>

        <div style={{ display:"flex", alignItems:"center", gap: 16, marginBottom: 24 }}>
          <span style={{ fontSize: 56, fontWeight: 800, color: C.text, minWidth: 48, lineHeight: 1 }}>{size}</span>
          <div style={{ display:"flex", alignItems:"center" }}>
            {Array.from({length: size}).map((_, i) => {
              const isLarge = i < 2;
              const w = isLarge ? 40 : 26;
              return (
                <div key={i} style={{
                  width: w, height: w, borderRadius: "50%",
                  background: isLarge ? "#5A8FAA" : "#C8C8C0",
                  border: "2px solid #fff",
                  marginLeft: i === 0 ? 0 : isLarge ? -6 : -10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: isLarge ? 15 : 10, fontWeight: 700,
                  flexShrink: 0, zIndex: size - i, position: "relative",
                }}>
                  <User size={isLarge ? 16 : 10} strokeWidth={2}/>
                </div>
              );
            })}
          </div>
        </div>

        <input type="range" min={1} max={8} value={size}
          onChange={e => setSize(Number(e.target.value))}
          style={{ width: "100%", accentColor: C.accent, height: 4, cursor: "pointer", marginBottom: 40 }}
        />

        <PrimaryButton label="Continue" onClick={() => onNext(size)} disabled={false}/>
      </div>
      <div style={{ position:"fixed", bottom:24, left:0, right:0, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <OnboardingDots screen={screenName}/>
      </div>
    </Screen>
  );
}

// ── Screen: Sign In ───────────────────────────────────────────────────────────
function SignInScreen({ onBack, onFaceId }) {
  const storedEmail = localStorage.getItem(FACEID_KEY) || "";
  const [email, setEmail] = useState(storedEmail);
  const [loading, setLoading] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const showFaceId = isFaceIdAvailable(); // always show if device supports it

  const handleSend = async () => {
    if (!isValid || loading) return;
    setLoading(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: "https://forknight.app",
        shouldCreateUser: false,
      },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  };

  const [showFaceIdSheet, setShowFaceIdSheet] = useState(false); // "sign in required" sheet

  const handleFaceId = async () => {
    const emailToUse = email.trim() || storedEmail;
    setFaceLoading(true); setErr("");
    const storedKey = localStorage.getItem(FACEID_KEY);
    console.log("[FaceID] tapped, email:", emailToUse, "storedEmail:", storedEmail, "FACEID_KEY value:", storedKey);

    // Check for active session
    let session = null;
    try {
      const { data } = await supabase.auth.getSession();
      session = data?.session;
      console.log("[FaceID] session:", session?.user?.email || "none");
    } catch(e) { console.log("[FaceID] getSession error:", e.message); }

    // If we have a session and no credential enrolled, show setup sheet
    if (session && localStorage.getItem(FACEID_KEY) !== session.user.email) {
      setFaceLoading(false); setShowFaceIdSheet(true); return;
    }

    // No email and no stored credential — try anyway (OS knows the passkey)
    // or show sheet if definitely no credential
    if (!emailToUse && !storedKey) {
      setFaceLoading(false); setShowFaceIdSheet(true); return;
    }

    // Attempt Face ID auth — use stored email if field is blank
    const authEmail = emailToUse || storedKey;
    console.log("[FaceID] attempting auth for:", authEmail);
    const result = await attemptFaceIdSignIn(authEmail);
    console.log("[FaceID] auth result:", result.success, result.reason);
    setFaceLoading(false);

    if (result.success) {
      if (onFaceId) onFaceId(result.session);
    } else {
      // Any failure — clear stale key and show sheet
      localStorage.removeItem(FACEID_KEY);
      setShowFaceIdSheet(true);
    }
  };

  if (showFaceIdSheet) {
    return (
      <Screen>
        <div style={{paddingTop:"15dvh",display:"flex",flexDirection:"column",alignItems:"center",gap:16,textAlign:"center"}}>
          <FaceIdIcon size={64} color={C.text}/>
          <h1 style={{fontSize:22,fontWeight:700,color:C.text,margin:0,letterSpacing:"-0.4px"}}>Sign in to use Face ID</h1>
          <p style={{fontSize:15,color:C.muted,lineHeight:1.6,maxWidth:280,margin:0}}>
            Send a magic link first — after signing in we'll set up Face ID so you never need it again.
          </p>
          {!isValid&&<p style={{fontSize:13,color:"#E05050",margin:0}}>Enter your email above first</p>}
          <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
            <PrimaryButton
              label={loading?"Sending…":"Send magic link"}
              onClick={()=>{setShowFaceIdSheet(false);handleSend();}}
              disabled={loading||!isValid}
            />
            <button onClick={()=>setShowFaceIdSheet(false)}
              style={{width:"100%",padding:"14px",borderRadius:12,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:14,fontWeight:600,cursor:"pointer"}}>
              Back
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  if (sent) {
    return (
      <Screen>
        <div style={{ paddingTop: "12dvh", textAlign: "center", display:"flex", flexDirection:"column", alignItems:"center" }}>
          <Logo size={36}/>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: C.text, margin: "24px 0 10px", letterSpacing: "-0.4px" }}>
            Check your email
          </h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.7, marginBottom: 4 }}>
            We sent a magic link to
          </p>
          <p style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 36, userSelect:"none", WebkitUserSelect:"none" }}>{email}</p>

          <div style={{ width:"100%", marginBottom: 32 }}>
            <ResendButton email={email} onResend={handleSend}/>
          </div>

          <div style={{
            display:"flex", alignItems:"center", gap: 10,
            fontSize: 12, color: C.muted, lineHeight: 1.6,
            background: C.bg==="0D0D0B" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.07)",
            borderRadius: 10, padding: '10px 14px',
            width:"100%", boxSizing:"border-box", textAlign:"left",
          }}>
            <MailOpen size={16} strokeWidth={1.8} color={C.muted} style={{flexShrink:0}}/>
            Check your spam or junk folder if the email doesn't arrive within a minute.
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh" }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginTop: 24, marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 1.6 }}>
          Enter your email and we'll send a magic link.
        </p>
        {/* Email input with Face ID icon inside if available */}
        <div style={{ position: "relative" }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            autoFocus
            onKeyDown={e => e.key === "Enter" && handleSend()}
            style={{
              width: "100%", padding: showFaceId ? "14px 52px 14px 16px" : "14px 16px",
              borderRadius: 12, border: `1.5px solid ${C.border}`,
              fontSize: 16, background: C.card, color: C.text,
              outline: "none", boxSizing: "border-box",
              fontFamily: "system-ui, sans-serif",
            }}
          />
          {showFaceId && (
            <button
              onClick={handleFaceId}
              disabled={faceLoading}
              title="Sign in with Face ID"
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", padding: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: faceLoading ? 0.4 : 1,
              }}
            >
              {faceLoading
                ? <div style={{width:24,height:24,borderRadius:"50%",border:`2px solid ${C.border}`,borderTopColor:C.text,animation:"loadSpin 0.8s linear infinite"}}/>
                : <FaceIdIcon size={26} color={C.text}/>
              }
            </button>
          )}
        </div>
        {err && <p style={{ color: "#E05050", fontSize: 13, fontWeight: 600, marginTop: 12 }}>{err}</p>}
        <div style={{ marginTop: 16 }}>
          <PrimaryButton label={loading ? "Sending…" : "Send magic link"} onClick={handleSend} disabled={!isValid || loading}/>
        </div>
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <span style={{ fontSize: 13, color: C.muted }}>Don't have an account? </span>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: C.accent, fontWeight: 600 }}>Sign up</button>
        </div>
      </div>
    </Screen>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────
// ── Join household screen - for users who have an invite code ─────────────────
function JoinHouseholdScreen({ onJoin, onSkip, onBack }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleJoin = async () => {
    if (!code.trim() || loading) return;
    setLoading(true); setErr("");

    // Read session from localStorage - bypasses Supabase lock queue
    let session = null;
    try { const raw = localStorage.getItem("forknight-auth"); if (raw) session = JSON.parse(raw); } catch {}
    if (!session?.user) {
      // Fallback to Supabase client only if localStorage empty
      const { data } = await supabase.auth.getSession();
      session = data?.session;
    }
    if (!session?.user) {
      setErr("Session expired. Please sign in again.");
      setLoading(false); return;
    }

    const SUPABASE_URL = "https://cekgmugupbbmehpeoqnp.supabase.co";
    const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNla2dtdWd1cGJibWVocGVvcW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDY4MDAsImV4cCI6MjA5Mjk4MjgwMH0.VfBTWhvpuAviNNP2ZCF6kMj0qGyNvjGO2Z04z_u2e98";
    const token = session.access_token || SUPABASE_ANON;

    const doJoin = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_household_by_code`, {
          method: "POST",
          headers: {
            "apikey": SUPABASE_ANON,
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_invite_code: code.trim().toUpperCase(),
            p_user_id: session.user.id,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) return { error: null };
        const body = await res.json().catch(() => ({}));
        return { error: { message: body.message || body.hint || `HTTP ${res.status}` } };
      } catch(e) {
        clearTimeout(timer);
        return { error: { message: e.message } };
      }
    };

    let result = await doJoin();
    console.log("[join] attempt 1:", result.error?.message || "ok");
    if (result.error) {
      await new Promise(r => setTimeout(r, 800));
      result = await doJoin();
      console.log("[join] attempt 2:", result.error?.message || "ok");
    }
    if (result.error) {
      await new Promise(r => setTimeout(r, 1000));
      result = await doJoin();
      console.log("[join] attempt 3:", result.error?.message || "ok");
    }

    setLoading(false);
    if (result.error) {
      const msg = result.error.message || "";
      if (msg.includes("full")) setErr("This household is full (max 5 members).");
      else if (msg.includes("Invalid") || msg.includes("invalid")) setErr("Invalid invite code - check with the person who shared it.");
      else setErr(`Could not join: ${msg}`);
      return;
    }
    onJoin();
  };

  const [showJoinForm, setShowJoinForm] = useState(false);

  return (
    <Screen>
      <div style={{ paddingTop: "8dvh", paddingBottom: 80 }}>
        <BackButton onClick={onBack}/>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          Set up your household
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 28, lineHeight: 1.6 }}>
          Forknight syncs your meal plan across everyone in your home.
        </p>
        {!showJoinForm ? (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ marginBottom: 16, display:"flex", justifyContent:"center" }}>
          <Home size={64} strokeWidth={1.2} color={C.text} style={{
            opacity:0.35,
            animation:"houseWiggle 5s ease-in-out infinite",
            display:"block",
          }}/>
        </div>
            <PrimaryButton label="Create a household" onClick={onSkip}/>
            <button onClick={() => setShowJoinForm(true)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:C.text, fontWeight:600, padding:"12px 0", textDecoration:"underline" }}>
              Have an invite code? Join an existing household
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
              Enter the invite code from your household.
            </p>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Invite code
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && handleJoin()}
              placeholder="e.g. A3X9FK"
              autoFocus
              maxLength={6}
              style={{
                width: "100%", padding: "15px 16px", borderRadius: 12,
                border: `1.5px solid ${C.border}`, background: C.card,
                fontSize: 22, fontWeight: 800, color: C.text, outline: "none",
                boxSizing: "border-box", letterSpacing: "0.2em", textAlign: "center",
                fontFamily: "monospace", textTransform: "uppercase",
              }}
            />
            {err && <p style={{ color: "#E05050", fontSize: 13, fontWeight: 600, marginTop: 10 }}>{err}</p>}
            <div style={{ display:"flex", gap:10, marginTop:24 }}>
              <SecondaryButton label="Back" onClick={() => setShowJoinForm(false)}/>
              <PrimaryButton label={loading ? "Joining…" : "Join"} onClick={handleJoin} disabled={!code.trim() || loading}/>
            </div>
            <div style={{ textAlign:"center", marginTop:16 }}>
              <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.muted }}>
                Return to signup
              </button>
            </div>
          </>
        )}
      </div>
      <div style={{ position:"fixed", bottom:24, left:0, right:0, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <OnboardingDots screen="join-or-create"/>
      </div>
    </Screen>
  );
}

// ── Invite screen - shown after onboarding to share with household members ────
function InviteScreen({ inviteCode, onDone, screenName="invite" }) {
  const [copied, setCopied] = useState(false);
  const shareText = `Join my Forknight household!\n\n1. Go to https://forknight.app\n2. Create an account\n3. Enter invite code: ${inviteCode}\n\nWe'll be synced to the same meal plan automatically.`;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(inviteCode); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: "Join Forknight", text: shareText }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText).catch(() => {});
    }
  };

  return (
    <Screen>
      <div style={{ paddingTop: "10dvh", paddingBottom: 80 }}>
        <div style={{ marginBottom: 4 }}><Logo size={36}/></div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "14px 0 8px", letterSpacing: "-0.4px" }}>
          Invite your household
        </h1>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32, lineHeight: 1.6 }}>
          Share this code with anyone in your household. When they sign up, they'll enter it to sync to your plan automatically.
        </p>

        {/* Invite code display */}
        <div style={{
          background: C.card,
          border: `2px solid ${C.border}`,
          borderRadius: 16,
          padding: "28px 24px",
          textAlign: "center",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Your invite code
          </div>
          <div style={{
            fontFamily: "monospace",
            fontSize: 36,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "0.2em",
            marginBottom: 16,
          }}>
            {inviteCode}
          </div>
          <button
            onClick={handleCopy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 10,
              border: `1.5px solid ${copied ? C.green : C.border}`,
              background: copied ? "#EAF3EA" : "transparent",
              fontSize: 13, fontWeight: 600,
              color: copied ? C.green : C.muted,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <Check size={13} strokeWidth={2.5} color={copied ? C.green : C.muted}/>
            {copied ? "Copied!" : "Copy code"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PrimaryButton label="Skip for now" onClick={onDone}/>
          <SecondaryButton
            label="Share invite"
            onClick={handleShare}
          />
        </div>

        <p style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 20, lineHeight: 1.6 }}>
          You can always find this code in your account settings.
        </p>
      </div>
      <div style={{ position:"fixed", bottom:24, left:0, right:0, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <OnboardingDots screen={screenName}/>
      </div>
    </Screen>
  );
}

function SuccessScreen({ names }) {
  return (
    <Screen centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom: 20 }}>
          <Utensils size={52} strokeWidth={1.4} color={C.accent}/>
        </div>
        <Logo size={36}/>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "20px 0 10px", letterSpacing: "-0.4px" }}>
          {names?.length > 0
            ? `Welcome, ${names[0]}!`
            : "You're all set!"}
        </h1>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 40 }}>
          Your kitchen is ready. Let's start planning this week's dinners.
        </p>
        <PrimaryButton
          label="Start planning"
          onClick={() => {}}
          icon={<ArrowRight size={16} strokeWidth={2.5}/>}
        />
      </div>
    </Screen>
  );
}


// ── FaceIdEnrollButton — handles WebAuthn registration UX ─────────────────────
function FaceIdEnrollButton({ session, onSuccess, C }) {
  const WEBAUTHN_URL = "https://forknight.app/auth/webauthn";
  const [status, setStatus] = useState("idle"); // idle | loading | done | error

  const b64ToU8 = (b64) => Uint8Array.from(atob(b64.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const u8ToB64url = (buf) => btoa(Array.from(new Uint8Array(buf), b => String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");

  const handleEnroll = async () => {
    if (!session) return;
    setStatus("loading");
    try {
      // 1. Get challenge
      const beginRes = await fetch(`${WEBAUTHN_URL}/register/begin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwt: session.access_token }),
      });
      if (!beginRes.ok) { setStatus("error"); return; }
      const { options, challengeId } = await beginRes.json();

      // 2. Prepare options for WebAuthn API
      options.challenge = b64ToU8(options.challenge);
      options.user.id = b64ToU8(options.user.id);
      // Filter to algorithms Safari supports
      options.pubKeyCredParams = (options.pubKeyCredParams || []).filter(p => p.alg !== -8);

      // 3. Show Face ID — this is where iOS prompts biometrics
      const credential = await navigator.credentials.create({ publicKey: options });

      // 4. Send result to worker
      const completeRes = await fetch(`${WEBAUTHN_URL}/register/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jwt: session.access_token,
          challengeId,
          deviceName: /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : "Device",
          credential: {
            id: credential.id,
            rawId: u8ToB64url(credential.rawId),
            type: credential.type,
            response: {
              attestationObject: u8ToB64url(credential.response.attestationObject),
              clientDataJSON: u8ToB64url(credential.response.clientDataJSON),
            },
          },
        }),
      });
      const { verified } = await completeRes.json();
      if (verified) {
        localStorage.setItem(FACEID_KEY, session.user.email);
        setStatus("done");
        setTimeout(onSuccess, 800);
      } else {
        setStatus("error");
      }
    } catch (err) {
      console.log("[FaceID enroll] error:", err.name, err.message);
      // NotAllowedError = user cancelled Face ID — treat as "not now"
      if (err.name === "NotAllowedError") { onSuccess(); return; }
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div style={{ width:"100%", padding:"14px", borderRadius:12, background:C.accentTint, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        <FaceIdIcon size={20} color={C.accent}/>
        <span style={{ fontSize:14, fontWeight:700, color:C.accent }}>Face ID enabled!</span>
      </div>
    );
  }

  return (
    <button onClick={handleEnroll} disabled={status === "loading"}
      style={{ width:"100%", padding:"16px", borderRadius:12, border:"none", background:C.text, color:C.bg, fontSize:15, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, opacity: status === "loading" ? 0.7 : 1 }}>
      {status === "loading"
        ? <><div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${C.bg}40`, borderTopColor:C.bg, animation:"fk-spin 0.8s linear infinite" }}/> Setting up…</>
        : status === "error"
          ? <><FaceIdIcon size={20} color={C.bg}/> Try again</>
          : <><FaceIdIcon size={20} color={C.bg}/> Enable Face ID</>
      }
    </button>
  );
}

// ── Root: Flow coordinator ────────────────────────────────────────────────────
export default function ForknightAuth({ onAuthenticated }) {
  const [screen, setScreen] = useState("loading");
  const [signupEmail, setSignupEmail] = useState("");
  const [chefCount, setChefCount] = useState(2);
  const [chefNames, setChefNames] = useState([]);
  const [householdSizeOnboard, setHouseholdSizeOnboard] = useState(2);
  const [didJoinHousehold, setDidJoinHousehold] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  // Face ID state — set when we have a session and want to prompt enrollment
  const [pendingSession, setPendingSession] = useState(null);   // session waiting for FaceID decision
  const [pendingProfile, setPendingProfile] = useState(null);   // profile for that session

  const go = (s) => setScreen(s);

  // ── Single routing function — all paths end here ───────────────────────────
  // Called with a verified session + profile. Decides what screen to show.
  const routeSession = (session, profile) => {
    if (!session || !profile?.household_id) return;
    // Is Face ID available on this device?
    const canFaceId = typeof window !== "undefined" && !!window.PublicKeyCredential;
    // Is it already enrolled for this email?
    const enrolled = localStorage.getItem(FACEID_KEY) === session.user.email;
    if (canFaceId && !enrolled) {
      // Show enrollment prompt — store session/profile so onDone can enter the app
      setPendingSession(session);
      setPendingProfile(profile);
      go("faceid-setup");
    } else {
      onAuthenticated({ session, profile });
    }
  };

  // ── One useEffect, one auth listener ──────────────────────────────────────
  useEffect(() => {
    // main.jsx owns session management — ForknightAuth just handles onboarding screens
    // Only handle magic link hash cleanup here
    const hash = window.location.hash;
    if (hash.includes("access_token") || hash.includes("type=magiclink") || hash.includes("type=signup")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // If there is already a valid session (e.g. magic link just resolved,
    // or user was routed here because profile is not yet created),
    // skip landing and go straight to household setup.
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        go("create-account");
      } else {
        go("landing");
      }
    }).catch(() => go("landing"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const SUPA_URL = "https://cekgmugupbbmehpeoqnp.supabase.co";
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNla2dtdWd1cGJibWVocGVvcW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDY4MDAsImV4cCI6MjA5Mjk4MjgwMH0.VfBTWhvpuAviNNP2ZCF6kMj0qGyNvjGO2Z04z_u2e98";

  const getToken = () => {
    try {
      const raw = localStorage.getItem("forknight-auth");
      return raw ? (JSON.parse(raw)?.access_token || SUPA_KEY) : SUPA_KEY;
    } catch { return SUPA_KEY; }
  };

  const fetchProfileWithRetry = async (userId) => {
    for (let i = 0; i < 4; i++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(
          `${SUPA_URL}/rest/v1/profiles?select=household_id,display_name,chef_names&id=eq.${userId}&limit=1`,
          { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${getToken()}`, Accept: "application/json" }, signal: controller.signal }
        );
        clearTimeout(timer);
        if (res.ok) {
          const rows = await res.json();
          if (rows[0]?.household_id) return rows[0];
        }
      } catch {}
      if (i < 3) await new Promise(r => setTimeout(r, 700));
    }
    return null;
  };

  const createHousehold = async (names) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.rpc("create_household_for_user", {
      p_user_id: user.id,
      p_name: `${names[0] || "My"}'s household`,
    });
    if (error) { console.error("createHousehold error:", error); return null; }
    const householdId = data?.household_id;
    const inviteCodeVal = data?.invite_code;
    try {
      const pending = localStorage.getItem("forknight_hsize_pending");
      if (pending && householdId) {
        localStorage.setItem(`forknight_hsize_${householdId}`, pending);
        localStorage.removeItem("forknight_hsize_pending");
      }
    } catch {}
    return { householdId, inviteCode: inviteCodeVal || "" };
  };

  const saveChefNames = async (names) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("profiles").upsert({
      id: user.id,
      chef_names: names,
      chef_count: names.length,
      display_name: names[0],
    });
  };

  const finishAndEnter = async (currentScreen) => {
    let session = null;
    try {
      const raw = localStorage.getItem("forknight-auth");
      if (raw) session = JSON.parse(raw);
    } catch {}
    if (!session?.user) {
      const { data } = await supabase.auth.getSession();
      session = data?.session;
    }
    console.log("[finishAndEnter] session:", session?.user?.id || "none", "screen:", currentScreen || screen);
    if (!session?.user) { go("landing"); return; }

    const activeScreen = currentScreen || screen;
    let profile = await fetchProfileWithRetry(session.user.id);

    if (!profile?.household_id) {
      if (activeScreen === "invite" || activeScreen === "onboard-proteins") {
        const name = chefNames[0] || "My";
        const result = await createHousehold([name]);
        if (result?.inviteCode) setInviteCode(result.inviteCode);
        profile = await fetchProfileWithRetry(session.user.id);
      } else if (activeScreen !== "join-or-create") {
        go("join-or-create");
        return;
      }
    }

    if (!profile?.household_id) { go("join-or-create"); return; }
    routeSession(session, profile);
  };

  // ── Screen routing ─────────────────────────────────────────────────────────

  if (screen === "loading")
    return (
      <div style={{ position:"fixed", inset:0, background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <style>{`@keyframes fk-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        <div style={{ position:"relative", width:150, height:150, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="150" height="150" style={{ position:"absolute", inset:0, animation:"fk-spin 1.1s linear infinite" }}>
            <circle cx="75" cy="75" r="68" fill="none" stroke={C.border} strokeWidth="4"/>
            <circle cx="75" cy="75" r="68" fill="none" stroke="#FF6B35" strokeWidth="4" strokeDasharray="100 330" strokeLinecap="round"/>
          </svg>
          <div style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:600, color:C.text, letterSpacing:"-0.5px", lineHeight:1, textAlign:"center" }}>
            Fork<br/>night
          </div>
        </div>
      </div>
    );

  // Face ID setup screen — shown after first sign-in if not yet enrolled
  if (screen === "faceid-setup")
    return (
      <Screen>
        <div style={{ paddingTop:"15dvh", display:"flex", flexDirection:"column", alignItems:"center", gap:20, textAlign:"center" }}>
          <FaceIdIcon size={72} color={C.text}/>
          <div>
            <h1 style={{ fontSize:24, fontWeight:700, color:C.text, margin:"0 0 10px", letterSpacing:"-0.5px" }}>Sign in faster with Face ID</h1>
            <p style={{ fontSize:15, color:C.muted, lineHeight:1.6, margin:0, maxWidth:280 }}>
              Skip the email next time. One look and you're in.
            </p>
          </div>
          <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
            <FaceIdEnrollButton
              session={pendingSession}
              onSuccess={() => {
                if (pendingSession && pendingProfile) {
                  onAuthenticated({ session:pendingSession, profile:pendingProfile });
                }
              }}
              C={C}
            />
            <button
              onClick={() => {
                if (pendingSession && pendingProfile) {
                  onAuthenticated({ session:pendingSession, profile:pendingProfile });
                }
              }}
              style={{ width:"100%", padding:"14px", borderRadius:12, border:`1px solid ${C.border}`, background:"transparent", color:C.muted, fontSize:14, fontWeight:600, cursor:"pointer" }}
            >
              Not now
            </button>
          </div>
          <p style={{ fontSize:12, color:C.muted, marginTop:4 }}>
            You can enable this later in Settings.
          </p>
        </div>
      </Screen>
    );

  if (screen === "landing")
    return <LandingScreen onSignUp={() => go("signup-email")} onSignIn={() => go("signin")}/>;

  if (screen === "signup-email")
    return <SignUpEmailScreen onBack={() => go("landing")} onNext={email => { setSignupEmail(email); go("create-account"); }}/>;

  if (screen === "verify")
    return <VerifyCodeScreen email={signupEmail} onBack={() => go("signup-email")} onVerified={() => go("create-account")}/>;

  if (screen === "create-account")
    return <CreateAccountScreen onBack={() => go("signup-email")} onNext={(name) => { setChefNames([name]); go("join-or-create"); }}/>;

  if (screen === "join-or-create")
    return <JoinHouseholdScreen
      onJoin={() => { setDidJoinHousehold(true); go("onboard-proteins"); }}
      onSkip={() => { setDidJoinHousehold(false); go("onboard-proteins"); }}
      onBack={() => go("create-account")}
    />;

  if (screen === "onboard-proteins")
    return <OnboardingProteinsScreen onBack={() => go("join-or-create")} onNext={async (selected) => {
      if (didJoinHousehold) { await finishAndEnter("join-or-create"); return; }
      go("onboard-size");
    }}/>;

  if (screen === "onboard-size")
    return <OnboardingHouseholdSizeScreen onBack={() => go("onboard-proteins")} onNext={async (size) => {
      setHouseholdSizeOnboard(size);
      try { localStorage.setItem("forknight_hsize_pending", String(size)); } catch {}
      let alreadyHasHousehold = false;
      try {
        const { data: profile } = await supabase.from("profiles").select("household_id").eq("id",(await supabase.auth.getUser()).data.user?.id).maybeSingle();
        alreadyHasHousehold = !!profile?.household_id;
      } catch {}
      if (alreadyHasHousehold) { go("invite"); return; }
      const name = chefNames[0] || "My";
      const result = await createHousehold([name]);
      if (result?.inviteCode) setInviteCode(result.inviteCode);
      go("invite");
    }}/>;

  if (screen === "invite")
    return <InviteScreen inviteCode={inviteCode} onDone={() => finishAndEnter("invite")}/>;

  if (screen === "signin")
    return <SignInScreen onBack={() => go("landing")} onFaceId={(session) => {
      // Face ID sign-in succeeded — fetch profile and enter app
      fetchProfileWithRetry(session.user.id).then(profile => {
        if (profile) onAuthenticated({ session, profile });
        else go("landing");
      });
    }}/>;

  return null;
}

