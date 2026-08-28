import { Router } from "express";
import { storageStats, cleanupAttempts } from "../controllers/storageController.js";
import { protect, superAdminOnly } from "../middleware/auth.js";

const router = Router();
const admin = [protect, superAdminOnly]; // DB storage stats/cleanup is platform-wide (super-admin only)

router.get("/admin/storage", ...admin, storageStats);
router.post("/admin/storage/cleanup", ...admin, cleanupAttempts);

export default router;
