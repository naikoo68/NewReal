import { Router } from "express";
import express from "express";
import {
  listStreams, createStream, updateStream, deleteStream,
  listSubjects, createSubject, updateSubject, deleteSubject,
  listTopics, createTopic, updateTopic, deleteTopic, moveTopic, listTopicItems,
  listItems, createItem,
  browseStreams, browseSubjects, browseTopics, browseItems, browseTopicItems, browseStreamItems,
  playQuiz, allSubjects, myItems, moveItem, updateItem, splitItem, splitTopic, mergeItem, moveQuestions, copyQuestions, shareContent,
  incomingShares, acceptShare, acceptShareJob, declineShare, sharePlacement, removeSharedWithMe,
  startBackup, backupJobStatus, backupJobFile, startRestore, restoreJobStatus,
  toggleStreamPublicLink, toggleSubjectPublicLink, toggleTopicPublicLink, getPublicNode,
} from "../controllers/practiceController.js";
import { protect, authorize, optionalAuth } from "../middleware/auth.js";

const router = Router();
// Content-management routes are shared by admins (platform content) and clients
// (their own private content) — every controller scopes results by owner.
const admin = [protect, authorize("admin", "client")];

// Student browse (visibility-filtered). Attempting an item reuses /tests/:id.
router.get("/browse/:kind/streams", optionalAuth, browseStreams);
router.get("/browse/:kind/streams/:streamId/subjects", optionalAuth, browseSubjects);
router.get("/browse/:kind/streams/:streamId/items", optionalAuth, browseStreamItems); // Previous Papers: papers directly under a stream
router.get("/browse/:kind/subjects/:subjectId/topics", optionalAuth, browseTopics); // My Quiz
router.get("/browse/:kind/subjects/:subjectId/items", optionalAuth, browseItems); // My Test Series
router.get("/browse/:kind/topics/:topicId/items", optionalAuth, browseTopicItems); // My Quiz

// PUBLIC (no auth): open a shared stream/subject/topic → lists its shareable
// items. Declared before the auth-protected node routes below.
router.get("/public/node/:token", getPublicNode);

// Play a "My Quiz" practice quiz with immediate answer reveal (questions incl.
// answers). optionalAuth: the FREE first quiz of a topic is attemptable without
// login; playQuiz enforces login+subscription for every other quiz (and
// login-only for Previous Papers).
router.get("/quiz/:id/play", optionalAuth, playQuiz);

// The caller's own practice items (client dashboard).
router.get("/my-items", ...admin, myItems);

// Back up ALL of the caller's own My Practice content, and restore it later
// (additive — always creates fresh copies). Both run as background jobs so the
// UI can show a live % progress bar.
// A restored admin backup can be large — allow a higher body limit for restore.
const bigJson = express.json({ limit: "60mb" });
router.post("/backup/start", ...admin, startBackup);
router.get("/backup/job/:id", ...admin, backupJobStatus);
router.get("/backup/job/:id/file", ...admin, backupJobFile);
router.post("/restore/start", bigJson, ...admin, startRestore);
router.get("/restore/job/:id", ...admin, restoreJobStatus);

// Share practice content (stream/subject/topic/quiz/test) with another
// REGISTERED user by email (account-to-account). Creates a PENDING share the
// recipient must accept.
router.post("/share", ...admin, shareContent);
// Recipient's incoming shares + accept (duplicate into their account) / decline.
router.get("/shares/incoming", ...admin, incomingShares);
router.get("/shares/job/:id", ...admin, acceptShareJob); // poll accept progress (declared before "/shares/:id/...")
router.get("/shares/:id/placement", ...admin, sharePlacement); // where-to-save options for the accept dialog
router.post("/shares/:id/accept", ...admin, acceptShare); // starts a background copy job, returns { jobId }
router.post("/shares/:id/decline", ...admin, declineShare);
// Remove content that was shared WITH me (reference/view access) from my
// dashboard — un-shares it from my account without touching the owner's copy.
router.post("/shared/remove", ...admin, removeSharedWithMe);

// Admin — streams
router.get("/streams", ...admin, listStreams);
router.post("/streams", ...admin, createStream);
router.put("/streams/:id", ...admin, updateStream);
router.delete("/streams/:id", ...admin, deleteStream);
router.patch("/streams/:id/public-link", ...admin, toggleStreamPublicLink); // public share link for a whole stream
router.get("/streams/:streamId/subjects", ...admin, listSubjects);

// Admin — subjects
router.post("/subjects", ...admin, createSubject);
router.put("/subjects/:id", ...admin, updateSubject);
router.delete("/subjects/:id", ...admin, deleteSubject);
router.patch("/subjects/:id/public-link", ...admin, toggleSubjectPublicLink); // public share link for a whole subject
router.get("/subjects/:subjectId/items", ...admin, listItems); // My Test Series items
router.get("/subjects/:subjectId/topics", ...admin, listTopics); // My Quiz topics

// Admin — topics (My Quiz)
router.post("/topics", ...admin, createTopic);
router.put("/topics/:id", ...admin, updateTopic);
router.patch("/topics/:id/move", ...admin, moveTopic); // relocate a topic (+ its quizzes)
router.post("/topics/:id/split", ...admin, splitTopic); // split all a topic's questions into quizzes of N
router.delete("/topics/:id", ...admin, deleteTopic);
router.patch("/topics/:id/public-link", ...admin, toggleTopicPublicLink); // public share link for a whole topic
router.get("/topics/:topicId/items", ...admin, listTopicItems); // My Quiz quizzes

// Admin — flat list of all practice subjects (for composing tests from practice)
router.get("/all-subjects", ...admin, allSubjects);

// Admin — items (practice test-series). Questions/visibility/attempt reuse /tests.
router.post("/items", ...admin, createItem);
router.post("/items/:id/split", ...admin, splitItem); // split a practice quiz into quizzes of N
router.post("/items/:id/merge", ...admin, mergeItem); // merge other My-Quiz items (same topic) into this one
router.post("/items/:id/move-questions", ...admin, moveQuestions); // move SELECTED questions to another quiz (same topic)
router.post("/items/:id/copy-questions", ...admin, copyQuestions); // COPY SELECTED questions into another quiz (originals kept)
router.patch("/items/:id/move", ...admin, moveItem); // relocate a practice item
router.patch("/items/:id", ...admin, updateItem); // update name / remembered AI topic

export default router;
