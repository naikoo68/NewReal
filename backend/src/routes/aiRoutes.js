import { Router } from "express";
import {
  aiStatus, generateQuestions, jobStatus, cancelJob, extractQuestions, generateNotes, visualizeSpec, extendExplanations, extendOneExplanation, regenerateQuestion, regenerateAll,
  listKeys, createKey, bulkCreateKeys, updateKey, deleteKey, revealKey, testKey, importEnvKeys, testAllKeys, listKeyModels, autoDetectKeyModel,
  getAiAccess, setAiMode, inferTopic, coverageGaps, outlineUnits, classifyUnits, parseSyllabus, autoDetectAllKeys, setAllKeysEnabled,
  checkQuestionsSemantic,
} from "../controllers/aiController.js";
import { protect, authorize, superAdminOnly } from "../middleware/auth.js";

const router = Router();
// Platform-level AI admin endpoints (env-key import etc.) — super-admin only.
const admin = [protect, superAdminOnly];
// Clients may generate/import questions with AI too. Key MANAGEMENT is also
// open to clients but every controller scopes strictly to the caller's own
// keys (admin → platform keys, client → their own), so pools never mix.
const manage = [protect, authorize("admin", "client")];

router.get("/status", ...manage, aiStatus);
router.post("/generate", ...manage, generateQuestions);
router.get("/job/:id", ...manage, jobStatus);
router.post("/job/:id/cancel", ...manage, cancelJob); // stop a running job, keep partial results
router.post("/extract", ...manage, extractQuestions);
router.post("/notes", ...manage, generateNotes); // generate study notes (Markdown) on a topic
router.post("/visualize", ...manage, visualizeSpec); // prompt → visualization JSON spec (Visualization Studio)
router.post("/infer-topic", ...manage, inferTopic); // name the topic a quiz's existing questions belong to
router.post("/coverage-gaps", ...manage, coverageGaps); // list uncovered syllabus areas for a topic
router.post("/outline-units", ...manage, outlineUnits); // detect units/chapters/topics in a PDF/source
router.post("/parse-syllabus", ...manage, parseSyllabus); // parse a full syllabus into { subject, topics:[{title,subtopics}] }
router.post("/classify-units", ...manage, classifyUnits); // file question stems under the right unit
router.post("/extend-explanations", ...manage, extendExplanations); // AI-enrich all explanations in a quiz/test
router.post("/extend-explanation", ...manage, extendOneExplanation); // AI-enrich ONE question's explanation
router.post("/regenerate-question", ...manage, regenerateQuestion); // analyse ONE question and rebuild its options/answer
router.post("/regenerate-all", ...manage, regenerateAll); // regenerate EVERY question in a quiz/test (background job)
router.post("/check-semantic", ...manage, checkQuestionsSemantic); // AI "deep check": match pasted questions to the bank BY MEANING, across formats

// Client AI access + pool selection (admin allowed too; setMode is client-only).
router.get("/access", ...manage, getAiAccess);
router.put("/mode", ...manage, setAiMode);

// AI key management — owner-scoped (admin manages platform keys; a client
// manages only their OWN keys).
router.get("/keys", ...manage, listKeys);
router.post("/keys", ...manage, createKey);
router.post("/keys/bulk", ...manage, bulkCreateKeys); // add many keys at once (shared preset)
router.post("/keys/import", ...admin, importEnvKeys); // import Render env keys — platform only
router.post("/keys/test-all", ...manage, testAllKeys); // test every key in the caller's pool
router.post("/keys/auto-model-all", ...manage, autoDetectAllKeys); // auto-pick a working model for every key at once
router.post("/keys/set-enabled-all", ...manage, setAllKeysEnabled); // enable/disable every key at once
router.put("/keys/:id", ...manage, updateKey);
router.delete("/keys/:id", ...manage, deleteKey);
router.get("/keys/:id/reveal", ...manage, revealKey); // return the raw key so the owner can view/copy it
router.post("/keys/:id/test", ...manage, testKey);
router.post("/keys/:id/models", ...manage, listKeyModels); // list models this key can use
router.post("/keys/:id/auto-model", ...manage, autoDetectKeyModel); // auto-find + set a working model

export default router;
