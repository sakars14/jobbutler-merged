import { signOut } from "firebase/auth";
import { Link, NavLink } from "react-router-dom";
import { auth } from "../firebase";

export default function Navbar({ phone }: { phone?: string | null }) {
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
          <NavLink to="/support" className="badge">Support</NavLink>
        </div>

        <div className="nav-right">
          <span className="muted">{phone || ""}</span>
          <button className="secondary" onClick={() => signOut(auth)}>Logout</button>
        </div>
      </div>
    </div>
  );
}
