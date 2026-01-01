import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useBilling } from "../billing/BillingProvider";

export default function Subscribe() {
  const nav = useNavigate();
  const { loading, isAdmin, isBlocked } = useBilling();
  const [notice, setNotice] = useState<string | null>(null);

  const handleBack = async () => {
    if (isBlocked) {
      await signOut(auth);
      nav("/login", { replace: true });
      return;
    }
    if (window.history.length > 1) {
      nav(-1);
    } else {
      nav("/dashboard");
    }
  };

  const handleSubscribe = () => {
    if (isAdmin) {
      nav("/dashboard");
      return;
    }
    setNotice("Payment integration coming next.");
  };

  return (
    <main className="page">
      <div className="auth-card">
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
              aria-label="Back to dashboard"
            >
              &lt;
            </button>
          </header>
        </div>

        <h1>Subscribe</h1>
        <p className="muted">
          Unlock full access with a 3 month plan designed for active job seekers.
        </p>

        {loading ? (
          <div className="dash-muted">Loading billing status...</div>
        ) : (
          <div className="dash-tile" style={{ marginTop: 12 }}>
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Pro Plan</h3>
              <span className="dash-status ok">₹1,199 / 3 months</span>
            </div>

            <ul style={{ marginTop: 12, paddingLeft: 18 }}>
              <li>Curated job shortlists matched to your persona</li>
              <li>Gmail-powered job alerts with clean deduping</li>
              <li>AI-assisted ranking so you focus on best-fit roles</li>
              <li>Faster applications with top contender signals</li>
              <li>Centralized dashboard for roles, skills, and locations</li>
            </ul>

            <div className="dash-actions" style={{ marginTop: 16 }}>
              <button
                className="dash-pill"
                type="button"
                onClick={handleSubscribe}
              >
                Subscribe
              </button>
            </div>
            {notice && <div className="dash-muted">{notice}</div>}
          </div>
        )}
      </div>
    </main>
  );
}
