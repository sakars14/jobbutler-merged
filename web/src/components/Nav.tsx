import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import "./styles.css"; // ← Single global import here
export default function Nav() {
  const { pathname } = useLocation();
  const [authed, setAuthed] = useState(Boolean(auth.currentUser));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthed(Boolean(u));
    });
    return () => unsub();
  }, []);

  return (
    <header className="nav">
      <div className="nav-inner">
        {/* Brand: plain text, clickable to home */}
        <Link to="/" className="brand" aria-label="Go to home">
          Job Butler
        </Link>

        <nav className="nav-links">
          {/* Product removed (no page yet) */}
          <NavLink
            to="/how-it-works"
            className={({ isActive }) => (isActive ? "link active" : "link")}
          >
            How it works
          </NavLink>
          <NavLink
            to={authed ? "/support" : "/login?next=/support"}
            className={({ isActive }) => (isActive ? "link active" : "link")}
          >
            Support
          </NavLink>
        </nav>

        <div className="nav-cta">
          {pathname === "/login" ? (
            <Link to="/" className="btn pill">
              Home
            </Link>
          ) : (
            <Link to="/login" className="btn pill dark">
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
