import { Router } from "express";
import { submitQuiz } from "../controllers/quizController.js";
import { optionalAuth, requireStudentSubscription } from "../middleware/auth.js";

const router = Router();

// Optional auth: anonymous visitors can still practice a quiz (attempt not
// saved). A LOGGED-IN student needs an active subscription to submit; admins &
// clients are unaffected (requireStudentSubscription only gates students).
router.post("/:quizId/submit", optionalAuth, requireStudentSubscription, submitQuiz);

export default router;
