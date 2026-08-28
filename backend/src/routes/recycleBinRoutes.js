import { Router } from "express";
import {
  listRecycleBin,
  restoreItem,
  permanentDeleteItem,
  emptyRecycleBin,
} from "../controllers/recycleBinController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Content-library Recycle Bin (admin only).
router.get("/", ...admin, listRecycleBin);              // list all soft-deleted content items
router.post("/restore", ...admin, restoreItem);          // { type, id } → un-delete
router.delete("/", ...admin, emptyRecycleBin);           // permanently empty the whole bin
router.delete("/:type/:id", ...admin, permanentDeleteItem); // permanently delete one item

export default router;
