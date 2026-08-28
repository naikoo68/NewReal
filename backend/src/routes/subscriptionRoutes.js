import { Router } from "express";
import { upgradeOrder, upgradeActivate } from "../controllers/subscriptionController.js";
import { attachUser, authorize } from "../middleware/auth.js";

const router = Router();

// attachUser (not protect) so an expired client can still upgrade/renew.
const client = [attachUser, authorize("client")];

router.post("/order", ...client, upgradeOrder);
router.post("/activate", ...client, upgradeActivate);

export default router;
