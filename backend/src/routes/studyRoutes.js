import { Router } from "express";
import {
  listInstitutions, createInstitution, updateInstitution, deleteInstitution,
  listSmSubjects, createSmSubject, updateSmSubject, deleteSmSubject,
  listSmClasses, createSmClass, updateSmClass, deleteSmClass,
  listSmFiles, createSmFile, updateSmFile, deleteSmFile,
} from "../controllers/studyController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];

// Institutions (public read)
router.get("/institutions", listInstitutions);
router.post("/institutions", ...admin, createInstitution);
router.put("/institutions/:id", ...admin, updateInstitution);
router.delete("/institutions/:id", ...admin, deleteInstitution);

// Subjects
router.get("/institutions/:institutionId/subjects", listSmSubjects);
router.post("/sm-subjects", ...admin, createSmSubject);
router.put("/sm-subjects/:id", ...admin, updateSmSubject);
router.delete("/sm-subjects/:id", ...admin, deleteSmSubject);

// Classes
router.get("/sm-subjects/:subjectId/classes", listSmClasses);
router.post("/sm-classes", ...admin, createSmClass);
router.put("/sm-classes/:id", ...admin, updateSmClass);
router.delete("/sm-classes/:id", ...admin, deleteSmClass);

// Files
router.get("/sm-classes/:classId/files", listSmFiles);
router.post("/sm-files", ...admin, createSmFile);
router.put("/sm-files/:id", ...admin, updateSmFile);
router.delete("/sm-files/:id", ...admin, deleteSmFile);

export default router;
