export type VisitedMap = Record<string, number>;

export function storageKey(uid?: string) {
  return `jb:visitedJobs:${uid || "anon"}`;
}

export function loadVisited(uid?: string): VisitedMap {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as VisitedMap;
  } catch {
    return {};
  }
}

export function saveVisited(uid: string | undefined, map: VisitedMap) {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function markVisited(uid: string | undefined, jobId: string | number) {
  const m = loadVisited(uid);
  m[String(jobId)] = Date.now();
  saveVisited(uid, m);
  return m;
}
