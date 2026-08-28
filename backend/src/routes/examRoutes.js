import { Router } from "express";
import {
  listExams,
  createExam,
  updateExam,
  deleteExam,
  listPosts,
  createPost,
  updatePost,
  deletePost,
} from "../controllers/examController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Exams
router.get("/exams", listExams);
router.post("/exams", ...admin, createExam);
router.put("/exams/:id", ...admin, updateExam);
router.delete("/exams/:id", ...admin, deleteExam);

// Posts (sub-sections within an exam)
router.get("/exams/:examId/posts", listPosts);
router.post("/posts", ...admin, createPost);
router.put("/posts/:id", ...admin, updatePost);
router.delete("/posts/:id", ...admin, deletePost);

export default router;
