import { Navigate } from "react-router-dom";
import { useBilling } from "../billing/BillingProvider";

export default function RequireSubscription({
  children,
}: {
  children: JSX.Element;
}) {
  const { loading, isBlocked } = useBilling();

  if (loading) {
    return (
      <main className="page">
        <div className="auth-card">Loading...</div>
      </main>
    );
  }

  if (isBlocked) {
    return <Navigate to="/subscribe" replace />;
  }

  return children;
}
