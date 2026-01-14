import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { isAdminPhone } from "../utils/isAdmin";

type AdminState = {
  loading: boolean;
  isAdmin: boolean;
  isLoggedIn: boolean;
};

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState>({
    loading: true,
    isAdmin: false,
    isLoggedIn: false,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setState({
        loading: false,
        isAdmin: isAdminPhone(u?.phoneNumber),
        isLoggedIn: Boolean(u),
      });
    });
    return () => unsub();
  }, []);

  if (state.loading) {
    return (
      <main className="page">
        <div className="auth-card">Loading...</div>
      </main>
    );
  }

  if (!state.isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!state.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
