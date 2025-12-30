import { useEffect, useState } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

import Nav from "./components/Nav";
import Landing from "./components/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Support from "./pages/Support";
import HowItWorks from "./pages/HowItWorks";

/** Gate a page behind auth */
type RequireAuthProps = {
  user: User | null;
  children: React.ReactElement;
};
function RequireAuth({ user, children }: RequireAuthProps) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
    return () => unsub();
  }, []);

  if (!ready) {
    // optional tiny splash
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  const router = createBrowserRouter([
    {
      path: "/",
      element: (
        <>
          <Nav />
          <Landing />
        </>
      ),
    },
    {
      path: "/login",
      element: (
        <>
          <Nav />
          <Login />
        </>
      ),
    },
    {
      path: "/how-it-works",
      element: (
        <>
          <Nav />
          <HowItWorks />
        </>
      ),
    },
    {
      path: "/support",
      element: (
        <>
          <Nav />
          <Support />
        </>
      ),
    },
    {
      path: "/dashboard",
      element: (
        <>
          <Nav />
          <RequireAuth user={user}>
            <Dashboard user={user as User} />
          </RequireAuth>
        </>
      ),
    },
    {
      path: "*",
      element: (
        <>
          <Nav />
          <div style={{ padding: 24 }}>404 Not Found</div>
        </>
      ),
    },
  ]);

  return <RouterProvider router={router} />;
}
