import Question from "../models/Question.js";
import Session from "../models/Session.js";
import Attempt from "../models/Attempt.js";

// POST /api/quiz/:sessionId/submit  (auth optional — records attempt if logged in)
// Body: { answers: { questionId: optionIndex }, timeTaken }
export async function submitQuiz(req, res) {
  // Quizzes are open to everyone by default, but an admin can revoke a specific
  // logged-in user's quiz access.
  if (req.user && req.user.quizAccess === false) {
    return res.status(403).json({ message: "Quiz access has been disabled for your account." });
  }

  const { answers = {}, timeTaken = 0 } = req.body;
  const quizId = req.params.quizId;
  const questions = await Question.find({ quiz: quizId });
  if (!questions.length) {
    return res.status(404).json({ message: "No questions for this quiz" });
  }

  let correct = 0;
  const weak = new Set();
  const responses = questions.map((q) => {
    const ans = answers[q._id];
    const provided = ans !== undefined && ans !== null;
    // Both MCQ and matching are answered by picking one option index.
    const isCorrect = provided && ans === q.correct;
    if (isCorrect) correct += 1;
    else if (provided) weak.add(q.topic || "General");
    return { question: q._id, chosen: provided ? ans : null, isCorrect };
  });

  const attempted = Object.keys(answers).length;
  const incorrect = attempted - correct;
  const total = questions.length;
  const score = correct * 4 - incorrect; // +4 / -1
  const percentage = Math.round((correct / total) * 100);

  const payload = {
    total,
    attempted,
    correct,
    incorrect,
    score,
    maxScore: total * 4,
    percentage,
    timeTaken,
    weakTopics: [...weak],
  };

  // Persist only for authenticated users.
  if (req.user) {
    // Derive the session from the first question (they all share the same quiz).
    const sessionId = questions[0]?.session || null;
    await Attempt.create({
      user: req.user._id,
      type: "quiz",
      quiz: quizId,
      session: sessionId,
      responses,
      ...payload,
    });
    payload.saved = true;
  }

  res.status(201).json(payload);
}
