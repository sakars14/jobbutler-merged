const normalizePhone = (phone: string | null | undefined) =>
  (phone || "").replace(/\s+/g, "").trim();

const parseAdminPhones = (raw: string | undefined) =>
  (raw || "")
    .split(",")
    .map((v) => normalizePhone(v))
    .filter(Boolean);

export const isAdminPhone = (phone: string | null | undefined): boolean => {
  const needle = normalizePhone(phone);
  if (!needle) return false;
  const adminPhones = new Set(parseAdminPhones(import.meta.env.VITE_ADMIN_PHONES));
  return adminPhones.has(needle);
};

export const isAdminUser = (user?: { phoneNumber?: string | null } | null) =>
  isAdminPhone(user?.phoneNumber);
