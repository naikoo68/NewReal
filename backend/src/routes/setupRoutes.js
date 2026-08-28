import { Router } from "express";
import User from "../models/User.js";
import { seedDatabase } from "../utils/seedData.js";

const router = Router();

// Confirmation token required to wipe & rebuild an already-initialized database.
const FORCE_TOKEN = "reset-mystudyguide";

// GET /api/setup — one-time bootstrap. Seeds the database with the admin,
// student and sample content. Automatically disabled once an admin exists,
// unless ?force=reset-mystudyguide is supplied (wipes and rebuilds everything).
router.get("/", async (req, res) => {
  try {
    const force = req.query.force === FORCE_TOKEN;
    const adminExists = await User.exists({ role: "admin" });

    if (adminExists && !force) {
      return res.status(403).json({
        message:
          "Already initialized — an admin account exists, so setup is disabled. " +
          "To wipe and rebuild with fresh sample data, add ?force=reset-mystudyguide to the URL.",
      });
    }

    const info = await seedDatabase({ reset: true });
    res.json({
      message: force
        ? "✅ Database rebuilt with fresh sample data (Subject → Topic → Session → Questions)."
        : "✅ Setup complete! You can now log in.",
      admin: info.admin,
      student: info.student,
    });
  } catch (e) {
    res.status(500).json({ message: "Setup failed", error: e.message });
  }
});

export default router;
