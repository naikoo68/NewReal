import { Router } from "express";
import { studentUpgradeOrder, studentUpgradeActivate } from "../controllers/studentSubscriptionController.js";
import { attachUser, authorize } from "../middleware/auth.js";

const router = Router();

// attachUser (not protect) so a student whose plan has lapsed can still
// subscribe/renew their own account.
const student = [attachUser, authorize("student")];

router.post("/order", ...student, studentUpgradeOrder);
router.post("/activate", ...student, studentUpgradeActivate);

export default router;
