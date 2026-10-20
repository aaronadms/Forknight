import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { supabase } from './supabaseClient.js'
import ForknightAuth from './ForknightAuth.jsx'
import App from './App.jsx'

// ── Logo spinner loading screen ───────────────────────────────────────────────
function LoadingScreen() {
  const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const stored = (() => { try { return localStorage.getItem("forknight_theme"); } catch { return null; } })();
  const dark = stored === "dark" || (stored !== "light" && isDark);
  const bg = dark ? "#0D0D0B" : "#F5F5F0";
  const textColor = dark ? "#E8E8E2" : "#1A1A1A";
  const trackColor = dark ? "#2E2E2C" : "#E2E2DC";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fk-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ position: "relative", width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Spinning ring */}
        <svg width="150" height="150" style={{ position: "absolute", inset: 0, animation: "fk-spin 1.1s linear infinite" }}>
          <circle cx="75" cy="75" r="68" fill="none" stroke={trackColor} strokeWidth="4"/>
          <circle cx="75" cy="75" r="68" fill="none" stroke="#FF6B35" strokeWidth="4"
            strokeDasharray="100 330" strokeLinecap="round"/>
        </svg>
        {/* Logo centered */}
        <div style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 22,
          fontWeight: 600,
          color: textColor,
          letterSpacing: "-0.5px",
          lineHeight: 1,
          textAlign: "center",
        }}>
          Fork<br/>night
          <sup style={{ fontSize: "0.2em", fontWeight: 400, position: "relative", top: "-8px" }}>®</sup>
        </div>
      </div>
    </div>
  );
}

async function fetchAuthData(session) {
  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("household_id, display_name, chef_names, subscription_tier")
      .eq("id", session.user.id)
      .maybeSingle();

    console.log("[auth] profile:", profile, "error:", profileError?.message);
    if (profileError || !profile?.household_id) return null;

    let inviteCode = "";
    let householdMembers = [];
    try {
      const { data: household, error: hhError } = await supabase
        .from("households")
        .select("invite_code")
        .eq("id", profile.household_id)
        .maybeSingle();
      console.log("[auth] household:", household, "error:", hhError?.message);
      inviteCode = household?.invite_code || "";
    } catch {}

    try {
      const { data: members } = await supabase
        .rpc("get_household_members", { p_household_id: profile.household_id });
      householdMembers = members || [];
      console.log("[auth] householdMembers:", householdMembers.map(m => m.display_name));
    } catch(e) {
      console.log("[auth] householdMembers error:", e.message);
    }

    // Fetch monetization config
    let monetization = { enabled: false, preview: [] };
    try {
      const { data: cfg } = await supabase
        .from("app_config").select("value").eq("key","monetization").maybeSingle();
      if (cfg?.value) monetization = cfg.value;
    } catch {}
    return { session, profile, inviteCode, householdMembers, monetization };
  } catch(e) {
    console.error("[auth] fetchAuthData threw:", e);
    return null;
  }
}

function Root() {
  const [auth, setAuth] = useState(null);
  const [showFaceIdSetup, setShowFaceIdSetup] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(null);

  const WEBAUTHN_URL = "https://forknight.app/auth/webauthn";
  const b64ToU8 = (b64) => Uint8Array.from(atob(b64.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const u8ToB64url = (buf) => btoa(Array.from(new Uint8Array(buf), b => String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");

  const enterApp = (authData) => { setShowFaceIdSetup(false); setPendingAuth(null); setAuth(authData); };

  const handleAuthenticated = async (authData) => {
    try {
      const data = await fetchAuthData(authData.session);
      const finalAuth = data || authData;
      const canFaceId = !!window.PublicKeyCredential;
      const enrolled = localStorage.getItem("forknight_faceid_email") === authData.session?.user?.email;
      if (canFaceId && !enrolled) {
        setPendingAuth(finalAuth);
        setShowFaceIdSetup(true);
      } else {
        setAuth(finalAuth);
      }
    } catch { setAuth(authData); }
  };

  useEffect(() => {
    // Clear magic link hash early
    if (window.location.hash.includes("access_token")) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Supabase awaits this callback while holding its auth lock, and every
    // supabase query needs that lock — so awaiting queries in here deadlocks.
    // Defer the real work until after the callback returns.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[auth] event:", event, session?.user?.id || "none");
      setTimeout(() => handleAuthEvent(event, session), 0);
    });

    const handleAuthEvent = async (event, session) => {
      if (event === "INITIAL_SESSION") {
        if (session) {
          const data = await fetchAuthData(session);
          if (data?.profile?.household_id) {
            setAuth(data);
          } else {
            setAuth(false);
          }
        } else {
          setAuth(false);
        }
      } else if (event === "SIGNED_IN") {
        await handleAuthenticated({ session });
      } else if (event === "SIGNED_OUT") {
        setAuth(false); setShowFaceIdSetup(false); setPendingAuth(null);
      }
    };

    const fallback = setTimeout(() => setAuth(prev => prev === null ? false : prev), 6000);
    return () => { subscription.unsubscribe(); clearTimeout(fallback); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignOut = async () => {
    setAuth(false);
    // Revokes the session server-side, clears storage, and emits SIGNED_OUT to
    // this tab and any others. If the network call fails, supabase keeps the
    // local session, so clear it ourselves.
    const { error } = await supabase.auth.signOut().catch(e => ({ error: e }));
    if (error) {
      console.log("[auth] signOut error, clearing local session:", error.message);
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      try { localStorage.removeItem("forknight-auth"); } catch {}
    }
  };

  // Theme detection for sheets
  const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const storedTheme = (() => { try { return localStorage.getItem("forknight_theme"); } catch { return null; } })();
  const dark = storedTheme === "dark" || (storedTheme !== "light" && isDark);
  const sc = {
    bg: dark ? "#0D0D0B" : "#EDEEE8", card: dark ? "#1A1A18" : "#F8F9F3",
    text: dark ? "#E8E8E2" : "#1A1A1A", muted: dark ? "#888888" : "#666666",
    border: dark ? "#2C2C2A" : "#E2E2DC",
  };

  // Face ID icon SVG
  const FaceIdSvg = ({ size=64, color }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d="M22 8 L13 8 Q8 8 8 13 L8 22" stroke={color} strokeWidth="7" strokeLinecap="round"/>
      <path d="M78 8 L87 8 Q92 8 92 13 L92 22" stroke={color} strokeWidth="7" strokeLinecap="round"/>
      <path d="M8 78 L8 87 Q8 92 13 92 L22 92" stroke={color} strokeWidth="7" strokeLinecap="round"/>
      <path d="M92 78 L92 87 Q92 92 87 92 L78 92" stroke={color} strokeWidth="7" strokeLinecap="round"/>
      <line x1="34" y1="36" x2="34" y2="47" stroke={color} strokeWidth="6.5" strokeLinecap="round"/>
      <line x1="66" y1="36" x2="66" y2="47" stroke={color} strokeWidth="6.5" strokeLinecap="round"/>
      <path d="M50 44 L50 58" stroke={color} strokeWidth="6" strokeLinecap="round"/>
      <path d="M44 64 Q50 68 56 64" stroke={color} strokeWidth="5.5" strokeLinecap="round" fill="none"/>
      <path d="M34 74 Q42 83 50 83 Q58 83 66 74" stroke={color} strokeWidth="6" strokeLinecap="round" fill="none"/>
    </svg>
  );

  // ── Face ID setup bottom sheet ─────────────────────────────────────────────
  if (showFaceIdSetup && pendingAuth) {
    const session = pendingAuth.session;
    const doEnroll = async () => {
      try {
        const beginRes = await fetch(`${WEBAUTHN_URL}/register/begin`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({jwt:session.access_token}) });
        if (!beginRes.ok) { console.log("[FaceID setup] begin failed:", beginRes.status); setShowFaceIdSetup(false); setAuth(pendingAuth); setPendingAuth(null); return; }
        const { options, challengeId } = await beginRes.json();
        options.challenge = b64ToU8(options.challenge);
        options.user.id = b64ToU8(options.user.id);
        options.pubKeyCredParams = (options.pubKeyCredParams||[]).filter(p=>p.alg!==-8);
        const credential = await navigator.credentials.create({ publicKey: options });
        const completeRes = await fetch(`${WEBAUTHN_URL}/register/complete`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ jwt:session.access_token, challengeId, deviceName:/iPhone|iPad/.test(navigator.userAgent)?"iPhone":"Device",
            credential:{ id:credential.id, rawId:u8ToB64url(credential.rawId), type:credential.type,
              response:{ attestationObject:u8ToB64url(credential.response.attestationObject), clientDataJSON:u8ToB64url(credential.response.clientDataJSON) } } })
        });
        const result = await completeRes.json();
        console.log("[FaceID setup] complete:", result);
        if (result.verified) localStorage.setItem("forknight_faceid_email", session.user.email);
      } catch(e) {
        console.log("[FaceID setup] error:", e.name, e.message);
      }
      // Re-fetch fresh auth data — retry for new users whose profile may still be creating
      let freshData = null;
      for (let i = 0; i < 4; i++) {
        try { freshData = await fetchAuthData(session); } catch {}
        if (freshData?.profile?.household_id) break;
        if (i < 3) await new Promise(r => setTimeout(r, 800));
      }
      setShowFaceIdSetup(false);
      setPendingAuth(null);
      // Use fresh data if available, otherwise fall back to pendingAuth
      // Never return false here — that sends user back to sign-in screen
      setAuth(freshData?.profile?.household_id ? freshData : pendingAuth);
    };

    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000,fontFamily:"system-ui,-apple-system,sans-serif"}}>
        <div style={{background:sc.card,borderRadius:"24px 24px 0 0",padding:"32px 24px 48px",width:"100%",maxWidth:480,boxShadow:"0 -8px 40px rgba(0,0,0,0.18)"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:20}}><FaceIdSvg size={64} color={sc.text}/></div>
          <h2 style={{fontSize:22,fontWeight:700,color:sc.text,textAlign:"center",margin:"0 0 10px",letterSpacing:"-0.4px"}}>Sign in faster with Face ID</h2>
          <p style={{fontSize:15,color:sc.muted,textAlign:"center",lineHeight:1.6,margin:"0 0 28px"}}>Skip the email next time. One look and you're in.</p>
          <button onClick={doEnroll} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:sc.text,color:sc.bg,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:12}}>Enable Face ID</button>
          <button onClick={()=>enterApp(pendingAuth)} style={{width:"100%",padding:"14px",borderRadius:14,border:`1.5px solid ${sc.border}`,background:"transparent",color:sc.muted,fontSize:14,fontWeight:600,cursor:"pointer"}}>Not now</button>
          <p style={{fontSize:12,color:sc.muted,textAlign:"center",marginTop:16}}>You can enable this later in Settings.</p>
        </div>
      </div>
    );
  }

  if (auth === null) return <LoadingScreen/>;
  if (!auth) return <ForknightAuth onAuthenticated={handleAuthenticated}/>;

  // If auth exists but profile/household not ready, show loading
  if (!auth.profile?.household_id) return <ForknightAuth onAuthenticated={handleAuthenticated}/>;

  // Derive isPremium: enabled + in preview, OR monetization live + paid tier
  const tier = auth.profile?.subscription_tier || "free";
  const hhId = auth.profile?.household_id || "";
  const inPreview = (auth.monetization?.preview || []).includes(hhId);
  const monetizationLive = auth.monetization?.enabled === true;
  const isPremium = inPreview || tier === "premium" || tier === "grandfathered" || !monetizationLive;
  const showPremiumUi = inPreview || monetizationLive;
  return (
    <App
      householdId={auth.profile.household_id}
      inviteCode={auth.inviteCode || ""}
      onSignOut={handleSignOut}
      householdMembers={auth.householdMembers || []}
      currentUserId={auth.session.user.id}
      subscriptionTier={tier}
      isPremium={isPremium}
      showPremiumUi={showPremiumUi}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);

