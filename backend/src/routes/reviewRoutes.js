import { Router } from "express";
import {
  createReview,
  listReviews,
  approveReview,
  rejectReview,
  deleteReview,
} from "../controllers/reviewController.js";
import { protect, authorize, optionalAuth } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Anyone (guest, student or client) can submit a review.
router.post("/", optionalAuth, createReview);

// Admin moderation
router.get("/", ...admin, listReviews);
router.patch("/:id/approve", ...admin, approveReview);
router.patch("/:id/reject", ...admin, rejectReview);
router.delete("/:id", ...admin, deleteReview);

export default router;
