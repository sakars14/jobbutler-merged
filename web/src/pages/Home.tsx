import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

type UserProfile = {
  name?: string;
  fullName?: string;
};

export default function Home() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      if (!u) {
        setProfile(null);
        return;
      }

      (async () => {
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            setProfile(null);
          }
        } catch {
          setProfile(null);
        }
      })();
    });
    return () => unsub();
  }, []);

  const handleLetsBegin = () => {
    navigate("/login");
  };

  const handleFindJobsClick = () => {
    if (currentUser) {
      navigate("/dashboard");
    } else {
      navigate("/login");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } finally {
      navigate("/");
    }
  };

  const displayName =
    profile?.name || profile?.fullName || currentUser?.displayName || "User";

  return (
    <div className="landing">
      <div className="landing-grid">
        {/* LEFT: full image panel */}
        <div className="landing-left" />

        {/* RIGHT: hero content */}
        <div className="landing-right">
          {/* Top-right nav inside the white panel */}
          <header className="landing-header">
            <button type="button" onClick={handleFindJobsClick}>
              Find Jobs
            </button>
            <button
              type="button"
              onClick={() => navigate("/support")}
            >
              Support
            </button>
            {currentUser ? (
              <>
                <button
                  type="button"
                  className="signup-pill"
                  onClick={() => navigate("/signup")}
                >
                  {displayName}
                </button>
                <button
                  type="button"
                  className="dash-pill landing-pill"
                  onClick={handleSignOut}
                >
                  Sign out
                </button>
              </>
            ) : (
              <span className="signup-pill" onClick={() => navigate("/login")}>
                Log in
              </span>
            )}
          </header>

          <main className="landing-main">
            {/* Logo in the white space */}
            <img
              src="/media/logo_black.png"
              alt="Job Butler logo"
              className="landing-logo"
            />

            <div className="landing-eyebrow">Job Butler</div>
            <h1 className="landing-title">
              Transforming job search experience.
            </h1>

            <p className="landing-subtitle">
              Explore an extensive database of jobs from top companies, matched
              by AI to your skills, experience and preferences.
            </p>

            {/* Just the button, left-aligned under text */}
            <div className="landing-search-row">
              <button
                type="button"
                className="landing-search-button"
                onClick={handleLetsBegin}
              >
                Let&apos;s begin
              </button>
            </div>

            {/* Single-line footer: Connect with us  info@jobbutler.in */}
            <div className="landing-footer">
              <strong>Connect with us</strong>
              <span className="landing-footer-spacer" />
              <a href="mailto:info@jobbutler.in">info@jobbutler.in</a>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
