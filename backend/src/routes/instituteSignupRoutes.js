import { Router } from "express";
import {
  signupConfig,
  checkAvailability,
  createInstituteOrder,
  provisionInstitute,
} from "../controllers/instituteSignupController.js";

const router = Router();

// All PUBLIC (no auth) — this is how a brand-new institute signs itself up.
router.get("/config", signupConfig);
router.get("/availability", checkAvailability);
router.post("/order", createInstituteOrder);
router.post("/", provisionInstitute);

export default router;
