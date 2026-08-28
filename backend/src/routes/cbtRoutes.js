import { Router } from "express";
import {
  getCbtPortal,
  getCbtExam,
  registerPortal,
  verifyPortal,
  loginPortal,
  forgotPasswordPortal,
  resetPasswordPortal,
  changePasswordPortal,
  listRegistrations,
  deleteRegistration,
  startCbt,
  registerCbtView,
  submitCbt,
  getCbtResult,
  myCbtResults,
  listReleasedRankings,
  examRankings,
  getCbtPortalUrl,
  listCbtExams,
  listCbtCandidates,
  addCbtExam,
  updateCbtExam,
  releaseCbtResults,
  removeCbtExam,
  cbtLeaderboard,
  listCbtStudents,
  setLateEntryAccess,
} from "../controllers/cbtController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Public (NO auth) — the single exam portal, plus taking an exam and viewing a
// (deferred) result. Students sign in with just their name + email on the
// client. Declared before admin routes.
router.get("/portal", getCbtPortal); // the one shareable exam page (lists exams)
router.post("/register", registerPortal); // register: name+email+password → OTP
router.post("/verify", verifyPortal); // verify OTP → sessionToken (completes registration)
router.post("/login", loginPortal); // returning student: email+password → sessionToken
router.post("/forgot", forgotPasswordPortal); // request a password-reset code
router.post("/reset", resetPasswordPortal); // set a new password with the code → sessionToken
router.post("/change-password", changePasswordPortal); // signed-in student changes password
router.get("/exam/:token", getCbtExam); // exam META
router.post("/exam/:token/start", startCbt); // hand out questions (verified portal session)
router.post("/exam/:token/view", registerCbtView); // count an open (impression)
router.post("/exam/:token/submit", submitCbt);
router.get("/result/:resultToken", getCbtResult); // pending until results released
// Student dashboard (session-gated via ?email=&session=)
router.get("/my", myCbtResults); // the student's completed exams + their ranks
router.get("/rankings", listReleasedRankings); // exams with released results
router.get("/rankings/:token", examRankings); // full leaderboard for one exam

// Admin — manage the portal, live toggle, end time, results release, rankings.
router.get("/admin/portal-url", ...admin, getCbtPortalUrl);
router.get("/admin/exams", ...admin, listCbtExams);
router.get("/admin/candidates", ...admin, listCbtCandidates); // My Tests to add
router.get("/admin/registrations", ...admin, listRegistrations); // registered candidates
router.delete("/admin/registrations/:id", ...admin, deleteRegistration);
router.get("/admin/:id/leaderboard", ...admin, cbtLeaderboard);
router.get("/admin/:id/students", ...admin, listCbtStudents); // per-exam joined-student status
router.patch("/admin/:id/late-entry", ...admin, setLateEntryAccess); // grant/revoke one student's late entry
router.patch("/admin/:id/add", ...admin, addCbtExam);
router.patch("/admin/:id/update", ...admin, updateCbtExam); // { live?, endAt? }
router.patch("/admin/:id/release", ...admin, releaseCbtResults);
router.patch("/admin/:id/remove", ...admin, removeCbtExam);

export default router;
