import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { useBilling } from "../billing/BillingProvider";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 30000;

export default function InstamojoReturn() {
  const nav = useNavigate();
  const location = useLocation();
  const { billing } = useBilling();
  const [uid, setUid] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const planLabel = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const planParam = (params.get("plan") || "").toLowerCase();
    if (planParam === "3m" || planParam === "quarterly") return "Quarterly";
    if (planParam === "1m" || planParam === "monthly") return "Monthly";
    const pending = sessionStorage.getItem("jb_pending_plan");
    if (pending === "quarterly") return "Quarterly";
    if (pending === "monthly") return "Monthly";
    return null;
  }, [location.search]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        const next = `${location.pathname}${location.search}`;
        nav(`/login?next=${encodeURIComponent(next)}`, { replace: true });
        return;
      }
      setUid(u.uid);
    });
    return () => unsub();
  }, [location.pathname, location.search, nav]);

  useEffect(() => {
    if (!uid) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= MAX_POLL_MS) {
        setTimedOut(true);
        clearInterval(timer);
      }
      if (billing?.status === "active") {
        sessionStorage.removeItem("jb_pending_plan");
        sessionStorage.removeItem("jb_pending_started_at");
        nav("/signup?status=paid", { replace: true });
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [billing?.status, nav, uid]);

  return (
    <main className="page">
      <div className="auth-card">
        <h1>Payment received</h1>
        <p className="muted">Activating subscription...</p>
        {planLabel && (
          <div className="muted" style={{ marginTop: 8 }}>
            Plan: {planLabel}
          </div>
        )}
        {timedOut && (
          <div className="error" style={{ marginTop: 12 }}>
            Payment received, activation pending. Please contact support.
          </div>
        )}
      </div>
    </main>
  );
}
