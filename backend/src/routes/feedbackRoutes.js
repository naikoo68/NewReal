import { Router } from "express";
import {
  createFeedback,
  listFeedback,
  toggleFeedbackRead,
  deleteFeedback,
} from "../controllers/feedbackController.js";
import { protect, authorize, optionalAuth } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Anyone (guest or student) can submit feedback.
router.post("/", optionalAuth, createFeedback);

// Admin management
router.get("/", ...admin, listFeedback);
router.patch("/:id/read", ...admin, toggleFeedbackRead);
router.delete("/:id", ...admin, deleteFeedback);

export default router;
