import { Link, NavLink, useLocation } from "react-router-dom";
import "./styles.css"; // ← Single global import here
export default function Nav() {
  const { pathname } = useLocation();

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
            to="/support"
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
