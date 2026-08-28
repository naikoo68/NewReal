import { Router } from "express";
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
} from "../controllers/documentController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
// Admin manages platform documents; clients manage their OWN — every controller
// scopes strictly by owner, so the two pools never mix.
const manage = [protect, authorize("admin", "client")];

router.get("/", ...manage, listDocuments);
router.get("/:id", ...manage, getDocument);
router.post("/", ...manage, createDocument);
router.put("/:id", ...manage, updateDocument);
router.delete("/:id", ...manage, deleteDocument);

export default router;
