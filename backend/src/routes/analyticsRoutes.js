import { Router } from "express";
import {
  platformAnalytics,
  adminContentOverview,
  studentDashboard,
  leaderboard,
  publicStats,
  adminPerformance,
  userPerformanceDetail,
  clearUserPerformance,
  clearAllPerformance,
  myPerformance,
  myAttemptReview,
} from "../controllers/analyticsController.js";
import { protect, authorize, optionalAuth, requireStudentSubscription } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.get("/stats", publicStats); // public live counts
router.get("/admin/analytics", ...admin, platformAnalytics);
router.get("/admin/content-overview", ...admin, adminContentOverview);
router.get("/admin/performance", ...admin, adminPerformance);
router.get("/admin/performance/user/:userId", ...admin, userPerformanceDetail);
router.delete("/admin/performance/user/:userId", ...admin, clearUserPerformance);
router.delete("/admin/performance", ...admin, clearAllPerformance);
// The performance Dashboard is a premium student feature (gated). Clients &
// admins pass through requireStudentSubscription untouched.
router.get("/me/dashboard", protect, requireStudentSubscription, studentDashboard);
router.get("/me/performance", protect, myPerformance); // a client's own attempts + weak areas (real-time)
router.get("/me/performance/attempt/:attemptId", protect, myAttemptReview); // full question-by-question review of one attempt
router.get("/leaderboard", optionalAuth, leaderboard);

export default router;
