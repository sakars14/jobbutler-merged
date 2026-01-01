// src/pages/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useBilling } from "../billing/BillingProvider";

type PersonaShape = {
  roles_target?: string[];
  must_have?: string[];
  locations?: string[];
  roles?: string[];
  skills?: string[];
};

type UserProfile = {
  name?: string;
  fullName?: string;
  persona?: PersonaShape;
};

type Job = {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  source?: string;
  url?: string;
  created_at?: string;
  posted_at?: string;
  description?: string;
  summary?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function Dashboard() {
  const nav = useNavigate();
  const location = useLocation();
  const { loading: billingLoading, isAdmin, isSubscribed, isTrialActive } = useBilling();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
    // Dashboard filters (client-side)
    const [recencyDays, setRecencyDays] = useState<number | "all">("all");
    const [locationFilter, setLocationFilter] = useState("");
    const [roleMatchOnly, setRoleMatchOnly] = useState(false);
    const [skillsMatchOnly, setSkillsMatchOnly] = useState(false);
    const [q, setQ] = useState("");
  
  const [jobsErr, setJobsErr] = useState<string | null>(null);

  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [gmailStatusLoading, setGmailStatusLoading] = useState(true);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [gmailRedirecting, setGmailRedirecting] = useState(false);
  const [gmailHarvesting, setGmailHarvesting] = useState(false);
  const [gmailErr, setGmailErr] = useState<string | null>(null);
  const [gmailSyncInfo, setGmailSyncInfo] = useState<{
    lastSyncAt: number;
    inserted: number;
  } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const gmailHarvestedRef = useRef(false);

  // Auth guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUid(null);
        nav("/login", { replace: true });
        return;
      }
      setUid(u.uid);
    });
    return () => unsub();
  }, [nav]);

  // Load profile (for name + persona)
  useEffect(() => {
    (async () => {
      if (!uid) return;

      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (snap.exists()) setProfile(snap.data() as UserProfile);
      } catch {
        // keep UI working even if profile fails
      }
    })();
  }, [uid]);

  const loadJobs = useCallback(async (userId: string) => {
    const u = auth.currentUser;
    setJobsLoading(true);
    setJobsErr(null);
    if (!u) {
      setJobsLoading(false);
      return;
    }

    try {
      const token = await u.getIdToken();
      const res = await fetch(`${API_BASE}/jobs?uid=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Jobs API failed (${res.status})`);
      const data = await res.json();

      // supports multiple shapes: {items:[]}, {jobs:[]}, [] directly
      const items: Job[] = Array.isArray(data) ? data : (data.items || data.jobs || []);
      setJobs(items);
    } catch (e: any) {
      setJobsErr(e?.message || "Failed to load jobs");
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const loadGmailStatus = useCallback(async (userId: string) => {
    const u = auth.currentUser;
    setGmailStatusLoading(true);
    if (!u) {
      setGmailConnected(false);
      setGmailEmail(null);
      setGmailStatusLoading(false);
      return;
    }
    try {
      const token = await u.getIdToken();
      const res = await fetch(`${API_BASE}/auth/gmail/status?uid=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setGmailConnected(false);
        setGmailEmail(null);
        return;
      }
      const data = await res.json();
      setGmailConnected(Boolean(data?.connected));
      setGmailEmail(data?.email || null);
    } catch {
      setGmailConnected(false);
      setGmailEmail(null);
    } finally {
      setGmailStatusLoading(false);
    }
  }, []);

  // Load jobs (UI shell: if your endpoint differs, adjust URL only)
  useEffect(() => {
    if (!uid) return;
    loadJobs(uid);
  }, [uid, loadJobs]);

  // Gmail status (optional UI shell)
  useEffect(() => {
    if (!uid) return;
    loadGmailStatus(uid);
  }, [uid, loadGmailStatus]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("gmail") !== "connected") return;
    if (!uid) return;
    if (!auth.currentUser) return;
    if (gmailHarvestedRef.current) return;

    gmailHarvestedRef.current = true;

    (async () => {
      const u = auth.currentUser;
      if (!u) return;

      setGmailHarvesting(true);
      setGmailErr(null);

      try {
        const token = await u.getIdToken();
        const res = await fetch(`${API_BASE}/harvest/gmail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uid, max_messages: 50 }),
        });

        if (!res.ok) throw new Error(`Gmail harvest failed (${res.status})`);
        const data = await res.json();
        const inserted = Number(data?.inserted ?? 0);
        setGmailSyncInfo({ lastSyncAt: Date.now(), inserted });

        await loadJobs(uid);
        await loadGmailStatus(uid);
      } catch (e: any) {
        setGmailErr(e?.message || "Gmail harvest failed");
      } finally {
        setGmailHarvesting(false);
        const nextParams = new URLSearchParams(location.search);
        nextParams.delete("gmail");
        const nextSearch = nextParams.toString();
        nav(
          {
            pathname: location.pathname,
            search: nextSearch ? `?${nextSearch}` : "",
          },
          { replace: true }
        );
      }
    })();
  }, [location.pathname, location.search, nav, uid, loadJobs, loadGmailStatus]);

  const displayName = useMemo(() => {
    return profile?.name || profile?.fullName || "User";
  }, [profile]);

  const persona = useMemo(() => {
    const p = profile?.persona;
    if (!p) return null;

    const roles = p.roles_target || p.roles || [];
    const skills = p.must_have || p.skills || [];
    const locations = p.locations || [];
    return { roles, skills, locations };
  }, [profile]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut(auth);
    } finally {
      setSigningOut(false);
      nav("/", { replace: true });
    }
  };

  const handleConnectGmail = async () => {
    if (!uid) {
      nav("/login");
      return;
    }
    const u = auth.currentUser;
    if (!u) {
      setGmailErr("Please sign in again to connect Gmail.");
      return;
    }

    setGmailRedirecting(true);
    setGmailErr(null);

    try {
      const token = await u.getIdToken();
      const res = await fetch(`${API_BASE}/auth/gmail/start?uid=${encodeURIComponent(uid)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) throw new Error(`Gmail auth start failed (${res.status})`);
      const data = await res.json();
      if (!data?.auth_url) throw new Error("Gmail auth URL missing");
      window.location.assign(data.auth_url);
    } catch (e: any) {
      setGmailErr(e?.message || "Failed to start Gmail connect");
      setGmailRedirecting(false);
    }
  };

  const handleSyncGmail = async () => {
    if (!uid) {
      nav("/login");
      return;
    }
    const u = auth.currentUser;
    if (!u) {
      setGmailErr("Please sign in again to sync Gmail.");
      return;
    }

    setGmailHarvesting(true);
    setGmailErr(null);

    try {
      const token = await u.getIdToken();
      const res = await fetch(`${API_BASE}/harvest/gmail`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid, max_messages: 50 }),
      });

      if (!res.ok) throw new Error(`Gmail harvest failed (${res.status})`);
      const data = await res.json();
      const inserted = Number(data?.inserted ?? 0);
      setGmailSyncInfo({ lastSyncAt: Date.now(), inserted });

      await loadJobs(uid);
      await loadGmailStatus(uid);
    } catch (e: any) {
      setGmailErr(e?.message || "Gmail harvest failed");
    } finally {
      setGmailHarvesting(false);
    }
  };

  const filteredJobs = useMemo(() => {
    const now = Date.now();
    const norm = (s: string) => s.toLowerCase();
    const normTokens = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const needle = norm(q.trim());
    const locNeedle = norm(locationFilter.trim());
    const personaSkills = persona?.skills || [];

    return jobs.filter((j) => {
      const title = norm(j.title ?? "");
      const company = norm(j.company ?? "");
      const location = norm(j.location ?? "");

      // free-text search across common fields
      if (
        needle &&
        !(title.includes(needle) ||
          company.includes(needle) ||
          location.includes(needle))
      ) {
        return false;
      }

      if (locNeedle && !location.includes(locNeedle)) return false;

      if (recencyDays !== "all") {
        const dtRaw = j.posted_at ?? j.created_at;
        const t = dtRaw ? new Date(dtRaw).getTime() : NaN;

        // if date missing/invalid, don't block the row
        if (Number.isFinite(t)) {
          const maxAgeMs = recencyDays * 24 * 60 * 60 * 1000;
          if (now - t > maxAgeMs) return false;
        }
      }

      if (roleMatchOnly && persona?.roles?.length) {
        const ok = persona.roles.some((r) => title.includes(norm(r)));
        if (!ok) return false;
      }

      if (skillsMatchOnly) {
        if (!personaSkills.length) return false;

        const primaryText = j.description || j.summary || j.title;
        const fallbackText = [j.title, j.company, j.location]
          .filter(Boolean)
          .join(" ");
        const haystack = ` ${normTokens(primaryText || fallbackText)} `;

        const ok = personaSkills.some((skill) => {
          const token = normTokens(skill);
          if (!token) return false;
          return haystack.includes(` ${token} `);
        });
        if (!ok) return false;
      }

      return true;
    });
  }, [jobs, q, locationFilter, recencyDays, roleMatchOnly, skillsMatchOnly, persona]);

  const showTrialBanner =
    !billingLoading && isTrialActive && !isSubscribed && !isAdmin;

  return (
    <div className="dash-page">
      <div className="dash-card">
        {showTrialBanner && (
          <button
            type="button"
            className="dash-banner"
            onClick={() => nav("/subscribe")}
            style={{
              width: "100%",
              textAlign: "left",
              marginBottom: 16,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #f2d18c",
              background: "#fff4dc",
              color: "#2f2f2f",
              cursor: "pointer",
            }}
          >
            2-day trial has started. Click here to subscribe to stay connected.
          </button>
        )}
        {/* Card Top Bar */}
        <header className="dash-header">
          <div className="dash-header-right" style={{ marginLeft: "auto" }}>
            <button className="dash-link" type="button" onClick={() => nav("/")}>
              Home
            </button>
            <button className="dash-link" type="button" onClick={() => nav("/support")}>
              Support
            </button>

            <button className="dash-user" type="button" onClick={() => nav("/signup")}>
              {displayName}
            </button>

            <button
              className="dash-pill"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-disabled={signingOut}
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>

        {/* Title */}
        <section className="dash-hero">
          <div className="dash-hero-left">
            <div className="dash-kicker">Dashboard</div>
            <h1 className="dash-title">Job Butler</h1>
            <p className="dash-subtitle">AI Powered smart job matching workspace.</p>
          </div>
        </section>

        {/* 4 cards */}
        <section className="dash-tiles">
          {/* Persona */}
          <div className="dash-tile">
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Persona</h3>
              <button className="dash-mini" type="button" onClick={() => nav("/signup")}>
                Edit
              </button>
            </div>

            {!persona ? (
              <p className="dash-muted">No persona found yet. Click Edit.</p>
            ) : (
              <>
                <div className="dash-group">
                  <div className="dash-group-label">Roles</div>
                  <div className="dash-chips">
                    {persona.roles.slice(0, 6).map((x) => (
                      <span key={x} className="dash-chip">{x}</span>
                    ))}
                  </div>
                </div>

                <div className="dash-group">
                  <div className="dash-group-label">Skills</div>
                  <div className="dash-chips">
                    {persona.skills.slice(0, 6).map((x) => (
                      <span key={x} className="dash-chip">{x}</span>
                    ))}
                  </div>
                </div>

                <div className="dash-group">
                  <div className="dash-group-label">Locations</div>
                  <div className="dash-chips">
                    {persona.locations.slice(0, 6).map((x) => (
                      <span key={x} className="dash-chip">{x}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Gmail */}
          <div className="dash-tile">
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Gmail</h3>
              <span className={`dash-status ${gmailConnected ? "ok" : "warn"}`}>
                {gmailStatusLoading ? "Checking..." : gmailConnected ? "Connected" : "Not connected"}
              </span>
            </div>

            <p className="dash-muted">
              Connect Gmail to generate job alerts from your inbox. Sync might take 1-2 minutes to reflect.
            </p>
            {gmailConnected && gmailEmail && (
              <div className="dash-muted">Connected as {gmailEmail}</div>
            )}
            {gmailSyncInfo && (
              <div className="dash-muted">
                Last sync: {new Date(gmailSyncInfo.lastSyncAt).toLocaleString()} • Imported:{" "}
                {gmailSyncInfo.inserted}
              </div>
            )}

            <div className="dash-actions">
              {gmailConnected ? (
                <button
                  className="dash-pill"
                  type="button"
                  onClick={handleSyncGmail}
                  disabled={gmailHarvesting}
                >
                  {gmailHarvesting ? "Syncing..." : "Sync"}
                </button>
              ) : (
                <button
                  className="dash-pill"
                  type="button"
                  onClick={handleConnectGmail}
                  disabled={gmailRedirecting}
                >
                  {gmailRedirecting ? "Redirecting..." : "Connect"}
                </button>
              )}
            </div>
            {gmailHarvesting && (
              <div className="dash-muted">Syncing Gmail alerts...</div>
            )}
            {gmailErr && <div className="dash-error">{gmailErr}</div>}
          </div>

          <div className="dash-tile">
            <div className="dash-tile-title">Filters</div>

            <div className="dash-filter-grid">
              <label className="dash-filter-label">
                Recency
                <select
                  className="dash-filter-select"
                  value={recencyDays}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRecencyDays(v === "all" ? "all" : Number(v));
                  }}
                >
                  <option value="all">All</option>
                  <option value="1">Last 24h</option>
                  <option value="7">Last 7d</option>
                  <option value="30">Last 30d</option>
                </select>
              </label>

              <label className="dash-filter-label">
                Location
                <input
                  className="dash-filter-input"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  placeholder="e.g., Bangalore"
                />
              </label>

              <label className="dash-filter-toggle">
                <input
                  type="checkbox"
                  checked={roleMatchOnly}
                  onChange={(e) => setRoleMatchOnly(e.target.checked)}
                />
                Role match only
              </label>

              <label className="dash-filter-toggle">
                <input
                  type="checkbox"
                  checked={skillsMatchOnly}
                  onChange={(e) => setSkillsMatchOnly(e.target.checked)}
                />
                Skills match only
              </label>

              <label className="dash-filter-label dash-filter-span2">
                Search
                <input
                  className="dash-filter-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="title / company / location"
                />
              </label>
            </div>
          </div>


          {/* Alerts 
          <div className="dash-tile">
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Job Alerts</h3>
            </div>

            <div className="dash-chips">
              <span className="dash-chip">From Gmail Alerts</span>
              <span className="dash-chip">Daily digest</span>
            </div>

            <p className="dash-muted" style={{ marginTop: 10 }}>
              (Step 3) We’ll remove/merge extras cleanly.
            </p>
          </div>*/}
        </section>

        {/* Jobs table */}
        <section className="dash-jobs">
          <div className="dash-jobs-head">
            <h2 className="dash-jobs-title">Jobs</h2>
          </div>

          {jobsLoading ? (
            <div className="dash-muted">Loading jobs…</div>
          ) : jobsErr ? (
            <div className="dash-error">{jobsErr}</div>
          ) : jobs.length === 0 ? (
            <div className="dash-muted">No jobs to show yet.</div>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((j, idx) => (
                    <tr key={String(j.id ?? idx)}>
                      <td className="dash-td-strong">{j.title || "-"}</td>
                      <td>{j.company || "-"}</td>
                      <td>{j.location || "-"}</td>
                      <td>
                        {j.url ? (
                          <a className="dash-a" href={j.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
