import { Router } from "express";
import {
  listTests,
  listAllTests,
  getTest,
  createTest,
  updateTest,
  togglePublish,
  deleteTest,
  submitTest,
  getTestAccess,
  updateTestAccess,
  getTestQuestions,
  addTestQuestion,
  deleteTestQuestion,
  populateTest,
  autoBuildTest,
  toTestSeries,
  toMyTest,
  moveTestSeries,
  toQuiz,
  quizToMyQuiz,
  togglePublicLink,
  getPublicTest,
  submitPublicTest,
  registerPublicView,
  getFreeTest,
  submitFreeTest,
  listSharedTests,
  listPublicAttempts,
} from "../controllers/testController.js";
import { protect, authorize, optionalAuth, requireStudentSubscription } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];
// Shared by admins (platform tests) and clients (their own practice items);
// controllers guard each record by owner.
const manage = [protect, authorize("admin", "client")];

// Public share link — NO auth. Declared first so "public" is never captured by
// the "/:id" param routes below.
router.get("/public/:token", getPublicTest);
router.post("/public/:token/view", registerPublicView); // count an open (impression)
router.post("/public/:token/submit", submitPublicTest);

router.get("/", optionalAuth, listTests);
router.get("/admin/all", ...admin, listAllTests);
router.get("/admin/shared", ...admin, listSharedTests); // shared-link tracker
router.get("/:id/public-attempts", ...admin, listPublicAttempts); // completions for one shared item
router.patch("/:id/public-link", ...manage, togglePublicLink); // enable/disable public sharing
router.get("/:id/access", ...admin, getTestAccess);
router.put("/:id/access", ...admin, updateTestAccess);
router.get("/:id/questions", ...manage, getTestQuestions);
router.post("/:id/questions", ...manage, addTestQuestion);
router.post("/:id/populate", ...manage, populateTest); // pull questions from quiz/practice bank (admin or owning client)
router.post("/:id/auto-build", ...manage, autoBuildTest); // auto-pick questions by subject/topic/type/difficulty blueprint
router.patch("/:id/to-test-series", ...admin, toTestSeries); // My Test → Test Series
router.patch("/:id/to-my-test", ...admin, toMyTest); // Test Series → My Test
router.patch("/:id/move-series", ...admin, moveTestSeries); // Test Series → another Exam/Post
router.patch("/from-quiz/:id/to-my-quiz", ...admin, quizToMyQuiz); // Quiz → My Quiz
router.patch("/:id/to-quiz", ...admin, toQuiz); // My Quiz → Quiz
router.delete("/:id/questions/:qid", ...manage, deleteTestQuestion);
// FREE first-test-per-subject — no login needed (optionalAuth). Declared before
// the generic "/:id" so they resolve to these handlers.
router.get("/:id/free", optionalAuth, getFreeTest);
router.post("/:id/free-submit", optionalAuth, submitFreeTest);
// Attempting a test-series requires an active student subscription (admins &
// clients pass through; free/public/CBT attempts use the separate /free and
// /public endpoints above and are unaffected).
router.get("/:id", protect, requireStudentSubscription, getTest);
router.post("/:id/submit", protect, requireStudentSubscription, submitTest);

router.post("/", ...admin, createTest);
router.put("/:id", ...manage, updateTest);
router.patch("/:id/publish", ...admin, togglePublish);
router.delete("/:id", ...manage, deleteTest);

export default router;
