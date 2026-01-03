import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useBilling } from "../billing/BillingProvider";

const MONTHLY_PRICE = 599;
const QUARTERLY_PRICE = 1199;
const ONBOARDING_PATH = "/signup";

const calcSavePct = () => {
  const full = MONTHLY_PRICE * 3;
  const save = full - QUARTERLY_PRICE;
  return Math.round((save / full) * 100);
};

const PriceLine = ({ amount, suffix }: { amount: string; suffix: string }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
    <div style={{ fontSize: 44, fontWeight: 700 }}>{amount}</div>
    <div style={{ paddingBottom: 4, fontSize: 16, color: "#6b7280" }}>
      {suffix}
    </div>
  </div>
);

export default function Subscribe() {
  const navigate = useNavigate();
  const {
    loading,
    isAdmin,
    isBlocked,
    isTrialUsed,
    startTrialOnce,
  } = useBilling();
  const [period, setPeriod] = useState<"monthly" | "quarterly">("quarterly");
  const [notice, setNotice] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  const savePct = useMemo(() => calcSavePct(), []);
  const monthlyUrl = import.meta.env.VITE_INSTAMOJO_MONTHLY_URL as
    | string
    | undefined;
  const quarterlyUrl = import.meta.env.VITE_INSTAMOJO_QUARTERLY_URL as
    | string
    | undefined;
  const payUrl = period === "monthly" ? monthlyUrl : quarterlyUrl;
  const priceAmount =
    period === "monthly" ? `₹${MONTHLY_PRICE}` : `₹${QUARTERLY_PRICE}`;
  const priceSuffix = period === "monthly" ? "/ mo" : "/ 3 mo";
  const trialBtnDisabled = isTrialUsed || isBlocked || loading;
  const payUrlMissing = !payUrl;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    navigate("/dashboard", { replace: true });
  }, [isAdmin, navigate]);

  const handleBack = async () => {
    if (isBlocked) {
      await signOut(auth);
      navigate("/login", { replace: true });
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/dashboard");
    }
  };

  const onStartTrial = async () => {
    if (isAdmin) {
      navigate("/dashboard");
      return;
    }
    if (!uid) {
      navigate("/login");
      return;
    }
    setNotice(null);
    const res = await startTrialOnce(uid);
    if (res === "already_used") {
      setNotice("Trial already used. Please choose a plan to continue.");
      return;
    }
    navigate(`${ONBOARDING_PATH}?next=/dashboard`, { replace: true });
  };

  const onPay = () => {
    if (!payUrl) {
      setNotice("Payment URL not configured yet.");
      return;
    }
    window.open(payUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="page">
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <button
              type="button"
              className="back-arrow"
              onClick={handleBack}
              aria-label="Back"
            >
              &lt;
            </button>
            <h1 style={{ fontSize: 40, margin: "6px 0 6px" }}>
              Pick your best price
            </h1>
            <p className="section-subtitle">
              Start with a 2-day trial or unlock full access.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              background: "#fff",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: period === "monthly" ? "#0b1020" : "rgba(0,0,0,0.35)",
              }}
            >
              Monthly
            </span>
            <button
              type="button"
              onClick={() =>
                setPeriod(period === "monthly" ? "quarterly" : "monthly")
              }
              aria-label="Toggle billing period"
              style={{
                position: "relative",
                width: 54,
                height: 28,
                borderRadius: 999,
                border: "none",
                background: "#0b1020",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: period === "monthly" ? 4 : 26,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s ease",
                }}
              />
            </button>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: period === "quarterly" ? "#0b1020" : "rgba(0,0,0,0.35)",
              }}
            >
              Quarterly
            </span>
            {period === "quarterly" && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#0b1020",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "4px 10px",
                }}
              >
                Save {savePct}% OFF
              </span>
            )}
          </div>
        </header>

        <div
          style={{
            marginTop: 32,
            display: "grid",
            gap: 20,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <section
            style={{
              borderRadius: 24,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              padding: 28,
              background: "#fff",
              boxShadow: "0 14px 40px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>2-day trial</div>
            <PriceLine amount="₹0" suffix="/ 2 days" />
            <button
              type="button"
              onClick={onStartTrial}
              disabled={trialBtnDisabled}
              style={{
                marginTop: 16,
                width: "100%",
                borderRadius: 999,
                padding: "12px 18px",
                border: "none",
                fontWeight: 600,
                cursor: trialBtnDisabled ? "not-allowed" : "pointer",
                background: trialBtnDisabled ? "#f3f4f6" : "#0b1020",
                color: trialBtnDisabled ? "rgba(0,0,0,0.4)" : "#fff",
              }}
            >
              {isTrialUsed ? "Trial already used" : "Start 2-day trial"}
            </button>
            <div
              style={{
                marginTop: 18,
                borderTop: "1px solid rgba(15, 23, 42, 0.08)",
                paddingTop: 16,
                display: "grid",
                gap: 10,
                color: "rgba(0,0,0,0.65)",
                fontSize: 13,
              }}
            >
              <div>Full access for 48 hours</div>
              <div>Persona-based job shortlists</div>
              <div>Gmail sync + clean deduped alerts</div>
              <div>Fast dashboard experience</div>
            </div>
          </section>

          <section
            style={{
              borderRadius: 24,
              border: "1px solid #0b1020",
              padding: 28,
              background: "#fff",
              boxShadow: "0 18px 50px rgba(0,0,0,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  Full access
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.5)" }}>
                  For serious job seekers
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#0b1020",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "4px 10px",
                }}
              >
                Popular
              </span>
            </div>

            <div style={{ marginTop: 10 }}>
              <PriceLine amount={priceAmount} suffix={priceSuffix} />
            </div>

            <button
              type="button"
              onClick={onPay}
              disabled={loading || payUrlMissing}
              style={{
                marginTop: 16,
                width: "100%",
                borderRadius: 999,
                padding: "12px 18px",
                border: "none",
                fontWeight: 600,
                cursor: loading || payUrlMissing ? "not-allowed" : "pointer",
                background: payUrlMissing ? "#e5e7eb" : "#0b1020",
                color: payUrlMissing ? "rgba(0,0,0,0.45)" : "#fff",
              }}
            >
              Subscribe
            </button>

            <div
              style={{
                marginTop: 18,
                borderTop: "1px solid rgba(15, 23, 42, 0.08)",
                paddingTop: 16,
                display: "grid",
                gap: 10,
                color: "rgba(0,0,0,0.65)",
                fontSize: 13,
              }}
            >
              <div>Curated job shortlists</div>
              <div>AI match signals</div>
              <div>Gmail-powered alerts</div>
              <div>Role, skill, and location filters</div>
              <div>Faster sync and dedupe</div>
              <div>Priority support (soon)</div>
            </div>

            <p
              style={{
                marginTop: 14,
                fontSize: 11,
                color: "rgba(0,0,0,0.4)",
              }}
            >
              Note: Automatic activation will be enabled when webhooks are
              turned on.
            </p>
          </section>
        </div>

        {(payUrlMissing || notice) && (
          <div className="dash-muted" style={{ marginTop: 16 }}>
            {notice || "Payment URL not configured yet."}
          </div>
        )}
      </div>
    </main>
  );
}
