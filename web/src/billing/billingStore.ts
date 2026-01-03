import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";

export type BillingStatus = "none" | "trial" | "active" | "blocked";

export type BillingDoc = {
  uid?: string;
  status?: BillingStatus;
  createdAt?: any;
  updatedAt?: any;
  trialUsed?: boolean;
  trialStartedAt?: any;
  trialEndsAt?: Timestamp;
  activeSince?: any;
  period?: "monthly" | "quarterly";
  plan?: "trial" | "pro";
  source?: "instamojo" | "admin" | "manual";
  isSubscribed?: boolean;
  planId?: string | null;
  subscriptionEndsAt?: Timestamp | null;
};

const TRIAL_HOURS = Number(import.meta.env.VITE_TRIAL_HOURS || 48);
const hoursToMs = (hours: number) => hours * 60 * 60 * 1000;

const isTimestamp = (val: any): val is Timestamp =>
  val && typeof val.toDate === "function";

const inferStatus = (data: BillingDoc, nowMs: number): BillingStatus => {
  if (data.status) return data.status;
  if (data.isSubscribed) return "active";
  if (data.trialEndsAt && isTimestamp(data.trialEndsAt)) {
    const end = data.trialEndsAt.toDate().getTime();
    return end > nowMs ? "trial" : "blocked";
  }
  return "none";
};

export const getTrialRemainingMs = (billing?: BillingDoc | null): number => {
  if (!billing?.trialEndsAt) return 0;
  const endMs = isTimestamp(billing.trialEndsAt)
    ? billing.trialEndsAt.toDate().getTime()
    : Number(billing.trialEndsAt);
  return Math.max(0, endMs - Date.now());
};

export const trialRemainingMs = getTrialRemainingMs;

export const formatHhMmFromMs = (ms: number): string => {
  const totalMinutes = Math.floor(ms / 60000);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const hhStr = String(hh).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return `${hhStr}:${mmStr}`;
};

export const formatHHMM = formatHhMmFromMs;

export const ensureBillingDoc = async (uid: string): Promise<void> => {
  const ref = doc(db, "billing", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const payload: BillingDoc = {
      status: "none",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload, { merge: true });
    return;
  }

  const data = snap.data() as BillingDoc;
  const nowMs = Date.now();
  const status = inferStatus(data, nowMs);
  const updates: Partial<BillingDoc> = {};

  if (!data.status) {
    updates.status = status;
  }

  if (!data.trialUsed && (data.trialStartedAt || data.trialEndsAt)) {
    updates.trialUsed = true;
  }

  if (status === "trial") {
    if (!data.trialUsed) {
      updates.trialUsed = true;
    }
    if (!data.trialEndsAt || !isTimestamp(data.trialEndsAt)) {
      const startMs = isTimestamp(data.trialStartedAt)
        ? data.trialStartedAt.toDate().getTime()
        : nowMs;
      updates.trialStartedAt = isTimestamp(data.trialStartedAt)
        ? data.trialStartedAt
        : Timestamp.fromMillis(startMs);
      updates.trialEndsAt = Timestamp.fromMillis(
        startMs + hoursToMs(TRIAL_HOURS)
      );
    } else {
      const endMs = data.trialEndsAt.toDate().getTime();
      if (endMs <= nowMs) {
        updates.status = "blocked";
      }
    }
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = serverTimestamp();
    await setDoc(ref, updates, { merge: true });
  }
};

export const startTrial = async (uid: string): Promise<void> => {
  const ref = doc(db, "billing", uid);
  const ends = new Date(Date.now() + hoursToMs(TRIAL_HOURS));
  const payload: BillingDoc = {
    status: "trial",
    trialUsed: true,
    trialStartedAt: serverTimestamp(),
    trialEndsAt: Timestamp.fromDate(ends),
    plan: "trial",
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
};

export const startTrialOnce = async (
  uid: string
): Promise<"started" | "already_used"> => {
  const ref = doc(db, "billing", uid);
  const endsAt = Timestamp.fromMillis(Date.now() + hoursToMs(TRIAL_HOURS));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const data = snap.data() as BillingDoc;
      const alreadyUsed =
        data.trialUsed === true ||
        !!data.trialStartedAt ||
        !!data.trialEndsAt ||
        data.status === "active";
      if (alreadyUsed) return "already_used";

      tx.set(
        ref,
        {
          ...data,
          uid,
          trialUsed: true,
          trialStartedAt: serverTimestamp(),
          trialEndsAt: endsAt,
          status: "trial",
          plan: "trial",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return "started";
    }

    tx.set(ref, {
      uid,
      trialUsed: true,
      trialStartedAt: serverTimestamp(),
      trialEndsAt: endsAt,
      status: "trial",
      plan: "trial",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as BillingDoc);

    return "started";
  });
};

export const markActive = async (
  uid: string,
  source: BillingDoc["source"] = "manual"
): Promise<void> => {
  const ref = doc(db, "billing", uid);
  const payload: BillingDoc = {
    status: "active",
    plan: "pro",
    source,
    activeSince: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
};
