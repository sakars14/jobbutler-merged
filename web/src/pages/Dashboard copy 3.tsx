// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { api } from "../lib/api";
import TagInput from "../components/TagInput";

import { useNavigate } from "react-router-dom";
import axios from "axios";

/** Suggestions for TagInput */
const ROLE_SUGG = [
  "Data Analyst",
  "Senior Data Analyst",
  "Analytics Manager",
  "AI Strategist",
  "Product Analytics",
  "ML Ops",
];
const SKILL_SUGG = [
  "SQL",
  "Python",
  "Tableau",
  "Power BI",
  "Pyspark",
  "GenAI",
  "LLMs",
  "NLP",
];
const LOC_SUGG = [
  "India",
  "Remote",
  "US",
  "EU",
  "Bangalore",
  "Hyderabad",
  "Delhi NCR",
];

type JobRow = {
  title: string;
  company?: string;
  location?: string;
  source?: string;
  url: string;
  _score?: number;
  _why?: string[];
};

type GmailStatus = {
  connected: boolean;
  email?: string;
  token_expiry?: number;
  has_refresh_token?: boolean;
};

function sourceLabel(source?: string): string {
  if (!source) return "unknown";

  if (source.startsWith("naukri_email") || source.startsWith("linkedin_email")) {
    return "Gmail alerts";
  }

  if (source.startsWith("adzuna:")) return "Adzuna";
  if (source.startsWith("remoteok")) return "RemoteOK";
  if (source.startsWith("greenhouse:")) return "Greenhouse";
  if (source.startsWith("lever:")) return "Lever";

  return source;
}

export default function Dashboard() {
  // Auth
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const uid = user?.uid ?? "guest";

  // Persona state
  const [roles, setRoles] = useState<string[]>(["Data Analyst"]);
  const [skills, setSkills] = useState<string[]>(["SQL", "Python"]);
  const [locations, setLocations] = useState<string[]>(["India", "Remote"]);
  const [preview, setPreview] = useState<any>(null);

  // Search state
  const [contains, setContains] = useState("");
  const [source, setSource] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [syncingGmail, setSyncingGmail] = useState(false);

  // Seeds state
  const [seedUrl, setSeedUrl] = useState("");
  const [seeds, setSeeds] = useState<{ id?: number; url: string }[]>([]);

  // ----- API helpers -----
  const fetchJobs = async () => {
    const r = await api.get("/jobs", { params: { contains, source, limit: 50 } });
    setJobs(r.data || []);
  };

  const loadPersona = async () => {
    const r = await api.get("/persona", { params: { uid } });
    const p = r.data || {};
    setPreview(p);
    if (p.roles_target) setRoles(p.roles_target);
    if (p.must_have) setSkills(p.must_have);
    if (p.locations) setLocations(p.locations);
  };

  const savePersona = async () => {
    const persona = {
      name: uid,
      roles_target: roles,
      must_have: skills,
      locations,
      sources: { adzuna_countries: ["in", "us", "gb"] },
    };
    await api.post("/persona", { uid, persona });
    setPreview(persona);
    alert("Persona saved!");
  };

  const clearPersona = async () => {
    await api.post("/persona", { uid, persona: {} });
    setRoles([]);
    setSkills([]);
    setLocations([]);
    setPreview({});
  };

  const loadGmailStatus = async () => {
    if (!uid) return;
    try {
      const r = await api.get("/auth/gmail/status");
      setGmailStatus(r.data);
    } catch (e) {
      console.error("Failed to load Gmail status", e);
    }
  };

  const connectGmail = async () => {
    try {
      const r = await api.get("/auth/gmail/start");
      const url = r.data?.auth_url;
      if (url) {
        window.location.href = url;
      } else {
        alert("Did not receive auth_url from server.");
      }
    } catch (e) {
      console.error("Failed to start Gmail connect", e);
      alert("Failed to start Gmail connect. Check console for details.");
    }
  };

  const syncGmailJobs = async () => {
    if (!uid) return;
    setSyncingGmail(true);
    try {
      const r = await api.post("/harvest/gmail", {
        uid,
        max_messages: 50,
      });
      const inserted = r.data?.inserted ?? 0;
      alert(
        `Synced Gmail alerts. Inserted/updated ${inserted} jobs. Now run your search again.`
      );
    } catch (e) {
      console.error("Failed to sync Gmail jobs", e);
      alert("Failed to sync Gmail jobs. Check console for details.");
    } finally {
      setSyncingGmail(false);
    }
  };

  const loadSeeds = async () => {
    const r = await api.get("/seeds", { params: { uid } });
    setSeeds(r.data || []);
  };

  const addSeed = async () => {
    const url = seedUrl.trim();
    if (!url) return;
    await api.post("/seed", { uid, url });
    setSeedUrl("");
    await loadSeeds();
  };

  const removeSeed = async (id?: number, url?: string) => {
    if (id) {
      await api.delete(`/seeds/${id}`, { params: { uid } });
    } else if (url) {
      await api.delete(`/seeds`, { params: { uid, url } });
    }
    await loadSeeds();
  };

  const clearSeeds = async () => {
    await api.delete("/seeds/clear", { params: { uid } });
    await loadSeeds();
  };

  const handleGoHome = () => {
    navigate("/");
  };

  const handleGoSupport = () => {
    navigate("/support");
  };

  // 🔹 NEW: centralised sign-out handler with hard redirect to Home
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      navigate("/"); // back to landing
    } catch (err) {
      console.error("Sign out failed", err);
    }
  };

  useEffect(() => {
    if (!user) return; // wait for auth to resolve
    loadPersona();
    // loadSeeds(); // ❌ disabled for now since backend /seeds is not wired, causes 404
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!uid) return;
    loadGmailStatus();
  }, [uid]);

  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      {/* ========================= HERO (top ~30%) ========================= */}
      <section className="hero">
        <div className="hero-inner">
          <img src="/logo.svg" alt="Job Butler" />
          <h1>Job Butler — Dashboard</h1>
          <p className="muted">{user?.phoneNumber || "Signed in"}</p>
          <div className="row">
            {/* 🔹 Use our handler instead of bare signOut */}
            <button onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      </section>

      {/* ========================= PERSONA ========================= */}
      <section className="card centered" style={{ maxWidth: 1080 }}>
        <h3>Persona</h3>

        <div className="stack">
          <TagInput
            label="Roles"
            value={roles}
            onChange={setRoles}
            suggestions={ROLE_SUGG}
            placeholder="e.g., Data Analyst, Analytics Manager"
          />

          <TagInput
            label="Skills"
            value={skills}
            onChange={setSkills}
            suggestions={SKILL_SUGG}
            placeholder="e.g., SQL, GenAI"
          />

          <TagInput
            label="Locations"
            value={locations}
            onChange={setLocations}
            suggestions={LOC_SUGG}
            placeholder="e.g., India, Remote"
          />

          <div className="row">
            <button onClick={savePersona}>Save Persona</button>
            <button className="secondary" onClick={clearPersona}>
              Clear Persona
            </button>
          </div>

          <div className="card" style={{ background: "#fafafa" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Persona Preview</div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(
                preview || { roles_target: roles, must_have: skills, locations },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      </section>

      {/* ========================= GMAIL JOB ALERTS ========================= */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Gmail Job Alerts</strong>
          {gmailStatus?.connected && gmailStatus.email && (
            <span className="badge">Connected: {gmailStatus.email}</span>
          )}
        </div>

        <div className="muted" style={{ marginTop: 4 }}>
          {gmailStatus?.connected
            ? "Your Gmail Naukri/LinkedIn job alerts will be used as a source for jobs. You can manually sync new alerts below."
            : "Connect your Gmail account so Job Butler can import Naukri & LinkedIn job alerts directly from your inbox."}
        </div>

        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button onClick={connectGmail}>Connect Gmail</button>
          {gmailStatus?.connected && (
            <button onClick={syncGmailJobs} disabled={syncingGmail}>
              {syncingGmail ? "Syncing..." : "Sync Gmail Jobs"}
            </button>
          )}
        </div>
      </div>

      {/* ========================= SEEDS ========================= */}
      <section className="card centered" style={{ maxWidth: 1080 }}>
        <h3>Seeds</h3>

        <div className="row" style={{ alignItems: "stretch" }}>
          <input
            value={seedUrl}
            onChange={(e) => setSeedUrl(e.target.value)}
            placeholder="Paste job/board URL and click Add"
          />
          <button onClick={addSeed}>Add</button>
          <button className="secondary" onClick={clearSeeds}>
            Clear All
          </button>
        </div>

        <div className="grid" style={{ gap: 6, marginTop: 8 }}>
          {seeds.map((s) => (
            <div
              key={`${s.id || s.url}`}
              className="row"
              style={{
                justifyContent: "space-between",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 10px",
                background: "var(--surface)",
              }}
            >
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {s.url}
              </a>
              <button
                className="secondary"
                onClick={() => removeSeed(s.id, s.url)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          {seeds.length === 0 && <div className="muted">No seeds yet.</div>}
        </div>

        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Tip: run <code>seed-harvest</code> via CLI (or we’ll add a Harvest button later) to
          pull ATS jobs for your seeds.
        </div>
      </section>

      {/* ========================= SEARCH ========================= */}
      <section className="card centered" style={{ maxWidth: 1080 }}>
        <h3>Search</h3>

        <div className="grid grid-2">
          <div className="stack">
            <label className="muted">Keyword</label>
            <input
              placeholder="e.g., GenAI, Tableau, Pyspark"
              value={contains}
              onChange={(e) => setContains(e.target.value)}
            />
          </div>

          <div className="stack">
            <label className="muted">Filter (optional)</label>
            <input
              placeholder="Source prefix (e.g. greenhouse:figma, lever:, adzuna:in, linkedin_email)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={fetchJobs}>Search</button>
          <button
            className="secondary"
            onClick={() => {
              setContains("");
              setSource("");
            }}
          >
            Clear
          </button>
        </div>
      </section>

      {/* ========================= RESULTS ========================= */}
      <section className="grid centered" style={{ maxWidth: 1080, gap: 12 }}>
        <h3>Results</h3>

        <div className="job-grid">
          {jobs.map((j, i) => {
            const company = j.company || "Unknown company";
            const location = j.location || "Location not specified";
            const initial = company.trim()[0]?.toUpperCase() || "J";
            const scorePercent =
              typeof j._score === "number"
                ? Math.round(j._score * 100)
                : undefined;

            return (
              <div key={i} className="job-card">
                <div className="job-card-header">
                  <div className="job-card-company">
                    <div className="job-card-logo">{initial}</div>
                    <div>
                      <div className="job-card-company-name">{company}</div>
                      <div className="job-card-meta">
                        {location} · {sourceLabel(j.source)}
                      </div>
                    </div>
                  </div>

                  {typeof scorePercent === "number" && (
                    <span className="job-card-badge">
                      Match {scorePercent}%
                    </span>
                  )}
                </div>

                <h3 className="job-card-title">{j.title}</h3>

                {Array.isArray(j._why) && j._why.length > 0 && (
                  <ul className="job-card-why">
                    {j._why.slice(0, 3).map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                )}

                <div className="job-card-footer">
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noreferrer"
                    className="jb-btn-fill-sm"
                  >
                    View details
                  </a>
                  <span className="job-card-posted">
                    Recommended for you
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
