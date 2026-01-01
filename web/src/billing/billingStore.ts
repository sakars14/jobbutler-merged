import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export type BillingDoc = {
  trialStartedAt: Timestamp;
  trialEndsAt: Timestamp;
  isSubscribed: boolean;
  planId: string | null;
  subscriptionEndsAt: Timestamp | null;
};

const hoursToMs = (hours: number) => hours * 60 * 60 * 1000;

export const getOrCreateBilling = async (
  uid: string,
  trialHours: number
): Promise<BillingDoc> => {
  const ref = doc(db, "billing", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const trialStartedAt = Timestamp.now();
    const trialEndsAt = Timestamp.fromMillis(
      trialStartedAt.toMillis() + hoursToMs(trialHours)
    );
    const fresh: BillingDoc = {
      trialStartedAt,
      trialEndsAt,
      isSubscribed: false,
      planId: null,
      subscriptionEndsAt: null,
    };
    await setDoc(ref, fresh);
    return fresh;
  }

  const data = snap.data() as Partial<BillingDoc>;
  const trialStartedAt = data.trialStartedAt ?? Timestamp.now();
  const trialEndsAt =
    data.trialEndsAt ??
    Timestamp.fromMillis(trialStartedAt.toMillis() + hoursToMs(trialHours));

  const normalized: BillingDoc = {
    trialStartedAt,
    trialEndsAt,
    isSubscribed: data.isSubscribed ?? false,
    planId: data.planId ?? null,
    subscriptionEndsAt: data.subscriptionEndsAt ?? null,
  };

  const needsUpdate =
    !data.trialStartedAt ||
    !data.trialEndsAt ||
    data.isSubscribed === undefined ||
    data.planId === undefined ||
    data.subscriptionEndsAt === undefined;

  if (needsUpdate) {
    await setDoc(ref, normalized, { merge: true });
  }

  return normalized;
};

export const markSubscribed = async (
  uid: string,
  planId: string,
  subscriptionEndsAt: Timestamp
) => {
  const ref = doc(db, "billing", uid);
  await setDoc(
    ref,
    {
      isSubscribed: true,
      planId,
      subscriptionEndsAt,
    },
    { merge: true }
  );
};
