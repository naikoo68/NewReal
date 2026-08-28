import Settings from "../models/Settings.js";

// Default client subscription plans (used until an admin edits them in the
// panel). Each plan carries BOTH its pricing (label/months/price) AND its AI
// generation limits (maxPerBatch + perWindow per windowMinutes). Prices match
// the original hard-coded plans so nothing reprices on first deploy.
export const DEFAULT_CLIENT_PLANS = [
  { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true, maxPerBatch: 50, perWindow: 50, windowMinutes: 5 },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 299, maxPerBatch: 50, perWindow: 100, windowMinutes: 5 },
  { key: "2m", label: "2 Months", cycle: "Monthly", months: 2, price: 499, maxPerBatch: 100, perWindow: 200, windowMinutes: 5 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699, maxPerBatch: 200, perWindow: 400, windowMinutes: 5 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899, maxPerBatch: 500, perWindow: 1000, windowMinutes: 5 },
];

// Default STUDENT subscription plans (used until an admin edits them in the
// panel). Students don't get the AI generator, so these carry ONLY pricing
// (label/months/price) — no AI limits. Prices per the product spec.
export const DEFAULT_STUDENT_PLANS = [
  { key: "trial", label: "1-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 149 },
  { key: "3m", label: "3 Months", cycle: "Quarterly", months: 3, price: 399 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 699 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 899 },
];

// Default INSTITUTE (tenant) subscription plans — what an institute pays to run
// its own space on the platform. Pricing only; admin-editable. The trial grants
// TRIAL_TENANT_DAYS of access (see instituteSignupController). Placeholder
// prices — the super-admin edits them in Admin → Plans → Institute Plans.
export const DEFAULT_TENANT_PLANS = [
  { key: "trial", label: "14-Day Free Trial", cycle: "Trial", months: 0, price: 0, trial: true },
  { key: "1m", label: "1 Month", cycle: "Monthly", months: 1, price: 1499 },
  { key: "6m", label: "6 Months", cycle: "Semi-Annually", months: 6, price: 6999 },
  { key: "1y", label: "1 Year", cycle: "Yearly", months: 12, price: 11999 },
];

// The admin-managed client plans (from Settings), or the defaults if none saved.
export async function getClientPlans() {
  try {
    const s = await Settings.findOne({ key: "site" }).select("clientPlans").lean();
    if (Array.isArray(s?.clientPlans) && s.clientPlans.length) return s.clientPlans;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CLIENT_PLANS;
}

// The admin-managed student plans (from Settings), or the defaults if none saved.
export async function getStudentPlans() {
  try {
    const s = await Settings.findOne({ key: "site" }).select("studentPlans").lean();
    if (Array.isArray(s?.studentPlans) && s.studentPlans.length) return s.studentPlans;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_STUDENT_PLANS;
}

// The admin-managed institute (tenant) plans (from Settings), or the defaults.
export async function getTenantPlans() {
  try {
    const s = await Settings.findOne({ key: "site" }).select("tenantPlans").lean();
    if (Array.isArray(s?.tenantPlans) && s.tenantPlans.length) return s.tenantPlans;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_TENANT_PLANS;
}

// Resolve the plan catalog for an audience:
//   "student" → student plans, "tenant" → institute plans,
//   anything else → client plans (the historical default).
export async function getPlansFor(audience) {
  if (audience === "student") return getStudentPlans();
  if (audience === "tenant") return getTenantPlans();
  return getClientPlans();
}

export function findPlan(plans, key) {
  return (plans || []).find((p) => p.key === key) || null;
}
