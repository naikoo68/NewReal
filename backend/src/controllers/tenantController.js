import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";
import { runUnscoped } from "../utils/tenantContext.js";
import { clearTenantCache } from "../middleware/tenant.js";

// Super-admin management of tenants (institutes) + the super-admin console data
// (per-institute stats, create an institute admin). All routes run behind
// [protect, superAdminOnly] — never an institute_admin action.
//
// Counts are gathered with runUnscoped() so they aggregate ACROSS institutes
// regardless of the current request's tenant context.

const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "static", "assets", "cdn", "help",
  "support", "status", "blog", "docs", "dashboard", "login", "signup",
]);

const normSlug = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const sanitize = (t, stats) => ({
  id: t._id,
  name: t.name,
  slug: t.slug,
  customDomain: t.customDomain || "",
  status: t.status,
  isDefault: !!t.isDefault,
  ownerName: t.ownerName || "",
  ownerEmail: t.ownerEmail || "",
  subscriptionPlan: t.subscriptionPlan,
  isTrial: t.isTrial,
  expiresAt: t.expiresAt,
  createdAt: t.createdAt,
  ...(stats ? { stats } : {}),
});

// Build { [tenantId]: { students, instituteAdmins, clients, questions, tests } }
// for the given tenant ids, aggregating across all institutes.
async function statsFor(ids) {
  if (!ids.length) return {};
  const [userAgg, qAgg, tAgg] = await runUnscoped(() =>
    Promise.all([
      User.aggregate([
        { $match: { tenantId: { $in: ids } } },
        { $group: { _id: { t: "$tenantId", r: "$role" }, c: { $sum: 1 } } },
      ]),
      Question.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: "$tenantId", c: { $sum: 1 } } }]),
      TestSeries.aggregate([{ $match: { tenantId: { $in: ids } } }, { $group: { _id: "$tenantId", c: { $sum: 1 } } }]),
    ])
  );
  const out = {};
  const ensure = (id) => (out[id] ||= { students: 0, instituteAdmins: 0, clients: 0, questions: 0, tests: 0 });
  for (const r of userAgg) {
    const s = ensure(String(r._id.t));
    if (r._id.r === "student") s.students += r.c;
    else if (r._id.r === "institute_admin") s.instituteAdmins += r.c;
    else if (r._id.r === "client") s.clients += r.c;
  }
  for (const r of qAgg) ensure(String(r._id)).questions += r.c;
  for (const r of tAgg) ensure(String(r._id)).tests += r.c;
  return out;
}

// GET /api/tenants — list all institutes (newest first) with per-institute stats.
export async function listTenants(req, res) {
  const search = String(req.query.search || "").trim();
  const filter = { deleted: { $ne: true } };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { slug: rx }, { ownerEmail: rx }];
  }
  const tenants = await runUnscoped(() => Tenant.find(filter).sort("-createdAt").lean());
  const stats = await statsFor(tenants.map((t) => t._id));
  res.json({ tenants: tenants.map((t) => sanitize(t, stats[String(t._id)] || {})), total: tenants.length });
}

// GET /api/tenants/:id
export async function getTenant(req, res) {
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
  const stats = await statsFor([t._id]);
  res.json(sanitize(t, stats[String(t._id)] || {}));
}

// POST /api/tenants — create an institute (super-admin, manual).
export async function createTenant(req, res) {
  try {
    const name = String(req.body?.name || "").trim();
    const slug = normSlug(req.body?.slug || name);
    if (!name) return res.status(400).json({ message: "Institute name is required" });
    if (!slug) return res.status(400).json({ message: "A valid subdomain is required" });
    if (RESERVED_SLUGS.has(slug)) return res.status(409).json({ message: "That subdomain is reserved. Please choose another." });

    const exists = await runUnscoped(() => Tenant.findOne({ slug }));
    if (exists) return res.status(409).json({ message: "That subdomain is already taken" });

    const t = await Tenant.create({
      name,
      slug,
      ownerName: String(req.body?.ownerName || "").trim(),
      ownerEmail: String(req.body?.ownerEmail || "").toLowerCase().trim(),
      status: req.body?.status === "active" ? "active" : "pending",
    });
    return res.status(201).json(sanitize(t));
  } catch (e) {
    // Always respond — never let an error leave the request hanging.
    if (e?.code === 11000) return res.status(409).json({ message: "That subdomain is already in use." });
    return res.status(500).json({ message: e.message || "Could not create the institute." });
  }
}

// PATCH /api/tenants/:id/status — activate / suspend an institute.
export async function updateTenantStatus(req, res) {
  const status = String(req.body?.status || "");
  if (!["pending", "active", "suspended"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });
  t.status = status;
  await t.save();
  res.json(sanitize(t));
}

// Basic hostname validation (a registrable domain, e.g. exam.brightfuture.com).
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const cleanDomain = (d) =>
  String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");

// PATCH /api/tenants/:id/domain — set or clear an institute's custom domain.
// Super-admin only. The institute must then point that domain's DNS at the
// platform (and the frontend host must serve it with SSL) — see the response's
// `dns` guidance. resolveTenant already maps a matching Host → this tenant.
export async function setTenantDomain(req, res) {
  try {
  const t = await runUnscoped(() => Tenant.findById(req.params.id));
  if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });

  const domain = cleanDomain(req.body?.customDomain);

  if (!domain) {
    // UNSET the field (don't store "") so the sparse unique index ignores it.
    await runUnscoped(() => Tenant.updateOne({ _id: t._id }, { $unset: { customDomain: 1 } }));
    clearTenantCache();
    t.customDomain = undefined;
    return res.json(sanitize(t));
  }

  if (!DOMAIN_RE.test(domain)) {
    return res.status(400).json({ message: "Enter a valid domain, e.g. exam.yourinstitute.com" });
  }
  // Never allow claiming the platform's own domain / a subdomain of it.
  const root = String(process.env.ROOT_DOMAIN || "").toLowerCase().replace(/^\./, "");
  if (root && (domain === root || domain.endsWith("." + root))) {
    return res.status(400).json({ message: "Use a domain the institute owns — not the platform domain." });
  }
  const taken = await runUnscoped(() =>
    Tenant.findOne({ customDomain: domain, _id: { $ne: t._id }, deleted: { $ne: true } }).select("_id")
  );
  if (taken) return res.status(409).json({ message: "That domain is already used by another institute." });

  t.customDomain = domain;
  await t.save();
  clearTenantCache(); // so the new mapping takes effect immediately

  return res.json({
    ...sanitize(t),
    // DNS the institute must configure for the domain to resolve here.
    dns: {
      cname: { host: domain, pointsTo: root ? `app.${root}` : "your platform frontend host" },
      note: "Add this domain in your frontend host (e.g. Vercel) so it's served with SSL. Apex domains may need an A record instead of CNAME — follow your host's instructions.",
    },
  });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: "That domain is already used by another institute." });
    return res.status(500).json({ message: e.message || "Could not update the custom domain." });
  }
}

// POST /api/tenants/:id/admin — create an INSTITUTE ADMIN for a tenant.
export async function createTenantAdmin(req, res) {
  try {
    const t = await runUnscoped(() => Tenant.findById(req.params.id));
    if (!t || t.deleted) return res.status(404).json({ message: "Tenant not found" });

    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    const exists = await runUnscoped(() => User.findOne({ email }).select("_id"));
    if (exists) return res.status(409).json({ message: "Email already registered" });

    // Explicit tenantId (not from context) — this admin belongs to THIS institute.
    const user = await runUnscoped(() =>
      User.create({ name, email, password, role: "institute_admin", tenantId: t._id, isEmailVerified: true })
    );
    return res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ message: "That email is already registered." });
    return res.status(500).json({ message: e.message || "Could not create the institute admin." });
  }
}
