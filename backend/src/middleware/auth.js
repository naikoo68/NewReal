import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { runUnscoped, setCurrentTenantId, setUnscoped } from "../utils/tenantContext.js";

// Bind the request's tenant scope based on the authenticated user:
//   - super-admin ("admin"): operates ACROSS institutes (unscoped). May focus
//     on ONE institute by sending an X-Admin-Tenant: <tenantId> header.
//   - everyone else (institute_admin / client / student): locked to their OWN
//     tenant — a trusted source that overrides any client-sent X-Tenant-Host.
function applyUserTenantScope(req, user) {
  if (user.role === "admin") {
    const target = String(req.headers["x-admin-tenant"] || "").trim();
    if (/^[a-f0-9]{24}$/i.test(target)) setCurrentTenantId(target);
    else setUnscoped();
    return;
  }
  if (user.tenantId) setCurrentTenantId(user.tenantId);
}

// Verifies the JWT from the Authorization header and attaches req.user.
export async function protect(req, res, next) {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    token = header.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await runUnscoped(() => User.findById(decoded.id));
    if (!user) return res.status(401).json({ message: "User no longer exists" });
    if (user.status === "blocked") {
      return res.status(403).json({ message: "Your account has been blocked" });
    }
    if (user.deleted) {
      return res.status(403).json({ message: "This account has been deleted" });
    }
    if (user.expiresAt && user.expiresAt.getTime() < Date.now()) {
      return res.status(403).json({ message: "This temporary account has expired" });
    }
    applyUserTenantScope(req, user); // super-admin cross-tenant; others locked to own tenant
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
}

// Like `protect`, but does NOT block EXPIRED accounts — it only requires a
// valid token and a non-blocked user. Used for endpoints an expired client
// must still reach: viewing their profile and upgrading/renewing their plan.
export async function attachUser(req, res, next) {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) token = header.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Not authorized, no token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await runUnscoped(() => User.findById(decoded.id));
    if (!user) return res.status(401).json({ message: "User no longer exists" });
    if (user.status === "blocked") return res.status(403).json({ message: "Your account has been blocked" });
    if (user.deleted) return res.status(403).json({ message: "This account has been deleted" });
    applyUserTenantScope(req, user);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
}

// Restricts a route to specific roles, e.g. authorize("admin").
// Admin tier: requiring "admin" ALSO admits "institute_admin" — both run the
// admin panel, and tenant scoping already limits an institute_admin to their
// own institute's data. Routes that must stay platform-wide (super-admin only)
// use `superAdminOnly` below instead.
export function authorize(...roles) {
  const allowed = new Set(roles);
  if (allowed.has("admin")) allowed.add("institute_admin");
  return (req, res, next) => {
    if (!req.user || !allowed.has(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient permissions" });
    }
    next();
  };
}

// Restricts a route to the platform SUPER-ADMIN only ("admin"). Use for
// cross-tenant / platform-wide actions an institute_admin must never perform
// (managing institutes, full-library backup/restore, storage, platform
// integrations like Facebook and the platform AI keys).
export function superAdminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: super-admin only" });
  }
  next();
}

// True when a "student" account has an ACTIVE paid/trial subscription (its
// studentPlanExpiresAt is in the future). Non-students are always considered
// "active" here — their access is governed by their own role rules.
export function studentSubscriptionActive(user) {
  if (!user) return false;
  if (user.role !== "student") return true;
  return !!(user.studentPlanExpiresAt && new Date(user.studentPlanExpiresAt).getTime() > Date.now());
}

// Gate premium student features (attempting quizzes/test-series, the
// performance Dashboard) behind an active student subscription. Anonymous
// callers (no req.user — e.g. optionalAuth routes serving public/free previews)
// and non-student roles (admin/client) pass through untouched; only a
// logged-in student WITHOUT an active plan is blocked. Responds 402 with
// { subscriptionRequired: true } so the frontend can show the upgrade paywall.
export function requireStudentSubscription(req, res, next) {
  if (!req.user) return next(); // anonymous — leave public/free flows alone
  if (studentSubscriptionActive(req.user)) return next();
  return res.status(402).json({
    subscriptionRequired: true,
    message: "A subscription is required to access this. Please choose a plan to continue.",
  });
}

// Attaches req.user if a valid token is present, but never blocks the request.
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
      const user = await runUnscoped(() => User.findById(decoded.id));
      const expired = user?.expiresAt && user.expiresAt.getTime() < Date.now();
      if (user && user.status !== "blocked" && !user.deleted && !expired) {
        req.user = user;
        applyUserTenantScope(req, user);
      }
    } catch {
      /* ignore invalid token for optional auth */
    }
  }
  next();
}
