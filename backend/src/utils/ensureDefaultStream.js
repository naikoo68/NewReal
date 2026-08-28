import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";

// Ensures a default "JKSSB" stream exists and that every subject belongs to a
// stream. Any subject with no stream (all existing content before streams were
// introduced) is moved into JKSSB — so nothing is ever lost. Idempotent: safe
// to run on every boot; it only touches subjects that still have no stream.
export async function ensureDefaultStream() {
  try {
    let stream = await Stream.findOne({ slug: "jkssb" });
    if (!stream) {
      stream = await Stream.create({
        name: "JKSSB",
        slug: "jkssb",
        icon: "GraduationCap",
        color: "from-blue-500 to-indigo-600",
        description: "Jammu & Kashmir Services Selection Board",
        order: 0,
      });
      console.log("✔ Created default stream: JKSSB");
    }
    const { modifiedCount } = await Subject.updateMany(
      { $or: [{ stream: { $exists: false } }, { stream: null }] },
      { $set: { stream: stream._id } }
    );
    if (modifiedCount) console.log(`📚 Moved ${modifiedCount} existing subject(s) into the JKSSB stream.`);
  } catch (err) {
    console.error("Default-stream migration skipped:", err.message);
  }
}
