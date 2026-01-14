import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";

export default function RequireAuth({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(Boolean(auth.currentUser));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthed(Boolean(u));
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!ready) {
    return (
      <main className="page">
        <div className="auth-card">Loading...</div>
      </main>
    );
  }

  if (authed) return children;

  return <Navigate to="/login?next=/support" replace />;
}
