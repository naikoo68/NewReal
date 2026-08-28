import UserManual from "../models/UserManual.js";

// Public read — returns the whole manual tree. The frontend falls back to its
// built-in default content when this is empty (so the manual is never blank).
export async function getManual(req, res) {
  const doc = await UserManual.findOne({ key: "manual" }).lean();
  res.json({ sections: doc?.sections || [] });
}

// Admin write — replaces the whole manual tree in one save. The editor sends
// the entire `sections` array, so a full replace keeps things simple and
// avoids per-node id bookkeeping.
export async function updateManual(req, res) {
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
  const doc = await UserManual.findOneAndUpdate(
    { key: "manual" },
    { key: "manual", sections },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ sections: doc.sections || [] });
}
