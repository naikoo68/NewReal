import { Router } from "express";
import {
  listActiveNotices,
  listNotices,
  createNotice,
  updateNotice,
  deleteNotice,
} from "../controllers/noticeController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.get("/", listActiveNotices); // public — ticker
router.get("/all", ...admin, listNotices);
router.post("/", ...admin, createNotice);
router.put("/:id", ...admin, updateNotice);
router.delete("/:id", ...admin, deleteNotice);

export default router;
