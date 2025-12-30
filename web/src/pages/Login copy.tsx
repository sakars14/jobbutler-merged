// src/pages/Login.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
  RecaptchaVerifier,
} from "firebase/auth";
import { auth, getInvisibleVerifier } from "../firebase";

export default function Login() {
  const nav = useNavigate();
  const [phone, setPhone] = useState("+91"); // auto-prefix India
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const confirmationRef = useRef<import("firebase/auth").ConfirmationResult | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) nav("/dashboard", { replace: true });
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
      const conf = await signInWithPhoneNumber(auth, normalize(phone), verifier);
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
      nav("/dashboard", { replace: true });
    } catch (e: any) {
      setErr(`Firebase: ${e.message || e.code || e.toString()}`);
    }
  };
  
  return (
    <div className="page">
      <div className="auth-card">
        <h1>Welcome back!</h1>
        <p className="muted">Sign in with your mobile number to continue.</p>

        <label>Phone</label>
        <input
          value={phone}
          onChange={(e) => {
            // Keep +91 prefix
            const v = e.target.value;
            if (!v.startsWith("+91")) setPhone("+91" + v.replace(/^\+?/, "").replace(/^91/, ""));
            else setPhone(v);
          }}
          placeholder="+91XXXXXXXXXX"
          inputMode="tel"
        />
        {!otpSent ? (
          <button onClick={handleSend} className="btn wide">Send OTP</button>
        ) : (
          <>
            <label>Enter OTP</label>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" />
            <button onClick={handleVerify} className="btn wide">Verify & Continue</button>
          </>
        )}

        {err && <div className="error">{err}</div>}

        {/* Invisible verifier target */}
        <div id="recaptcha-container" />
      </div>
    </div>
  );
}
