import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { api } from "../lib/api";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 60000;

export default function InstamojoReturn() {
  const nav = useNavigate();
  const location = useLocation();
  const [uid, setUid] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { planValue, planLabel, paymentId, paymentRequestId } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const planParam = (params.get("plan") || "").toLowerCase();
    let resolvedPlan: "1m" | "3m" | null = null;
    if (planParam === "3m" || planParam === "quarterly") resolvedPlan = "3m";
    if (planParam === "1m" || planParam === "monthly") resolvedPlan = "1m";
    const pending = sessionStorage.getItem("jb_pending_plan");
    if (!resolvedPlan && pending === "quarterly") resolvedPlan = "3m";
    if (!resolvedPlan && pending === "monthly") resolvedPlan = "1m";
    const label =
      resolvedPlan === "3m"
        ? "Quarterly"
        : resolvedPlan === "1m"
          ? "Monthly"
          : null;
    const paymentIdParam =
      params.get("payment_id") || params.get("paymentId") || null;
    const paymentRequestIdParam = params.get("payment_request_id");
    return {
      planValue: resolvedPlan,
      planLabel: label,
      paymentId: paymentIdParam || paymentRequestIdParam || null,
      paymentRequestId: paymentRequestIdParam,
    };
  }, [location.search]);
  const paymentLabel = paymentId || "your payment";

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
    if (!paymentId) {
      setErrorMessage("Missing payment id. Please contact support.");
      return;
    }

    let active = true;
    const start = Date.now();

    const tick = async () => {
      if (!active) return;
      if (Date.now() - start >= MAX_POLL_MS) {
        setTimedOut(true);
        active = false;
        return;
      }

      try {
        const res = await api.post("/api/billing/instamojo/confirm", {
          uid,
          plan: planValue || undefined,
          payment_id: paymentId,
          payment_request_id: paymentRequestId || undefined,
        });
        const data = res.data;
        if (data?.ok) {
          sessionStorage.removeItem("jb_pending_plan");
          sessionStorage.removeItem("jb_pending_started_at");
          nav("/persona?status=paid", { replace: true });
          active = false;
          return;
        }
        if (data && data.pending) {
          return;
        }
        if (data?.error) {
          setErrorMessage(`Activation failed: ${data.error}`);
          active = false;
        }
      } catch (err: any) {
        setErrorMessage("Activation pending. Please contact support if needed.");
        active = false;
      }
    };

    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [nav, paymentId, paymentRequestId, planValue, uid]);

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
        {errorMessage && (
          <div className="error" style={{ marginTop: 12 }}>
            {errorMessage}
          </div>
        )}
        {timedOut && (
          <div className="error" style={{ marginTop: 12 }}>
            Activation pending for {paymentLabel}. Please contact support.
          </div>
        )}
      </div>
    </main>
  );
}
