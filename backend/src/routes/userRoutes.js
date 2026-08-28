import { Router } from "express";
import {
  listUsers,
  listClients,
  listDeletedClients,
  createUser,
  updateUser,
  deleteUser,
  restoreUser,
  permanentDeleteUser,
  toggleStatus,
  updatePlan,
  adminResetPassword,
  getUserAccess,
  updateUserAccess,
  applyClientFeatureAccess,
} from "../controllers/userController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

router.get("/", ...admin, listUsers);
router.get("/clients", ...admin, listClients); // self-service client accounts
router.get("/clients/deleted", ...admin, listDeletedClients); // Recycle bin (soft-deleted clients)
router.patch("/clients/feature-access", ...admin, applyClientFeatureAccess); // apply feature flags to ALL clients
router.post("/", ...admin, createUser);
router.put("/:id", ...admin, updateUser);
router.delete("/:id", ...admin, deleteUser); // soft delete (client → Recycle bin)
router.post("/:id/restore", ...admin, restoreUser); // restore from Recycle bin
router.delete("/:id/permanent", ...admin, permanentDeleteUser); // permanent delete (cannot be undone)
router.patch("/:id/status", ...admin, toggleStatus);
router.patch("/:id/plan", ...admin, updatePlan);
router.post("/:id/reset-password", ...admin, adminResetPassword);
router.get("/:id/access", ...admin, getUserAccess);
router.put("/:id/access", ...admin, updateUserAccess);

export default router;
