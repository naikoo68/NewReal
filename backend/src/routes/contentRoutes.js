import { Router } from "express";
import {
  listStreams,
  createStream,
  updateStream,
  deleteStream,
  listStreamSubjects,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  listQuizzes,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizQuestions,
  listQuestions,
  listAllQuestions,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
  findDuplicates,
  checkQuestions,
  moveQuiz,
  splitQuiz,
  splitTopic,
  mergeQuiz,
} from "../controllers/contentController.js";
import { protect, authorize, optionalAuth } from "../middleware/auth.js";

const router = Router();
const admin = [protect, authorize("admin")];
// Question endpoints shared by admins and clients (owner-scoped in controllers).
const manage = [protect, authorize("admin", "client")];

// Streams (top level)
router.get("/streams", listStreams);
router.post("/streams", ...admin, createStream);
router.put("/streams/:id", ...admin, updateStream);
router.delete("/streams/:id", ...admin, deleteStream);
router.get("/streams/:streamId/subjects", listStreamSubjects);

// Subjects
router.get("/subjects", listSubjects);
router.post("/subjects", ...admin, createSubject);
router.put("/subjects/:id", ...admin, updateSubject);
router.delete("/subjects/:id", ...admin, deleteSubject);

// Topics (within a subject)
router.get("/subjects/:subjectId/topics", listTopics);
router.post("/topics", ...admin, createTopic);
router.put("/topics/:id", ...admin, updateTopic);
router.post("/topics/:id/split", ...admin, splitTopic); // split all a topic's questions into quizzes of N
router.delete("/topics/:id", ...admin, deleteTopic);

// Sessions (within a topic)
router.get("/topics/:topicId/sessions", listSessions);
router.post("/sessions", ...admin, createSession);
router.put("/sessions/:id", ...admin, updateSession);
router.delete("/sessions/:id", ...admin, deleteSession);

// Quizzes (within a session)
router.get("/sessions/:sessionId/quizzes", listQuizzes);
router.post("/quizzes", ...admin, createQuiz);
router.put("/quizzes/:id", ...admin, updateQuiz);
router.patch("/quizzes/:id/move", ...admin, moveQuiz);
router.post("/quizzes/:id/split", ...admin, splitQuiz); // split a quiz's questions into quizzes of N
router.post("/quizzes/:id/merge", ...admin, mergeQuiz); // merge other quizzes (same session) into this one
router.delete("/quizzes/:id", ...admin, deleteQuiz);
router.get("/quizzes/:quizId/questions", optionalAuth, listQuizQuestions);

// Questions
router.get("/questions", ...admin, listAllQuestions);
router.get("/questions/duplicates", ...manage, findDuplicates);
router.post("/questions/check", ...manage, checkQuestions); // "did this question come from my bank?" checker
router.get("/sessions/:sessionId/questions", listQuestions);
router.post("/questions", ...admin, createQuestion);
router.post("/questions/bulk", ...manage, bulkCreateQuestions);
router.put("/questions/:id", ...manage, updateQuestion);
router.delete("/questions/:id", ...manage, deleteQuestion);

export default router;
