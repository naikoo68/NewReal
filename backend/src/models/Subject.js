import mongoose from "mongoose";

const subjectSchema = new mongoose.Schema(
  {
    stream: { type: mongoose.Schema.Types.ObjectId, ref: "Stream" }, // parent stream
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    icon: { type: String, default: "BookOpen" },
    color: { type: String, default: "from-blue-500 to-indigo-600" },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    // Recycle Bin (soft delete) — see utils/softDelete.js.
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Subject", subjectSchema);
