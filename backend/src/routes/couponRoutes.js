import { Router } from "express";
import { listCoupons, createCoupon, updateCoupon, deleteCoupon } from "../controllers/couponController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.get("/", ...admin, listCoupons);
router.post("/", ...admin, createCoupon);
router.put("/:id", ...admin, updateCoupon);
router.delete("/:id", ...admin, deleteCoupon);

export default router;
