import { Router } from "express";
import express from "express";
import {
  startAdminBackup, adminBackupJob, adminBackupFile,
  startAdminRestore, adminRestoreJob,
} from "../controllers/backupController.js";
import { protect, superAdminOnly } from "../middleware/auth.js";

const router = Router();
const admin = [protect, superAdminOnly]; // full-library backup/restore is platform-wide (super-admin only)
// A full-library restore can be a large JSON — allow a higher body limit than
// the app-wide default just for the restore endpoint.
const bigJson = express.json({ limit: "60mb" });

// Full admin content-library backup & restore (background jobs + progress).
router.post("/backup/start", ...admin, startAdminBackup);
router.get("/backup/job/:id", ...admin, adminBackupJob);
router.get("/backup/job/:id/file", ...admin, adminBackupFile);
router.post("/restore/start", ...admin, bigJson, startAdminRestore);
router.get("/restore/job/:id", ...admin, adminRestoreJob);

export default router;
