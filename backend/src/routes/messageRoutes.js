import { Router } from "express";
import {
  createMessage,
  listMessages,
  unreadCount,
  toggleRead,
  deleteMessage,
} from "../controllers/messageController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.post("/", protect, createMessage); // must be logged in to contact
router.get("/", ...admin, listMessages);
router.get("/unread-count", ...admin, unreadCount);
router.patch("/:id/read", ...admin, toggleRead);
router.delete("/:id", ...admin, deleteMessage);

export default router;
