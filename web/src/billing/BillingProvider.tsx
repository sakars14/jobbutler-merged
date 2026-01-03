import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../firebase";
import {
  ensureBillingDoc,
  formatHhMmFromMs,
  getTrialRemainingMs,
  markActive,
  startTrialOnce,
  type BillingDoc,
  type BillingStatus,
} from "./billingStore";

type BillingState = {
  loading: boolean;
  isAdmin: boolean;
  billingDoc: BillingDoc | null;
  billing: BillingDoc | null;
  isPaid: boolean;
  needsChoice: boolean;
  isTrialActive: boolean;
  isTrialUsed: boolean;
  isBlocked: boolean;
  trialRemainingMs: number;
  trialCountdownHHMM: string;
  startTrialOnce: (uid: string) => Promise<"started" | "already_used">;
  markActiveAction: (uid: string, source?: BillingDoc["source"]) => Promise<void>;
};

const BillingContext = createContext<BillingState | undefined>(undefined);

const parsePhones = (raw: string | undefined) =>
  (raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const normalizeBilling = (
  data: BillingDoc | null,
  nowMs: number
): BillingDoc | null => {
  if (!data) return null;
  const status = (data.status ||
    (data.isSubscribed ? "active" : undefined)) as BillingStatus | undefined;
  if (status) return { ...data, status };
  if (data.trialEndsAt && typeof data.trialEndsAt.toDate === "function") {
    const endMs = data.trialEndsAt.toDate().getTime();
    return { ...data, status: endMs > nowMs ? "trial" : "blocked" };
  }
  return { ...data, status: "none" };
};

export function BillingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<BillingDoc | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [, setNow] = useState(Date.now());

  const adminPhones = useMemo(
    () => new Set(parsePhones(import.meta.env.VITE_ADMIN_PHONES)),
    []
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    let unsubscribeBilling: (() => void) | null = null;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!alive) return;
      if (!u) {
        setBilling(null);
        setIsAdmin(false);
        setLoading(false);
        if (unsubscribeBilling) unsubscribeBilling();
        return;
      }

      setLoading(true);
      const admin = adminPhones.has(u.phoneNumber || "");
      setIsAdmin(admin);
      if (admin) {
        setBilling(null);
        setLoading(false);
        if (unsubscribeBilling) unsubscribeBilling();
        return;
      }

      try {
        await ensureBillingDoc(u.uid);
        if (!alive) return;
        const ref = doc(db, "billing", u.uid);
        if (unsubscribeBilling) unsubscribeBilling();
        unsubscribeBilling = onSnapshot(
          ref,
          (snap) => {
            const data = snap.exists()
              ? (snap.data() as BillingDoc)
              : null;
            const normalized = normalizeBilling(data, Date.now());
            setBilling(normalized);
            setLoading(false);
          },
          (err) => {
            console.error("Billing subscription failed", err);
            setBilling(null);
            setLoading(false);
          }
        );
      } catch (err) {
        console.error("Billing init failed", err);
        if (!alive) return;
        setBilling(null);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      if (unsubscribeBilling) unsubscribeBilling();
      unsub();
    };
  }, [adminPhones]);

  const trialRemainingMs = getTrialRemainingMs(billing);
  const isTrialActive = billing?.status === "trial" && trialRemainingMs > 0;
  const isPaid = billing?.status === "active";
  const isTrialUsed =
    billing?.trialUsed === true ||
    !!billing?.trialStartedAt ||
    !!billing?.trialEndsAt;
  const needsChoice = !isAdmin && billing?.status === "none";
  const isBlocked =
    !isAdmin &&
    !isPaid &&
    isTrialUsed &&
    !isTrialActive;
  const trialCountdownHHMM = formatHhMmFromMs(trialRemainingMs);

  const startTrialOnceAction = async (targetUid: string) => {
    return startTrialOnce(targetUid);
  };

  const markActiveAction = async (
    targetUid: string,
    source: BillingDoc["source"] = "manual"
  ) => {
    await markActive(targetUid, source);
  };

  const value: BillingState = {
    loading,
    isAdmin,
    billingDoc: billing,
    billing,
    isPaid,
    needsChoice,
    isTrialActive,
    isTrialUsed,
    isBlocked,
    trialRemainingMs,
    trialCountdownHHMM,
    startTrialOnce: startTrialOnceAction,
    markActiveAction,
  };

  return (
    <BillingContext.Provider value={value}>
      {children}
    </BillingContext.Provider>
  );
}

export const useBilling = () => {
  const ctx = useContext(BillingContext);
  if (!ctx) {
    throw new Error("useBilling must be used within BillingProvider");
  }
  return ctx;
};
