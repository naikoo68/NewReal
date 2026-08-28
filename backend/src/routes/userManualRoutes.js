import { Router } from "express";
import { getManual, updateManual } from "../controllers/userManualController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.get("/", getManual); // public read (clients + admin)
router.put("/", ...admin, updateManual); // admin edits the whole manual

export default router;
