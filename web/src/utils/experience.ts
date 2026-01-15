export type ExperienceLevel = "entry" | "junior" | "mid" | "senior";

export const EXPERIENCE_OPTIONS = [
  { value: "entry", label: "Entry (0-1 yrs)" },
  { value: "junior", label: "Junior (1-3 yrs)" },
  { value: "mid", label: "Mid (3-6 yrs)" },
  { value: "senior", label: "Senior (6+ yrs)" },
] as const;

export function levelRank(level: ExperienceLevel): number {
  switch (level) {
    case "entry":
      return 0;
    case "junior":
      return 1;
    case "mid":
      return 2;
    case "senior":
      return 3;
    default:
      return 2;
  }
}

export function inferExperienceFromTitle(title: string): ExperienceLevel {
  const raw = (title || "").toLowerCase();
  const trimmed = raw.trim();

  const entryPatterns = [
    /\bintern\b/,
    /\binternship\b/,
    /\btrainee\b/,
    /\bfresher\b/,
    /\bgraduate\b/,
    /\bcampus\b/,
  ];
  if (entryPatterns.some((re) => re.test(raw))) return "entry";

  const seniorPatterns = [
    /\bsenior\b/,
    /\bsr\.?\b/,
    /\blead\b/,
    /\bprincipal\b/,
    /\bstaff\b/,
    /\bmanager\b/,
    /\bhead\b/,
    /\bdirector\b/,
    /\bvp\b/,
    /\bchief\b/,
    /\barchitect\b/,
  ];
  if (seniorPatterns.some((re) => re.test(raw))) return "senior";

  const juniorPatterns = [
    /\bjunior\b/,
    /\bjr\.?\b/,
    /\bassociate\b/,
    /\bentry level\b/,
    /\blevel\s*1\b/,
    /\bl1\b/,
    /\b1-2\b/,
  ];
  if (juniorPatterns.some((re) => re.test(raw))) return "junior";
  if (/\bi\b$/.test(trimmed)) return "junior";

  return "mid";
}

export function prettyExperience(level: ExperienceLevel): string {
  switch (level) {
    case "entry":
      return "Entry";
    case "junior":
      return "Junior";
    case "mid":
      return "Mid";
    case "senior":
      return "Senior";
    default:
      return "Mid";
  }
}
