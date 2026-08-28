import { Router } from "express";
import { getSettings, updateSettings, testFacebookPost, testInstagramPost, uploadSelfieWatermark, deleteSelfieWatermark } from "../controllers/settingsController.js";
import { protect, authorize } from "../middleware/auth.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

const router = Router();

router.get("/", getSettings);
router.put("/", protect, authorize("admin"), updateSettings);
router.post("/facebook/test", protect, authorize("admin"), testFacebookPost);
router.post("/instagram/test", protect, authorize("admin"), testInstagramPost);
router.post("/selfie-watermark", protect, authorize("admin"), upload.single("image"), uploadSelfieWatermark);
router.delete("/selfie-watermark", protect, authorize("admin"), deleteSelfieWatermark);

export default router;
