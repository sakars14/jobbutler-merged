// src/pages/Login.tsx
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import type { User } from "firebase/auth";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
} from "firebase/auth";
import { auth, getInvisibleVerifier } from "../firebase";

export default function Login() {
  const nav = useNavigate();
  const [phone, setPhone] = useState("+91"); // auto-prefix India
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const confirmationRef =
    useRef<import("firebase/auth").ConfirmationResult | null>(null);

    const routeAfterLogin = async (u: User) => {
      try {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
    
        if (snap.exists()) {
          // Existing user – profile present
          nav("/dashboard", { replace: true });
        } else {
          // New user – send to signup details page
          nav("/signup", { replace: true });
        }
      } catch (e) {
        console.error("routeAfterLogin failed", e);
        // Safe fallback: at least let them in
        nav("/dashboard", { replace: true });
      }
    }; 

    useEffect(() => {
      const unsub = onAuthStateChanged(auth, (u) => {
        if (u) {
          // Decide where to send them based on profile existence
          routeAfterLogin(u);
        }
      });
      return () => unsub();
    }, [nav]);
    

  const normalize = (raw: string) => {
    const v = raw.trim();
    if (v.startsWith("+")) return v;
    return `+91${v.replace(/^0+/, "")}`;
  };

  const handleSend = async () => {
    setErr(null);
    try {
      // Ensure verifier exists (invisible)
      const verifier = getInvisibleVerifier("recaptcha-container");
      const conf = await signInWithPhoneNumber(
        auth,
        normalize(phone),
        verifier
      );
      confirmationRef.current = conf;
      setOtpSent(true);
    } catch (e: any) {
      setErr(`Firebase: ${e.message || e.code || e.toString()}`);
    }
  };

  const handleVerify = async () => {
    setErr(null);
    try {
      const conf = confirmationRef.current;
      if (!conf) throw new Error("No OTP session. Please resend.");
      await conf.confirm(otp.trim());
      // Do NOT navigate here.
      // onAuthStateChanged will fire and call routeAfterLogin(u)
    } catch (e: any) {
      setErr(`Firebase: ${e.message || e.code || e.toString()}`);
    }
  }; 

  return (
    <div className="page">
      <div className="auth-card">
        {/* 🔙 Small back arrow to go home */}
        <button
  type="button"
  className="back-arrow"
  onClick={() => nav("/")}
  aria-label="Back to home"
>
  ←
</button>

        <h1>Welcome back!</h1>
        <p className="muted">Sign in with your mobile number to continue.</p>

        <label>Phone</label>
        <input
          value={phone}
          onChange={(e) => {
            // Keep +91 prefix
            const v = e.target.value;
            if (!v.startsWith("+91"))
              setPhone(
                "+91" + v.replace(/^\+?/, "").replace(/^91/, "")
              );
            else setPhone(v);
          }}
          placeholder="+91XXXXXXXXXX"
          inputMode="tel"
        />

        {!otpSent ? (
          <button onClick={handleSend} className="btn wide">
            Send OTP
          </button>
        ) : (
          <>
            <label>Enter OTP</label>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
            />
            <button onClick={handleVerify} className="btn wide">
              Verify &amp; Continue
            </button>
          </>
        )}

        {err && <div className="error">{err}</div>}

        {/* Invisible verifier target */}
        <div id="recaptcha-container" />
      </div>
    </div>
  );
}
