export type ExperienceLevel =
  | "entry"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "principal"
  | "executive";

export type ExperienceOptionValue = ExperienceLevel | "any";

export const EXPERIENCE_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "entry", label: "Entry (0-1)" },
  { value: "junior", label: "Junior (1-3)" },
  { value: "mid", label: "Mid (3-6)" },
  { value: "senior", label: "Senior (6-10)" },
  { value: "lead", label: "Lead (10-15)" },
  { value: "principal", label: "Principal (15-20)" },
  { value: "executive", label: "Executive (20+)" },
] as const;

export const EXPERIENCE_VALUES = EXPERIENCE_OPTIONS.map((opt) => opt.value);

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
    case "lead":
      return 4;
    case "principal":
      return 5;
    case "executive":
      return 6;
    default:
      return 2;
  }
}

export function inferExperienceFromTitle(title: string): ExperienceLevel {
  const raw = (title || "").toLowerCase();
  const trimmed = raw.trim();

  const executivePatterns = [
    /\bdirector\b/,
    /\bhead\b/,
    /\bvp\b/,
    /\bchief\b/,
    /\bcxo\b/,
  ];
  if (executivePatterns.some((re) => re.test(raw))) return "executive";

  const principalPatterns = [/\bprincipal\b/, /\barchitect\b/];
  if (principalPatterns.some((re) => re.test(raw))) return "principal";

  const leadPatterns = [/\blead\b/, /\bstaff\b/, /\bmanager\b/];
  if (leadPatterns.some((re) => re.test(raw))) return "lead";

  const seniorPatterns = [/\bsenior\b/, /\bsr\.?\b/];
  if (seniorPatterns.some((re) => re.test(raw))) return "senior";

  const midPatterns = [/\bassociate\b/, /\bintermediate\b/, /\bmid\b/];
  if (midPatterns.some((re) => re.test(raw))) return "mid";

  const juniorPatterns = [/\bjunior\b/, /\bjr\.?\b/, /\bl1\b/];
  if (juniorPatterns.some((re) => re.test(raw))) return "junior";
  if (/\bi\b$/.test(trimmed)) return "junior";

  const entryPatterns = [
    /\bintern\b/,
    /\binternship\b/,
    /\btrainee\b/,
    /\bapprentice\b/,
    /\bfresher\b/,
    /\bgraduate\b/,
    /\bcampus\b/,
  ];
  if (entryPatterns.some((re) => re.test(raw))) return "entry";

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
    case "lead":
      return "Lead";
    case "principal":
      return "Principal";
    case "executive":
      return "Executive";
    default:
      return "Mid";
  }
}
