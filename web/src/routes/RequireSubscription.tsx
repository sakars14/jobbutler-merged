import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useBilling } from "../billing/BillingProvider";

export default function RequireSubscription({
  children,
}: {
  children: ReactNode;
}) {
  const { loading, isAdmin, isPaidActive, isTrialActive } = useBilling();

  if (loading) {
    return (
      <main className="page">
        <div className="auth-card">Loading...</div>
      </main>
    );
  }

  if (isAdmin || isPaidActive || isTrialActive) return children;

  return <Navigate to="/subscribe" replace />;
}
