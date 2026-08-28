import express from "express";
import { globalSearch } from "../controllers/searchController.js";
import { optionalAuth } from "../middleware/auth.js";

const router = express.Router();

// Public metadata search. optionalAuth lets an admin's token unlock the
// full (all-metadata) result set while remaining open to anonymous visitors.
router.get("/search", optionalAuth, globalSearch);

export default router;
