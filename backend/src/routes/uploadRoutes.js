import { Router } from "express";
import multer from "multer";
import { uploadToCloudinary, isCloudinaryConfigured } from "../config/cloudinary.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — allows PDFs/docs, not just images
});

// POST /api/upload  (admin) — uploads a file (image, PDF, doc…) to Cloudinary.
router.post("/", protect, authorize("admin"), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file provided" });
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: "File uploads aren't set up yet. Ask the admin to add Cloudinary keys, or paste a file link instead.",
      });
    }
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const { url, format, bytes } = await uploadToCloudinary(dataUri);
    res.status(201).json({ url, format, bytes, name: req.file.originalname });
  } catch (err) {
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

export default router;
