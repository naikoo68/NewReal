import { Router } from "express";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, postScheduleNow, postQuestionNow, scheduleQuestion, previewQuestionImage, suggestTags } from "../controllers/facebookController.js";
import { protect, superAdminOnly } from "../middleware/auth.js";

const router = Router();
const admin = [protect, superAdminOnly]; // platform Facebook/Instagram integration (super-admin only)

// Scheduled Facebook question auto-posting (admin only). The Page connection
// (id/token/enable) lives in Settings; these routes manage the schedules.
router.get("/schedules", ...admin, listSchedules);
router.post("/schedules", ...admin, createSchedule);
router.put("/schedules/:id", ...admin, updateSchedule);
router.delete("/schedules/:id", ...admin, deleteSchedule);
router.post("/schedules/:id/post-now", ...admin, postScheduleNow);

// Per-question actions (from the question view): post now / schedule at a time.
router.post("/post-question", ...admin, postQuestionNow);
router.post("/schedule-question", ...admin, scheduleQuestion);
router.post("/preview-image", ...admin, previewQuestionImage);
router.get("/suggest-tags/:id", ...admin, suggestTags);

export default router;
