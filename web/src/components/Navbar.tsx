import { signOut, onAuthStateChanged } from "firebase/auth";
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { auth } from "../firebase";

export default function Navbar({ phone }: { phone?: string | null }) {
  const [authed, setAuthed] = useState(Boolean(auth.currentUser));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthed(Boolean(u));
    });
    return () => unsub();
  }, []);

  return (
    <div className="nav">
      <div className="nav-row">
        <div className="nav-left">
          <Link to="/" className="logo">
            <img src="/logo.svg" alt="Job Butler" />
            <span>Job Butler</span>
          </Link>
        </div>

        <div className="nav-center">
          <NavLink to="/" className="badge">Home</NavLink>
          <NavLink to="/about" className="badge">About</NavLink>
          <NavLink
            to={authed ? "/support" : "/login?next=/support"}
            className="badge"
          >
            Support
          </NavLink>
        </div>

        <div className="nav-right">
          <span className="muted">{phone || ""}</span>
          <button className="secondary" onClick={() => signOut(auth)}>Logout</button>
        </div>
      </div>
    </div>
  );
}
