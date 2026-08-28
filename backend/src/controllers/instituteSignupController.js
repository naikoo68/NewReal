import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import generateToken from "../utils/generateToken.js";
import { computeOffer } from "./authController.js";
import { getTenantPlans } from "../utils/plans.js";
import { razorpayConfigured, razorpayKeyId, createRazorpayOrder, verifyPaymentSignature } from "../config/razorpay.js";
import { runUnscoped } from "../utils/tenantContext.js";
import { notifyNewUser } from "../utils/notify.js";

// PUBLIC institute self-signup (Phase 5): an institute registers, pays via
// Razorpay (the PLATFORM's account), and its space is auto-provisioned — a
// Tenant, its own settings/branding, and its first institute admin — then the
// admin is signed straight in.
//
// SAFETY: this is only available when tenant isolation is ON
// (TENANT_ENFORCEMENT=on). Without isolation a new institute admin wouldn't be
// scoped and could see platform-wide data, so signup stays disabled until
// enforcement is enabled.

const TRIAL_TENANT_DAYS = 14;

const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "static", "assets", "cdn", "help",
  "support", "status", "blog", "docs", "dashboard", "login", "signup",
]);

const norm = (e) => String(e || "").toLowerCase().trim();
const normSlug = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const validSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s);

export const instituteSignupEnabled = () => process.env.TENANT_ENFORCEMENT === "on";

// GET /api/institute-signup/config — plans + payment availability + enabled flag.
export async function signupConfig(req, res) {
  res.json({
    enabled: instituteSignupEnabled(),
    payEnabled: razorpayConfigured(),
    keyId: razorpayKeyId(),
    plans: await getTenantPlans(),
  });
}

// GET /api/institute-signup/availability?slug=&email=
export async function checkAvailability(req, res) {
  const slug = normSlug(req.query.slug || "");
  const email = norm(req.query.email || "");
  const reserved = !!slug && RESERVED_SLUGS.has(slug);
  const [slugTaken, emailTaken] = await runUnscoped(() =>
    Promise.all([
      slug && validSlug(slug) ? Tenant.findOne({ slug }).select("_id") : Promise.resolve(null),
      email ? User.findOne({ email }).select("_id") : Promise.resolve(null),
    ])
  );
  res.json({
    slug,
    slugValid: !!slug && validSlug(slug) && !reserved,
    slugAvailable: !!slug && validSlug(slug) && !reserved && !slugTaken,
    reserved,
    emailAvailable: !email || !emailTaken,
  });
}

// Shared validation + offer resolution for order/provision.
async function resolveSignup(body) {
  const name = String(body?.name || "").trim();
  const slug = normSlug(body?.slug || name);
  const adminEmail = norm(body?.adminEmail);
  const offer = await computeOffer({
    planKey: body?.plan,
    couponCode: body?.couponCode,
    referralCode: body?.referralCode,
    selfEmail: adminEmail,
    audience: "tenant",
  });
  return { name, slug, adminEmail, offer };
}

// POST /api/institute-signup/order — create a Razorpay order for a paid plan
// (or signal { free:true } for the trial / a ₹0 total / payments-off).
export async function createInstituteOrder(req, res) {
  if (!instituteSignupEnabled()) return res.status(400).json({ message: "Institute signup is not available yet." });

  const { name, slug, adminEmail, offer } = await resolveSignup(req.body);
  if (!name) return res.status(400).json({ message: "Institute name is required." });
  if (!validSlug(slug) || RESERVED_SLUGS.has(slug)) return res.status(400).json({ message: "Please choose a valid, available subdomain." });
  if (!adminEmail) return res.status(400).json({ message: "Admin email is required." });
  if (!offer) return res.status(400).json({ message: "Choose a valid plan." });

  const [slugTaken, emailTaken] = await runUnscoped(() =>
    Promise.all([Tenant.findOne({ slug }).select("_id"), User.findOne({ email: adminEmail }).select("_id")])
  );
  if (slugTaken) return res.status(409).json({ message: "That subdomain is already taken." });
  if (emailTaken) return res.status(409).json({ message: "That admin email is already registered." });

  if (offer.plan.key === "trial" || offer.finalPrice <= 0 || !razorpayConfigured()) {
    return res.json({ free: true, finalPrice: offer.finalPrice });
  }

  try {
    const order = await createRazorpayOrder({
      amount: offer.finalPrice,
      receipt: `inst_${slug}_${Date.now()}`,
      notes: { slug, email: adminEmail, plan: offer.plan.key, audience: "institute" },
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayKeyId(), finalPrice: offer.finalPrice });
  } catch (e) {
    res.status(502).json({ message: e.message || "Could not start the payment." });
  }
}

// POST /api/institute-signup — verify payment (if any) and PROVISION the
// institute: Tenant + its settings + first institute admin. Signs the admin in.
export async function provisionInstitute(req, res) {
  if (!instituteSignupEnabled()) return res.status(400).json({ message: "Institute signup is not available yet." });

  const { name, slug, adminEmail, offer } = await resolveSignup(req.body);
  const adminName = String(req.body?.adminName || "").trim();
  const adminPassword = String(req.body?.adminPassword || "");

  if (!name) return res.status(400).json({ message: "Institute name is required." });
  if (!validSlug(slug) || RESERVED_SLUGS.has(slug)) return res.status(400).json({ message: "Please choose a valid, available subdomain." });
  if (!adminName || !adminEmail || !adminPassword) return res.status(400).json({ message: "Admin name, email and password are required." });
  if (adminPassword.length < 6) return res.status(400).json({ message: "Admin password must be at least 6 characters." });
  if (!offer) return res.status(400).json({ message: "Choose a valid plan." });

  const isTrial = offer.plan.key === "trial";
  let paymentId;

  // Paid plan → require a verified Razorpay payment.
  if (!isTrial && razorpayConfigured() && offer.finalPrice > 0) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "No payment was received. Please try again." });
    }
    if (!verifyPaymentSignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature })) {
      return res.status(400).json({ message: "Payment could not be verified. Please try again." });
    }
    paymentId = razorpay_payment_id;
  }

  // Compute validity.
  const expiresAt = new Date();
  if (isTrial) expiresAt.setDate(expiresAt.getDate() + TRIAL_TENANT_DAYS);
  else expiresAt.setMonth(expiresAt.getMonth() + (offer.plan.months || 0));

  // Provision atomically-ish (unscoped: creating a NEW tenant's data). If the
  // admin creation fails, roll back the tenant/settings we just made.
  let created;
  try {
    created = await runUnscoped(async () => {
      const [slugTaken, emailTaken] = await Promise.all([
        Tenant.findOne({ slug }).select("_id"),
        User.findOne({ email: adminEmail }).select("_id"),
      ]);
      if (slugTaken) { const e = new Error("That subdomain is already taken."); e.status = 409; throw e; }
      if (emailTaken) { const e = new Error("That admin email is already registered."); e.status = 409; throw e; }

      const tenant = await Tenant.create({
        name,
        slug,
        status: "active",
        ownerName: adminName,
        ownerEmail: adminEmail,
        subscriptionPlan: offer.plan.key,
        subscriptionMonths: isTrial ? 0 : offer.plan.months,
        subscriptionPrice: offer.finalPrice,
        isTrial,
        paymentId,
        expiresAt,
      });

      try {
        // The institute's own settings/branding (name pre-filled). Explicit
        // tenantId so the compound (tenantId,key) unique index is satisfied.
        await Settings.create({ key: "site", tenantId: tenant._id, siteName: name });

        const admin = await User.create({
          name: adminName,
          email: adminEmail,
          password: adminPassword,
          role: "institute_admin",
          tenantId: tenant._id,
          isEmailVerified: true,
        });
        return { tenant, admin };
      } catch (inner) {
        // Roll back partial provisioning.
        await Settings.deleteMany({ tenantId: tenant._id }).catch(() => {});
        await Tenant.deleteOne({ _id: tenant._id }).catch(() => {});
        throw inner;
      }
    });
  } catch (e) {
    return res.status(e.status || 500).json({ message: e.message || "Could not create the institute." });
  }

  notifyNewUser(created.admin); // fire-and-forget admin notification

  res.status(201).json({
    ok: true,
    token: generateToken(created.admin._id),
    tenant: { id: created.tenant._id, name: created.tenant.name, slug: created.tenant.slug },
    admin: { id: created.admin._id, name: created.admin.name, email: created.admin.email, role: created.admin.role },
  });
}
