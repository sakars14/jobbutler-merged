import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Timestamp,
  collection,
  getCountFromServer,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";

async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) {
    if (contentType.includes("application/json")) {
      try {
        const data = JSON.parse(text);
        const detail = data?.detail || data?.message;
        if (detail) throw new Error(String(detail));
      } catch {
        // fall through
      }
    }
    throw new Error(
      contentType.includes("application/json")
        ? text || `Request failed (${res.status})`
        : "Server returned non-JSON response. Check API/proxy."
    );
  }

  if (!contentType.includes("application/json")) {
    throw new Error("Server returned non-JSON response. Check API/proxy.");
  }

  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Server returned non-JSON response. Check API/proxy.");
  }
}

type Metrics = {
  total_jobs: number;
  jobs_last_24h: number;
  by_source: { source: string; count: number }[];
  daily_counts: { date: string; count: number }[];
};

type HarvestPack = {
  id?: number;
  slug: string;
  name: string;
  description?: string | null;
  is_enabled: boolean;
  config: Record<string, any>;
  last_run_at?: string | null;
};

type PackRunResult = {
  slug: string;
  status: string;
  inserted: number;
  updated: number;
  marked_inactive: number;
  archived: number;
  error?: string | null;
  finished_at?: string | null;
};

type NewPackForm = {
  name: string;
  description: string;
  is_enabled: boolean;
  sources: string[];
  roleKeywords: string;
  skillKeywords: string;
};

const PACK_SOURCES = [
  { id: "remoteok", label: "RemoteOK" },
  { id: "adzuna_in", label: "Adzuna (India)" },
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
];

const buildNewPack = (): NewPackForm => ({
  name: "",
  description: "",
  is_enabled: true,
  sources: ["remoteok", "adzuna_in"],
  roleKeywords: "",
  skillKeywords: "",
});

const parseCsv = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export default function Admin() {
  const nav = useNavigate();
  const billingEnabled = import.meta.env.VITE_BILLING_ENABLED === "true";
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsErr, setMetricsErr] = useState<string | null>(null);

  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [trialsCount, setTrialsCount] = useState<number | null>(null);
  const [trialsLoading, setTrialsLoading] = useState(true);

  const [packs, setPacks] = useState<HarvestPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsErr, setPacksErr] = useState<string | null>(null);
  const [packRunning, setPackRunning] = useState<Record<string, boolean>>({});
  const [packRunResults, setPackRunResults] = useState<
    Record<string, PackRunResult>
  >({});
  const [runEnabledLoading, setRunEnabledLoading] = useState(false);
  const [runEnabledError, setRunEnabledError] = useState<string | null>(null);
  const [editPack, setEditPack] = useState<HarvestPack | null>(null);
  const [editConfig, setEditConfig] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [newPackOpen, setNewPackOpen] = useState(false);
  const [newPack, setNewPack] = useState<NewPackForm>(buildNewPack());
  const [newPackError, setNewPackError] = useState<string | null>(null);
  const [newPackSaving, setNewPackSaving] = useState(false);

  const [cleanupStatus, setCleanupStatus] = useState<{
    lastRunAt: string | null;
    markedInactive: number | null;
    archived: number | null;
    message: string;
  }>({
    lastRunAt: null,
    markedInactive: null,
    archived: null,
    message: "",
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setMetricsLoading(true);
      setMetricsErr(null);
      try {
        const data = await fetchJson<{
          total_jobs?: number;
          jobs_last_24h?: number;
          by_source?: { source: string; count: number }[];
          daily_counts?: { date: string; count: number }[];
          totalJobs?: number;
          jobsLast24h?: number;
          jobsBySource?: { source: string; count: number }[];
          dailyHarvested?: { date: string; count: number }[];
        }>("/api/admin/metrics");
        const normalized: Metrics = {
          total_jobs: data.total_jobs ?? data.totalJobs ?? 0,
          jobs_last_24h: data.jobs_last_24h ?? data.jobsLast24h ?? 0,
          by_source: data.by_source ?? data.jobsBySource ?? [],
          daily_counts: data.daily_counts ?? data.dailyHarvested ?? [],
        };
        if (!alive) return;
        setMetrics(normalized);
      } catch (err: any) {
        if (!alive) return;
        setMetricsErr(err?.message || "Failed to load metrics");
        setMetrics(null);
      } finally {
        if (alive) setMetricsLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getCountFromServer(collection(db, "users"));
        if (!alive) return;
        setUsersCount(snap.data().count);
      } catch {
        if (!alive) return;
        setUsersCount(null);
      } finally {
        if (alive) setUsersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!billingEnabled) {
      setTrialsCount(null);
      setTrialsLoading(false);
      return () => {
        alive = false;
      };
    }
    (async () => {
      try {
        const now = Timestamp.fromDate(new Date());
        const q = query(
          collection(db, "billing"),
          where("status", "==", "trial"),
          where("trialEndsAt", ">", now)
        );
        const snap = await getCountFromServer(q);
        if (!alive) return;
        setTrialsCount(snap.data().count);
      } catch {
        if (!alive) return;
        setTrialsCount(null);
      } finally {
        if (alive) setTrialsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [billingEnabled]);

  const loadPacks = async () => {
    setPacksLoading(true);
    setPacksErr(null);
    try {
      const data = await fetchJson<HarvestPack[] | { packs?: HarvestPack[] }>(
        "/api/admin/packs"
      );
      const list = Array.isArray(data) ? data : data?.packs || [];
      setPacks(list);
    } catch (err: any) {
      const msg = err?.message || "Failed to load packs";
      setPacksErr(msg.includes("<") ? "Server returned non-JSON response. Check API/proxy." : msg);
      setPacks([]);
    } finally {
      setPacksLoading(false);
    }
  };

  useEffect(() => {
    loadPacks();
  }, []);

  const dailyCounts = metrics?.daily_counts || [];
  const maxDaily = useMemo(() => {
    return dailyCounts.reduce((acc, cur) => Math.max(acc, cur.count), 1);
  }, [dailyCounts]);
  const allSourceIds = useMemo(() => PACK_SOURCES.map((s) => s.id), []);
  const allSourcesSelected = useMemo(
    () => allSourceIds.every((id) => newPack.sources.includes(id)),
    [allSourceIds, newPack.sources]
  );

  const openEdit = (pack: HarvestPack) => {
    setEditPack(pack);
    setEditConfig(JSON.stringify(pack.config || {}, null, 2));
    setEditError(null);
  };

  const closeEdit = () => {
    setEditPack(null);
    setEditConfig("");
    setEditError(null);
  };

  const openNewPack = () => {
    setNewPack(buildNewPack());
    setNewPackError(null);
    setNewPackOpen(true);
  };

  const closeNewPack = () => {
    setNewPackOpen(false);
    setNewPackError(null);
  };

  const saveNewPack = async () => {
    const name = newPack.name.trim();
    if (!name) {
      setNewPackError("Name is required.");
      return;
    }

    const sources = newPack.sources;
    const roleKeywords = parseCsv(newPack.roleKeywords);
    const skillKeywords = parseCsv(newPack.skillKeywords);
    const config: Record<string, any> = { sources };

    if (sources.includes("remoteok")) config.remoteok = true;
    if (sources.includes("adzuna_in")) config.adzuna_in = true;
    if (sources.includes("greenhouse")) config.greenhouse = [];
    if (sources.includes("lever")) config.lever = [];
    if (roleKeywords.length) config.roleKeywords = roleKeywords;
    if (skillKeywords.length) config.skillKeywords = skillKeywords;

    setNewPackSaving(true);
    try {
      await fetchJson<HarvestPack>("/api/admin/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: newPack.description.trim() || null,
          is_enabled: newPack.is_enabled,
          config,
        }),
      });
      closeNewPack();
      await loadPacks();
    } catch (err: any) {
      setNewPackError(err?.message || "Failed to create pack");
    } finally {
      setNewPackSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editPack) return;
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(editConfig || "{}");
    } catch (err: any) {
      setEditError("Invalid JSON config.");
      return;
    }

    setEditSaving(true);
    try {
      const updated = await fetchJson<HarvestPack>(`/api/admin/packs/${editPack.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editPack.name,
          description: editPack.description,
          is_enabled: editPack.is_enabled,
          config: parsed,
        }),
      });
      setPacks((prev) =>
        prev.map((p) => (p.slug === updated.slug ? updated : p))
      );
      closeEdit();
    } catch (err: any) {
      setEditError(err?.message || "Failed to update pack");
    } finally {
      setEditSaving(false);
    }
  };

  const togglePack = async (pack: HarvestPack) => {
    const next = !pack.is_enabled;
    setPacks((prev) =>
      prev.map((p) => (p.slug === pack.slug ? { ...p, is_enabled: next } : p))
    );
    try {
      const updated = await fetchJson<HarvestPack>(`/api/admin/packs/${pack.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: next }),
      });
      setPacks((prev) =>
        prev.map((p) => (p.slug === updated.slug ? updated : p))
      );
    } catch {
      setPacks((prev) =>
        prev.map((p) =>
          p.slug === pack.slug ? { ...p, is_enabled: pack.is_enabled } : p
        )
      );
    }
  };

  const runPack = async (pack: HarvestPack) => {
    setPackRunning((prev) => ({ ...prev, [pack.slug]: true }));
    try {
      const result = await fetchJson<PackRunResult>(`/api/admin/packs/${pack.slug}/run`, {
        method: "POST",
      });
      setPackRunResults((prev) => ({ ...prev, [pack.slug]: result }));
      await loadPacks();
    } finally {
      setPackRunning((prev) => ({ ...prev, [pack.slug]: false }));
    }
  };

  const runEnabledPacks = async () => {
    setRunEnabledLoading(true);
    setRunEnabledError(null);
    try {
      const data = await fetchJson<{ results?: PackRunResult[] }>(
        "/api/admin/packs/run-enabled",
        {
          method: "POST",
        }
      );
      const results = data?.results || [];
      setPackRunResults((prev) => {
        const next = { ...prev };
        results.forEach((r) => {
          next[r.slug] = r;
        });
        return next;
      });
      await loadPacks();
    } catch (err: any) {
      setRunEnabledError(err?.message || "Failed to run enabled packs");
    } finally {
      setRunEnabledLoading(false);
    }
  };

  const deletePack = async (pack: HarvestPack) => {
    if (!window.confirm(`Delete pack "${pack.name}"?`)) return;
    setPackRunning((prev) => ({ ...prev, [pack.slug]: true }));
    try {
      await fetchJson(`/api/admin/packs/${pack.slug}`, { method: "DELETE" });
      setPacks((prev) => prev.filter((p) => p.slug !== pack.slug));
    } catch (err: any) {
      setPacksErr(err?.message || "Failed to delete pack");
    } finally {
      setPackRunning((prev) => ({ ...prev, [pack.slug]: false }));
    }
  };

  const runCleanup = async () => {
    setCleanupStatus((prev) => ({ ...prev, message: "Running..." }));
    try {
      const data = await fetchJson<{
        marked_inactive?: number;
        archived?: number;
      }>("/api/admin/cleanup", { method: "POST" });
      setCleanupStatus({
        lastRunAt: new Date().toLocaleString(),
        markedInactive:
          typeof data.marked_inactive === "number"
            ? Number(data.marked_inactive)
            : null,
        archived:
          typeof data.archived === "number" ? Number(data.archived) : null,
        message: "Done",
      });
    } catch (err: any) {
      setCleanupStatus({
        lastRunAt: null,
        markedInactive: null,
        archived: null,
        message: err?.message || "Cleanup failed",
      });
    }
  };

  return (
    <div className="dash-page">
      <div className="dash-card">
        <header className="dash-header">
          <div>
            <button
              type="button"
              className="back-arrow"
              onClick={() => nav("/dashboard")}
              aria-label="Back"
              style={{ marginBottom: 8 }}
            >
              &lt;
            </button>
            <div className="dash-kicker">Admin</div>
            <h1 className="dash-title">Admin Console</h1>
            <p className="dash-subtitle">Operational metrics and controls.</p>
          </div>
        </header>

        {metricsErr && <div className="dash-error">{metricsErr}</div>}

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            marginBottom: 16,
          }}
        >
          <div className="dash-tile">
            <div className="dash-group-label">Total Jobs</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {metricsLoading ? "..." : metrics?.total_jobs ?? 0}
            </div>
          </div>
          <div className="dash-tile">
            <div className="dash-group-label">Jobs last 24h</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {metricsLoading ? "..." : metrics?.jobs_last_24h ?? 0}
            </div>
          </div>
          <div className="dash-tile">
            <div className="dash-group-label">Users</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {usersLoading ? "..." : usersCount ?? "N/A"}
            </div>
          </div>
          <div className="dash-tile">
            <div className="dash-group-label">Trials Active</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {trialsLoading ? "..." : trialsCount ?? "N/A"}
            </div>
          </div>
        </section>

        <section className="dash-tile" style={{ marginBottom: 16 }}>
          <div className="dash-tile-top">
            <h3 className="dash-tile-title">Jobs by Source</h3>
          </div>
          {metricsLoading ? (
            <div className="dash-muted">Loading...</div>
          ) : !metrics?.by_source?.length ? (
            <div className="dash-muted">No data yet.</div>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.by_source.map((row) => (
                    <tr key={row.source || "unknown"}>
                      <td>{row.source || "unknown"}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dash-tile" style={{ marginBottom: 16 }}>
          <div className="dash-tile-top">
            <h3 className="dash-tile-title">
              Daily harvested jobs (last 14 days)
            </h3>
          </div>
          {metricsLoading ? (
            <div className="dash-muted">Loading...</div>
          ) : !dailyCounts.length ? (
            <div className="dash-muted">No data yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {dailyCounts.map((row) => {
                const width = `${Math.max(
                  6,
                  Math.round((row.count / maxDaily) * 100)
                )}%`;
                return (
                  <div
                    key={row.date}
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <div style={{ width: 90, fontSize: 12, color: "#6b7280" }}>
                      {row.date}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 10,
                        background: "rgba(15,23,42,0.08)",
                        borderRadius: 999,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width,
                          height: "100%",
                          background: "#0b1020",
                        }}
                      />
                    </div>
                    <div style={{ width: 40, textAlign: "right", fontSize: 12 }}>
                      {row.count}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="dash-tile" style={{ marginBottom: 16 }}>
          <div className="dash-tile-top">
            <h3 className="dash-tile-title">Harvest Packs</h3>
            <div className="dash-actions">
              <button
                className="dash-pill"
                type="button"
                onClick={runEnabledPacks}
                disabled={runEnabledLoading || packsLoading}
              >
                {runEnabledLoading ? "Running..." : "Run Enabled Packs"}
              </button>
              <button className="dash-mini" type="button" onClick={openNewPack}>
                New Pack
              </button>
            </div>
          </div>
          {runEnabledError && <div className="dash-error">{runEnabledError}</div>}
          {packsErr && <div className="dash-error">{packsErr}</div>}
          {packsLoading ? (
            <div className="dash-muted">Loading packs...</div>
          ) : !packs.length ? (
            <div className="dash-muted">No packs configured.</div>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Enabled</th>
                    <th>Last run</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {packs.map((pack) => {
                    const running = packRunning[pack.slug] || runEnabledLoading;
                    const result = packRunResults[pack.slug];
                    const lastRun =
                      pack.last_run_at ||
                      (result?.finished_at ? result.finished_at : null);
                    return (
                      <tr key={pack.slug}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{pack.name}</div>
                          <div className="dash-muted">
                            {pack.description || pack.slug}
                          </div>
                          {running && (
                            <div className="dash-muted">Running...</div>
                          )}
                          {result && !running && (
                            <div className="dash-muted">
                              Inserted {result.inserted}, updated{" "}
                              {result.updated}, inactive {result.marked_inactive}
                              , archived {result.archived}
                            </div>
                          )}
                        </td>
                        <td>
                          <label className="dash-filter-toggle">
                            <input
                              type="checkbox"
                              checked={pack.is_enabled}
                              onChange={() => togglePack(pack)}
                              disabled={running}
                            />
                            {pack.is_enabled ? "On" : "Off"}
                          </label>
                        </td>
                        <td className="dash-muted">
                          {lastRun ? new Date(lastRun).toLocaleString() : "—"}
                        </td>
                        <td>
                          <div className="dash-actions">
                            <button
                              className="dash-pill"
                              type="button"
                              onClick={() => runPack(pack)}
                              disabled={running}
                            >
                              Run
                            </button>
                            <button
                              className="dash-mini"
                              type="button"
                              onClick={() => openEdit(pack)}
                              disabled={running}
                            >
                              Edit
                            </button>
                            <button
                              className="dash-mini"
                              type="button"
                              onClick={() => deletePack(pack)}
                              disabled={running}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <div className="dash-tile">
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Email Ingest</h3>
            </div>
            <p className="dash-muted">
              Email sync is user-initiated from Dashboard → Sync.
            </p>
            <div className="dash-actions">
              <button
                className="dash-pill"
                type="button"
                onClick={() => nav("/dashboard")}
              >
                Open Dashboard
              </button>
            </div>
          </div>

          <div className="dash-tile">
            <div className="dash-tile-top">
              <h3 className="dash-tile-title">Cleanup</h3>
            </div>
            <p className="dash-muted">
              Marks stale jobs inactive and archives older ones.
            </p>
            <div className="dash-actions">
              <button className="dash-pill" type="button" onClick={runCleanup}>
                Run Cleanup
              </button>
            </div>
            <div className="dash-muted" style={{ marginTop: 8 }}>
              Last run: {cleanupStatus.lastRunAt || "Not run yet"}
            </div>
            {(cleanupStatus.markedInactive !== null ||
              cleanupStatus.archived !== null) && (
              <div className="dash-muted">
                {cleanupStatus.markedInactive !== null
                  ? `Marked inactive: ${cleanupStatus.markedInactive}`
                  : "Marked inactive: N/A"}
                {cleanupStatus.archived !== null
                  ? ` | Archived: ${cleanupStatus.archived}`
                  : " | Archived: N/A"}
              </div>
            )}
            {cleanupStatus.message && (
              <div className="dash-muted">{cleanupStatus.message}</div>
            )}
          </div>
        </section>
      </div>
      {editPack && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              background: "#fff",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Edit Pack</h3>
              <button className="dash-mini" type="button" onClick={closeEdit}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              <label>
                <div className="dash-group-label">Name</div>
                <input
                  value={editPack.name}
                  onChange={(e) =>
                    setEditPack({ ...editPack, name: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              <label>
                <div className="dash-group-label">Description</div>
                <input
                  value={editPack.description || ""}
                  onChange={(e) =>
                    setEditPack({ ...editPack, description: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              <label className="dash-filter-toggle">
                <input
                  type="checkbox"
                  checked={editPack.is_enabled}
                  onChange={(e) =>
                    setEditPack({
                      ...editPack,
                      is_enabled: e.target.checked,
                    })
                  }
                />
                Enabled
              </label>
              <label>
                <div className="dash-group-label">Config (JSON)</div>
                <textarea
                  value={editConfig}
                  onChange={(e) => setEditConfig(e.target.value)}
                  rows={10}
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(15,23,42,0.15)",
                    padding: 12,
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </label>
              {editError && <div className="dash-error">{editError}</div>}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
              <button
                className="dash-pill"
                type="button"
                onClick={saveEdit}
                disabled={editSaving}
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button className="dash-mini" type="button" onClick={closeEdit}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {newPackOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              background: "#fff",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 20px 60px rgba(15,23,42,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>New Pack</h3>
              <button className="dash-mini" type="button" onClick={closeNewPack}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              <label>
                <div className="dash-group-label">Name</div>
                <input
                  value={newPack.name}
                  onChange={(e) =>
                    setNewPack({ ...newPack, name: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              <label>
                <div className="dash-group-label">Description</div>
                <input
                  value={newPack.description}
                  onChange={(e) =>
                    setNewPack({ ...newPack, description: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              <label className="dash-filter-toggle">
                <input
                  type="checkbox"
                  checked={newPack.is_enabled}
                  onChange={(e) =>
                    setNewPack({ ...newPack, is_enabled: e.target.checked })
                  }
                />
                Enabled
              </label>
              <div>
                <div
                  className="dash-group-label"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Sources</span>
                  <button
                    className="dash-mini"
                    type="button"
                    onClick={() =>
                      setNewPack({
                        ...newPack,
                        sources: allSourcesSelected ? [] : allSourceIds,
                      })
                    }
                  >
                    {allSourcesSelected ? "Clear" : "Select all"}
                  </button>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  }}
                >
                  {PACK_SOURCES.map((source) => (
                    <label key={source.id} className="dash-filter-toggle">
                      <input
                        type="checkbox"
                        checked={newPack.sources.includes(source.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setNewPack((prev) => ({
                            ...prev,
                            sources: checked
                              ? [...prev.sources, source.id]
                              : prev.sources.filter((id) => id !== source.id),
                          }));
                        }}
                      />
                      {source.label}
                    </label>
                  ))}
                </div>
              </div>
              <label>
                <div className="dash-group-label">
                  Role keywords (comma separated)
                </div>
                <input
                  value={newPack.roleKeywords}
                  onChange={(e) =>
                    setNewPack({ ...newPack, roleKeywords: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              <label>
                <div className="dash-group-label">
                  Skill keywords (comma separated)
                </div>
                <input
                  value={newPack.skillKeywords}
                  onChange={(e) =>
                    setNewPack({ ...newPack, skillKeywords: e.target.value })
                  }
                  className="dash-filter-input"
                />
              </label>
              {newPackError && <div className="dash-error">{newPackError}</div>}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
              <button
                className="dash-pill"
                type="button"
                onClick={saveNewPack}
                disabled={newPackSaving}
              >
                {newPackSaving ? "Saving..." : "Save"}
              </button>
              <button className="dash-mini" type="button" onClick={closeNewPack}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
