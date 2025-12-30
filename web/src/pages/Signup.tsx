// src/pages/Signup.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
} from "firebase/auth";
import type { ConfirmationResult, User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, getInvisibleVerifier } from "../firebase";
import { api } from "../lib/api";
import TagInput from "../components/TagInput";

const ROLE_SUGG = [
  "Data Analyst",
  "Senior Data Analyst",
  "Software Engineer",
  "Data Engineer",
  "Analytics Manager",
];
const SKILL_SUGG = [
  "SQL",
  "Python",
  "Tableau",
  "Power BI",
  "Pandas",
  "Pyspark",
  "GenAI",
  "LLMs",
];
const LOC_SUGG = ["India", "Remote", "Bangalore", "Pune", "Mumbai", "Delhi NCR"];

//type Step = "phone" | "profile";

export default function Signup() {
  const nav = useNavigate();
  const prefillDone = useRef(false);

  //const [step, setStep] = useState<Step>("phone");
  //const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // phone / otp
  //const [phone, setPhone] = useState("+91");
  //const [otpSent, setOtpSent] = useState(false);
  //const [otp, setOtp] = useState("");
  //const [authErr, setAuthErr] = useState<string | null>(null);
  //const [authLoading, setAuthLoading] = useState(false);
  //const confRef = useRef<ConfirmationResult | null>(null);

  // profile fields
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState(""); // YYYY-MM-DD
  const [profession, setProfession] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>(["India", "Remote"]);

  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedProfile, setSavedProfile] = useState<any | null>(null);

  const markEdited = () => {
    prefillDone.current = true;
  };

  const showLoginLink = !(currentUser || auth.currentUser);
  
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        // Not logged in – must verify phone first
        nav("/login");
      } else {
        setCurrentUser(u);
      }
    });
    return () => unsub();
  }, [nav]);

  useEffect(() => {
    if (!currentUser || prefillDone.current) return;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", currentUser.uid));
        if (!snap.exists()) return;
        if (prefillDone.current) return;

        const data = snap.data() as any;
        const address = data.address || {};
        const persona = data.persona || {};

        prefillDone.current = true;
        setFullName(data.fullName || data.name || "");
        setDob(data.dob || "");
        setProfession(data.profession || "");
        setEmail(data.email || "");
        setCity(address.city || "");
        setStateName(address.state || "");
        setPincode(address.pincode || "");
        setRoles(
          Array.isArray(persona.roles)
            ? persona.roles
            : Array.isArray(persona.roles_target)
            ? persona.roles_target
            : []
        );
        setSkills(
          Array.isArray(persona.skills)
            ? persona.skills
            : Array.isArray(persona.must_have)
            ? persona.must_have
            : []
        );
        setLocations(Array.isArray(persona.locations) ? persona.locations : []);
      } catch {
        // ignore prefill errors
      }
    })();
  }, [currentUser]);

  //const normalize = (raw: string) => {
  //  const v = raw.trim();
  //  if (v.startsWith("+")) return v;
  //  return `+91${v.replace(/^0+/, "")}`;
  //};

//   const handleSendOtp = async () => {
//     setAuthErr(null);
//     setAuthLoading(true);
//     try {
//       const verifier = getInvisibleVerifier("recaptcha-container-signup");
//       const conf = await signInWithPhoneNumber(
//         auth,
//         normalize(phone),
//         verifier
//       );
//       confRef.current = conf;
//       setOtpSent(true);
//     } catch (e: any) {
//       setAuthErr(`Firebase: ${e.message || e.code || e.toString()}`);
//     } finally {
//       setAuthLoading(false);
//     }
//   };

//   const handleVerifyOtp = async () => {
//     setAuthErr(null);
//     try {
//       const conf = confRef.current;
//       if (!conf) throw new Error("No OTP session. Please resend.");
//       await conf.confirm(otp.trim());
//       // onAuthStateChanged will advance us to profile step
//       setStep("profile");
//     } catch (e: any) {
//       setAuthErr(`Firebase: ${e.message || e.code || e.toString()}`);
//     }
//   };

  const handleSaveProfile = async () => {
    if (!currentUser) {
      setSaveErr("You are not signed in. Please verify your phone again.");
      return;
    }
    setSaveErr(null);
    setSaving(true);

    const uid = currentUser.uid;
    const profile = {
      uid,
      phoneNumber: currentUser.phoneNumber,
      fullName,
      dob,
      profession,
      email,
      address: {
        city,
        state: stateName,
        pincode,
      },
      persona: {
        roles,
        skills,
        locations,
      },
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    try {
      // 1) Save to Firestore
      await setDoc(doc(db, "users", uid), profile, { merge: true });

      // 2) Save persona to backend so job ranking keeps working
      const personaPayload = {
        name: uid,
        roles_target: roles,
        must_have: skills,
        locations,
      };
      await api.post("/persona", { uid, persona: personaPayload });

      setSavedProfile(profile);
      nav("/dashboard", { replace: true });
    } catch (e: any) {
      console.error("Save profile failed", e);
      setSaveErr(e.message || e.toString());
    } finally {
      setSaving(false);
    }
  };

  const handleGoToDashboard = () => {
    nav("/dashboard");
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      nav(-1);
    } else {
      nav("/dashboard");
    }
  };

  const handleRolesChange = (next: string[]) => {
    markEdited();
    setRoles(next);
  };

  const handleSkillsChange = (next: string[]) => {
    markEdited();
    setSkills(next);
  };

  const handleLocationsChange = (next: string[]) => {
    markEdited();
    setLocations(next);
  };
  //const showPhoneStep = step === "phone";

  return (
    <div className="page">
      <div className="auth-card">
        {/* header row similar to other pages */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
            <header className="signup-card-header">
                <button
                    type="button"
                    className="back-arrow"
                    onClick={handleBack}
                    aria-label="Back to home"
                >
                    ←
                </button>

                
                    {showLoginLink && (
                        <button
                            type="button"
                            className="signup-login-link"
                            onClick={() => nav("/login")}
                        >
                            Log in
                        </button>
                    )}
                
            </header>
        </div>

        <h1>Tell us about you</h1>
<p className="muted">
  Fill in your details and preferences so we can tailor job matches for you.
</p>


        {/* STEP 2: PROFILE + PERSONA */}
        
          <>
            <div className="grid" style={{ gap: 12 }}>
              <div className="stack">
                <label>Name</label>
                <input
                  value={fullName}
                  onChange={(e) => {
                    markEdited();
                    setFullName(e.target.value);
                  }}
                  placeholder="Your full name"
                />
              </div>

              <div className="stack">
                <label>Date of birth</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => {
                    markEdited();
                    setDob(e.target.value);
                  }}
                />
              </div>

              <div className="stack">
                <label>Profession</label>
                <input
                  value={profession}
                  onChange={(e) => {
                    markEdited();
                    setProfession(e.target.value);
                  }}
                  placeholder="e.g., Senior Data Analyst"
                />
              </div>

              <div className="stack">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    markEdited();
                    setEmail(e.target.value);
                  }}
                  placeholder="you@example.com"
                />
              </div>

              <div className="stack">
                <label>City</label>
                <input
                  value={city}
                  onChange={(e) => {
                    markEdited();
                    setCity(e.target.value);
                  }}
                />
              </div>

              <div className="stack">
                <label>State</label>
                <input
                  value={stateName}
                  onChange={(e) => {
                    markEdited();
                    setStateName(e.target.value);
                  }}
                />
              </div>

              <div className="stack">
                <label>Pincode</label>
                <input
                  value={pincode}
                  onChange={(e) => {
                    markEdited();
                    setPincode(e.target.value);
                  }}
                  inputMode="numeric"
                />
              </div>
            </div>

            {/* Persona tags */}
            <div style={{ marginTop: 16 }} />

            <TagInput
              label="Preferred roles"
              value={roles}
              onChange={handleRolesChange}
              suggestions={ROLE_SUGG}
              placeholder="e.g., Data Analyst, Software Engineer"
            />
            <TagInput
              label="Key skills"
              value={skills}
              onChange={handleSkillsChange}
              suggestions={SKILL_SUGG}
              placeholder="e.g., SQL, Python, GenAI"
            />
            <TagInput
              label="Preferred locations"
              value={locations}
              onChange={handleLocationsChange}
              suggestions={LOC_SUGG}
              placeholder="e.g., India, Remote"
            />

            {saveErr && <div className="error" style={{ marginTop: 8 }}>{saveErr}</div>}

            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="dash-pill auth-pill"
                onClick={handleSaveProfile}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save & go to dashboard"}
              </button>
              
            </div>

            {savedProfile && (
              <div
                className="card"
                style={{ marginTop: 16, background: "#fafafa" }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Saved details
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(savedProfile, null, 2)}
                </pre>
              </div>
            )}
          </>
        
      </div>
    </div>
  );
}
