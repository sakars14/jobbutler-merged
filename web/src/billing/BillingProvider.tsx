import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { getOrCreateBilling, type BillingDoc } from "./billingStore";

type BillingState = {
  loading: boolean;
  isAdmin: boolean;
  isSubscribed: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  isTrialActive: boolean;
  isBlocked: boolean;
};

const BillingContext = createContext<BillingState | undefined>(undefined);

const parsePhones = (raw: string | undefined) =>
  (raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const parseTrialHours = (raw: string | undefined) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
};

export function BillingProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<BillingDoc | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [now, setNow] = useState(Date.now());

  const adminPhones = useMemo(
    () => new Set(parsePhones(import.meta.env.VITE_ADMIN_PHONES)),
    []
  );
  const trialHours = parseTrialHours(import.meta.env.VITE_TRIAL_HOURS);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!alive) return;
      if (!u) {
        setBilling(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      const admin = adminPhones.has(u.phoneNumber || "");
      setIsAdmin(admin);

      if (admin) {
        setBilling(null);
        setLoading(false);
        return;
      }

      try {
        const doc = await getOrCreateBilling(u.uid, trialHours);
        if (!alive) return;
        setBilling(doc);
      } catch (err) {
        console.error("Billing init failed", err);
        if (!alive) return;
        setBilling(null);
      } finally {
        if (alive) setLoading(false);
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [adminPhones, trialHours]);

  const trialStartedAt = billing?.trialStartedAt?.toDate?.() || null;
  const trialEndsAt = billing?.trialEndsAt?.toDate?.() || null;
  const isSubscribed = billing?.isSubscribed ?? false;
  const isTrialActive =
    !!trialEndsAt && !isSubscribed && now < trialEndsAt.getTime();
  const isBlocked =
    !!billing &&
    !isAdmin &&
    !isSubscribed &&
    !!trialEndsAt &&
    now >= trialEndsAt.getTime();

  const value: BillingState = {
    loading,
    isAdmin,
    isSubscribed,
    trialStartedAt,
    trialEndsAt,
    isTrialActive,
    isBlocked,
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
