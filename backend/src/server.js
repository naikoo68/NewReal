import "dotenv/config";
// Register global Mongoose plugins (adds `tenantId` to every model) BEFORE
// ./app.js is imported — app.js pulls in the routes/controllers/models, so the
// plugin must be registered first or some schemas would compile without it.
import "./config/registerModelPlugins.js";
import app from "./app.js";
import connectDB from "./config/db.js";
import { seedIfEmpty } from "./utils/seedData.js";
import { ensureAdminFromEnv } from "./utils/ensureAdmin.js";
import { backfillTenants } from "./utils/backfillTenants.js";
import { ensureDefaultStream } from "./utils/ensureDefaultStream.js";
import { runDueFbSchedules } from "./config/facebook.js";
import Settings from "./models/Settings.js";
import TestSeries from "./models/TestSeries.js";
import User from "./models/User.js";
import Tenant from "./models/Tenant.js";

const PORT = process.env.PORT || 5000;

// Global safety net — never let a stray async error take down the whole API.
// In modern Node an unhandled promise rejection (or an uncaught exception) exits
// the process with status 1, which on a single-instance host (e.g. Render free
// tier) takes the ENTIRE site down until it restarts. These almost always come
// from isolated, non-fatal async work — a flaky AI-provider request, a slow
// third-party key probe, a background generation/extend job — so we LOG them
// (with stack) and keep serving instead of crashing. Per-request errors are
// already handled by Express's error middleware; this only catches the detached
// ones that would otherwise be fatal.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.stack || err);
});

// NOTE: Expired accounts are NEVER deleted. When a client's subscription/trial
// ends we only RESTRICT access (the `protect` middleware blocks their content
// and the frontend shows an Upgrade screen) — their account and the quizzes/
// tests they built are preserved so everything returns the moment they renew.

// One-time migration: make every EXISTING test series private so students only
// see tests they've been granted (matching the new default for new tests).
// Runs once — a flag in Settings prevents it from repeating, so an admin can
// still make specific tests public afterwards.
async function privatizeExistingTests() {
  try {
    const settings = await Settings.findOneAndUpdate(
      { key: "site" },
      {},
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (settings.testsPrivatized) return;
    const { modifiedCount } = await TestSeries.updateMany(
      { visibleToAll: { $ne: false } },
      { $set: { visibleToAll: false } }
    );
    settings.testsPrivatized = true;
    await settings.save();
    console.log(`🔒 Made ${modifiedCount} existing test series private (one-time migration).`);
  } catch (err) {
    console.error("Test-privacy migration skipped:", err.message);
  }
}

// One-time migration: grant AI access to every EXISTING client account. AI was
// gated behind a master switch that defaulted OFF and was never turned on by
// registration/subscription, so clients couldn't generate questions. Every
// plan already carries AI limits, so all active clients should have access.
// Runs once (a flag in Settings prevents repeats), so an admin can still turn
// AI off for a specific client afterwards without it flipping back on.
async function enableClientAiAccess() {
  try {
    const settings = await Settings.findOneAndUpdate(
      { key: "site" },
      {},
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (settings.aiClientAccessBackfilled) return;
    const { modifiedCount } = await User.updateMany(
      { role: "client", aiAccess: { $ne: true } },
      { $set: { aiAccess: true } }
    );
    settings.aiClientAccessBackfilled = true;
    await settings.save();
    console.log(`🤖 Granted AI access to ${modifiedCount} existing client account(s) (one-time migration).`);
  } catch (err) {
    console.error("Client AI-access migration skipped:", err.message);
  }
}

// One-time migration (multi-tenancy Phase 2): assign every EXISTING record to a
// "default" institute (tenant), so nothing disappears when tenant scoping turns
// on in Phase 3. Runs once — a flag in Settings prevents repeats — and is
// idempotent regardless, so a repeat run is harmless. Fully automatic: the
// admin never has to run anything by hand.
async function backfillTenantsOnce() {
  try {
    const settings = await Settings.findOne({ key: "site" }).select("tenantsBackfilled").lean();
    if (settings?.tenantsBackfilled) return;
    const { backfilled } = await backfillTenants();
    // Atomic flag set so it doesn't clobber the other one-time flags saved
    // concurrently during startup.
    await Settings.updateOne({ key: "site" }, { $set: { tenantsBackfilled: true } }, { upsert: true });
    console.log(`🏫 Assigned ${backfilled} existing record(s) to the default institute (one-time multi-tenant backfill).`);
  } catch (err) {
    console.error("Tenant backfill skipped:", err.message);
  }
}

// Migrate the Settings index from the legacy GLOBAL-unique `key` to a per-tenant
// compound unique (tenantId, key), so each institute can have its own "site"
// settings document. Idempotent: drop attempts on a missing index are ignored,
// and createIndex is a no-op if it already exists. Runs every startup (cheap).
async function ensureSettingsIndexes() {
  try {
    const coll = Settings.collection;
    try { await coll.dropIndex("key_1"); } catch { /* already gone */ }
    await coll.createIndex({ tenantId: 1, key: 1 }, { unique: true });
  } catch (err) {
    console.error("Settings index migration skipped:", err.message);
  }
}

// One-time cleanup: earlier the Tenant.customDomain field defaulted to "" and
// carried a unique+sparse index. Because "" is a real value it got indexed, so
// creating a SECOND institute collided on the empty string. We removed the
// default; here we UNSET any existing "" values so the sparse unique index only
// tracks real custom domains. Idempotent.
async function cleanTenantCustomDomains() {
  try {
    const r = await Tenant.updateMany({ customDomain: "" }, { $unset: { customDomain: 1 } });
    if (r.modifiedCount) console.log(`🧹 Cleared empty customDomain on ${r.modifiedCount} tenant(s).`);
  } catch (err) {
    console.error("customDomain cleanup skipped:", err.message);
  }
}

async function start() {
  await connectDB();

  // Start listening immediately so the host detects an open port quickly.
  app.listen(PORT, () => {
    console.log(`✔ My Study Guide API running on http://localhost:${PORT}`);
  });

  // Migrate Settings uniqueness to per-tenant (one-time, idempotent).
  ensureSettingsIndexes();

  // Clear legacy empty customDomain values so a 2nd institute can be created.
  cleanTenantCustomDomains();

  // Make existing test series private (one-time).
  privatizeExistingTests();

  // Grant AI access to existing client accounts (one-time).
  enableClientAiAccess();

  // Assign existing data to the default institute (one-time multi-tenant backfill).
  backfillTenantsOnce();

  // Facebook scheduled auto-posting: check every minute for due schedules.
  // (The /api/health ping also triggers this as a safety net after downtime.)
  setInterval(() => { runDueFbSchedules().catch(() => {}); }, 60 * 1000);

  // Ensure a default "JKSSB" stream exists and move any stream-less subjects in.
  ensureDefaultStream();

  // Seed in the background (never blocks startup, never crashes the server).
  // Runs only when the database has no users — handy on hosts without shell
  // access (e.g. Render free tier). Disable with AUTO_SEED=off.
  if (process.env.AUTO_SEED !== "off") {
    seedIfEmpty()
      .then((seeded) => {
        if (seeded) console.log("✔ Database was empty — seeded sample data (admin@mystudyguide.com / admin123).");
      })
      .catch((err) => console.error("Auto-seed skipped:", err.message))
      // After seeding, ensure the env-configured admin exists (create/recover)
      // and that seeded subjects are placed inside the default stream.
      .finally(() => {
        ensureAdminFromEnv().catch((e) => console.error("ensureAdmin skipped:", e.message));
        ensureDefaultStream();
      });
  } else {
    ensureAdminFromEnv().catch((e) => console.error("ensureAdmin skipped:", e.message));
  }
}

start();
