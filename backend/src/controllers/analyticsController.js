import User from "../models/User.js";
import TestSeries from "../models/TestSeries.js";
import Attempt from "../models/Attempt.js";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Stream from "../models/Stream.js";
import PracticeStream from "../models/PracticeStream.js";
import PracticeSubject from "../models/PracticeSubject.js";
import PracticeTopic from "../models/PracticeTopic.js";

// GET /api/stats — public, live counts for the Home/About statistics section.
// Recomputed on every request, so it updates the moment a user registers or
// content is added. Any of these keys can be bound to a stat row in admin.
export async function publicStats(req, res) {
  // The client-combined totals must match the admin Clients page, which counts
  // content OWNED by (active, non-deleted) client accounts — not all practice
  // content (admin-created practice content is ownerless and must be excluded).
  const clientDocs = await User.find({ role: "client", deleted: { $ne: true } }).select("_id").lean();
  const clientIds = clientDocs.map((u) => u._id);

  const [
    students, users,
    contentQuizzes, practiceQuizzes,
    contentTests, practiceTests,
    questions,
    contentSubjects, practiceSubjects,
    contentTopics, practiceTopics,
    contentStreams, practiceStreams,
    attempts,
    clientQuizzes, clientTests, clientQuestions,
  ] = await Promise.all([
    User.countDocuments({ role: "student" }),
    User.countDocuments(),
    // Quizzes = platform content quizzes (Quiz) + all "My Practice" quizzes.
    Quiz.countDocuments(),
    TestSeries.countDocuments({ practice: true, practiceKind: "quiz" }),
    // Test series = platform test series + all "My Practice" tests.
    TestSeries.countDocuments({ practice: { $ne: true } }),
    TestSeries.countDocuments({ practice: true, practiceKind: "test" }),
    // Questions = everything (admin content + all client content).
    Question.countDocuments(),
    // Subjects / topics / streams = platform + "My Practice" equivalents.
    Subject.countDocuments(),
    PracticeSubject.countDocuments(),
    Topic.countDocuments(),
    PracticeTopic.countDocuments(),
    Stream.countDocuments(),
    PracticeStream.countDocuments(),
    Attempt.countDocuments(),
    // The separate "all clients combined" block — client-owned only (admin).
    TestSeries.countDocuments({ owner: { $in: clientIds }, practiceKind: "quiz" }),
    TestSeries.countDocuments({ owner: { $in: clientIds }, practiceKind: "test" }),
    Question.countDocuments({ owner: { $in: clientIds } }),
  ]);
  // Platform-wide GRAND TOTALS = admin content + all "My Practice" content, so
  // every metric in this block counts admin and client data together.
  const quizzes = contentQuizzes + practiceQuizzes;
  const tests = contentTests + practiceTests;
  const subjects = contentSubjects + practiceSubjects;
  const topics = contentTopics + practiceTopics;
  const streams = contentStreams + practiceStreams;
  const clients = clientIds.length;
  // Never cache — always reflect the current counts.
  res.set("Cache-Control", "no-store");
  res.json({
    students, users, clients, quizzes, tests, questions, subjects, topics, streams, attempts,
    clientQuizzes, clientTests, clientQuestions,
  });
}

// GET /api/admin/content-overview — live, split content counts for the admin
// dashboard. Two clearly-separated groups so the numbers aren't conflated:
//   • practice  → the "My Practice" side (PracticeStream/Subject/Topic +
//                 TestSeries with practice=true, by kind), and its questions.
//   • content   → the platform "Content & Test Series" side (Stream/Subject/
//                 Topic/Quiz + regular TestSeries with practice!=true).
export async function adminContentOverview(req, res) {
  // Ids of every practice item, to attribute questions to practice vs content.
  const practiceItems = await TestSeries.find({ practice: true }).select("_id").lean();
  const practiceIds = practiceItems.map((i) => i._id);

  const [
    pStreams, pSubjects, pTopics, pQuizzes, pTests, pPapers, pQuestions,
    cStreams, cSubjects, cTopics, cQuizzes, cTests, totalQuestions,
  ] = await Promise.all([
    PracticeStream.countDocuments(),
    PracticeSubject.countDocuments(),
    PracticeTopic.countDocuments(),
    TestSeries.countDocuments({ practice: true, practiceKind: "quiz" }),
    TestSeries.countDocuments({ practice: true, practiceKind: "test" }),
    TestSeries.countDocuments({ practice: true, practiceKind: "paper" }),
    Question.countDocuments({ testSeries: { $in: practiceIds } }),
    Stream.countDocuments(),
    Subject.countDocuments(),
    Topic.countDocuments(),
    Quiz.countDocuments(),
    TestSeries.countDocuments({ practice: { $ne: true } }),
    Question.countDocuments(),
  ]);

  res.set("Cache-Control", "no-store");
  res.json({
    practice: {
      streams: pStreams, subjects: pSubjects, topics: pTopics,
      quizzes: pQuizzes, tests: pTests, papers: pPapers, questions: pQuestions,
    },
    content: {
      streams: cStreams, subjects: cSubjects, topics: cTopics,
      quizzes: cQuizzes, tests: cTests,
      // Content questions = everything not attributed to a practice item.
      questions: Math.max(0, totalQuestions - pQuestions),
    },
  });
}

const initials = (name = "") =>
  name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// GET /api/admin/analytics  (admin) — platform-wide stats
export async function platformAnalytics(req, res) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalUsers, activeUsers, totalTests, totalAttempts] = await Promise.all([
    User.countDocuments(),
    Attempt.distinct("user", { createdAt: { $gte: since } }).then((a) => a.length),
    TestSeries.countDocuments(),
    Attempt.countDocuments(),
  ]);

  const planAgg = await User.aggregate([{ $group: { _id: "$plan", count: { $sum: 1 } } }]);
  const avgScoreAgg = await Attempt.aggregate([{ $group: { _id: null, avg: { $avg: "$percentage" } } }]);

  res.json({
    totalUsers,
    activeUsers,
    totalTests,
    totalAttempts,
    planDistribution: planAgg,
    avgScore: Math.round(avgScoreAgg[0]?.avg || 0),
  });
}

// GET /api/me/dashboard — everything the student dashboard needs in one call.
export async function studentDashboard(req, res) {
  const user = req.user;

  const [attempts, enrolled, upcoming] = await Promise.all([
    Attempt.find({ user: user._id }).sort("-createdAt").limit(10).populate("testSeries", "name marks"),
    TestSeries.find({ _id: { $in: user.enrolledTests || [] } }).select("name questions marks duration difficulty"),
    TestSeries.find({ schedule: { $gte: new Date() }, status: { $in: ["scheduled", "published"] } })
      .sort("schedule")
      .limit(3)
      .select("name schedule"),
  ]);

  const recentScores = attempts.map((a) => ({
    id: a._id,
    name: a.testSeries?.name || "Quiz",
    score: a.score,
    total: a.testSeries?.marks || a.maxScore || a.total * 4,
    date: new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    percentile: a.percentage,
  }));

  const avgPercentile = Math.round(
    attempts.reduce((s, a) => s + (a.percentage || 0), 0) / (attempts.length || 1)
  );

  const performanceTrend = [...attempts]
    .reverse()
    .map((a) => ({
      label: new Date(a.createdAt).toLocaleDateString("en-IN", { month: "short", day: "2-digit" }),
      value: a.percentage,
    }));

  res.json({
    profile: {
      name: user.name,
      email: user.email,
      avatar: user.avatar || initials(user.name),
      streak: user.streak,
      plan: user.plan,
    },
    stats: {
      enrolled: enrolled.length,
      upcoming: upcoming.length,
      completed: attempts.length,
      avgPercentile,
    },
    enrolledSeries: enrolled,
    upcomingTests: upcoming.map((t) => ({
      id: t._id,
      name: t.name,
      date: t.schedule ? new Date(t.schedule).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "TBA",
    })),
    recentScores,
    performanceTrend,
  });
}

// GET /api/admin/performance  (admin) — who took what + rankings.
// Returns per-user aggregates (for the ranking tables, sortable by combined /
// quizzes / tests) plus the recent attempts feed (who took which quiz/test).
export async function adminPerformance(req, res) {
  const users = await Attempt.aggregate([
    {
      $group: {
        _id: "$user",
        quizzes: { $sum: { $cond: [{ $eq: ["$type", "quiz"] }, 1, 0] } },
        tests: { $sum: { $cond: [{ $eq: ["$type", "test"] }, 1, 0] } },
        taken: { $sum: 1 },
        totalScore: { $sum: "$score" },
        quizScore: { $sum: { $cond: [{ $eq: ["$type", "quiz"] }, "$score", 0] } },
        testScore: { $sum: { $cond: [{ $eq: ["$type", "test"] }, "$score", 0] } },
        avgPct: { $avg: "$percentage" },
        lastAt: { $max: "$createdAt" },
      },
    },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $match: { "user.role": "student" } },
    { $sort: { taken: -1, totalScore: -1 } },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        name: "$user.name",
        email: "$user.email",
        quizzes: 1,
        tests: 1,
        taken: 1,
        totalScore: 1,
        quizScore: 1,
        testScore: 1,
        avgPct: { $round: ["$avgPct", 0] },
        lastAt: 1,
      },
    },
  ]);

  const recent = await Attempt.find()
    .sort("-createdAt")
    .limit(300)
    .populate("user", "name email role")
    .populate("quiz", "title")
    .populate("testSeries", "name")
    .lean();

  const attempts = recent
    .filter((a) => a.user) // skip attempts whose user was deleted
    .map((a) => ({
      _id: a._id,
      userId: a.user._id,
      userName: a.user.name,
      email: a.user.email,
      type: a.type,
      title: a.type === "test" ? a.testSeries?.name || "Test" : a.quiz?.title || "Quiz",
      score: a.score,
      percentage: a.percentage,
      correct: a.correct,
      total: a.total,
      createdAt: a.createdAt,
    }));

  res.json({ users, attempts });
}

// GET /api/admin/performance/user/:userId  (admin) — one user's full history
export async function userPerformanceDetail(req, res) {
  const user = await User.findById(req.params.userId).select("name email createdAt");
  if (!user) return res.status(404).json({ message: "User not found" });

  const list = await Attempt.find({ user: req.params.userId })
    .sort("-createdAt")
    .populate("quiz", "title")
    .populate("testSeries", "name")
    .lean();

  const attempts = list.map((a) => ({
    _id: a._id,
    type: a.type,
    title: a.type === "test" ? a.testSeries?.name || "Test" : a.quiz?.title || "Quiz",
    score: a.score,
    percentage: a.percentage,
    correct: a.correct,
    incorrect: a.incorrect,
    attempted: a.attempted,
    total: a.total,
    timeTaken: a.timeTaken,
    createdAt: a.createdAt,
  }));

  const quizzes = attempts.filter((a) => a.type === "quiz").length;
  const tests = attempts.filter((a) => a.type === "test").length;
  const avgPct = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.percentage || 0), 0) / attempts.length) : 0;
  const totalScore = attempts.reduce((s, a) => s + (a.score || 0), 0);
  const best = attempts.reduce((m, a) => Math.max(m, a.percentage || 0), 0);

  res.json({
    user: { name: user.name, email: user.email, joined: user.createdAt },
    summary: { quizzes, tests, taken: attempts.length, avgPct, totalScore, best },
    attempts,
  });
}

// DELETE /api/admin/performance/user/:userId  (admin) — clear one user's history
export async function clearUserPerformance(req, res) {
  const { deletedCount } = await Attempt.deleteMany({ user: req.params.userId });
  res.json({ message: "User performance cleared", deleted: deletedCount });
}

// DELETE /api/admin/performance  (admin) — clear ALL attempt history
export async function clearAllPerformance(req, res) {
  const { deletedCount } = await Attempt.deleteMany({});
  res.json({ message: "All performance cleared", deleted: deletedCount });
}

// GET /api/leaderboard — ranks registered students by activity
// (quizzes + tests taken), with total score as the tie-breaker.
export async function leaderboard(req, res) {
  const top = await Attempt.aggregate([
    {
      $group: {
        _id: "$user",
        quizzes: { $sum: { $cond: [{ $eq: ["$type", "quiz"] }, 1, 0] } },
        tests: { $sum: { $cond: [{ $eq: ["$type", "test"] }, 1, 0] } },
        taken: { $sum: 1 },
        totalScore: { $sum: "$score" },
      },
    },
    // Only rank real registered students (exclude admins / deleted users).
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $match: { "user.role": "student" } },
    { $sort: { taken: -1, totalScore: -1 } },
    { $limit: 20 },
    { $project: { name: "$user.name", quizzes: 1, tests: 1, taken: 1, totalScore: 1 } },
  ]);

  const currentId = req.user?._id?.toString();
  const rows = top.map((row, i) => ({
    rank: i + 1,
    name: row._id.toString() === currentId ? "You" : row.name,
    avatar: initials(row.name),
    quizzes: row.quizzes,
    tests: row.tests,
    taken: row.taken,
    score: row.totalScore,
    isCurrentUser: row._id.toString() === currentId,
  }));
  res.json(rows);
}


// GET /api/me/performance  (any logged-in user — client or student)
// A personal, real-time performance view scoped to req.user._id:
//   • every attempted quiz AND test, grouped by item, with the full per-attempt
//     history (score, %, correct/incorrect, time, timestamp) — a quiz/test can
//     be attempted many times, so each submission is its own row;
//   • weak areas derived from the questions the user got WRONG, aggregated by
//     subject (Question.section) and topic (Question.topic).
// Client "My Quiz" / "My Test" practice items are stored as Attempt{type:"test"}
// with a TestSeries ref, so we read the quiz-vs-test kind from the test series'
// practiceKind. Attempts are scoped by `user` (Attempt has no owner field).
export async function myPerformance(req, res) {
  const list = await Attempt.find({ user: req.user._id })
    .sort("-createdAt")
    .limit(2000) // generous cap so a huge history can't blow up the response
    // Pull the location so each item can show its Stream › Subject › Topic path.
    // Client practice items (TestSeries) carry practiceStream/Subject/Topic;
    // platform quizzes derive Subject from the quiz and Topic from its session.
    .populate({
      path: "testSeries",
      select: "name practiceKind practice practiceStream practiceSubject practiceTopic",
      populate: [
        { path: "practiceStream", select: "name" },
        { path: "practiceSubject", select: "name" },
        { path: "practiceTopic", select: "name" },
      ],
    })
    .populate({
      path: "quiz",
      select: "title subject session",
      populate: [
        { path: "subject", select: "name" },
        { path: "session", select: "title topic", populate: { path: "topic", select: "name" } },
      ],
    })
    .lean();

  // Group attempts by the item they belong to (newest attempt first, because the
  // list is already sorted -createdAt, so the first time we meet an item is its
  // most recent attempt → items end up ordered by most-recent activity).
  const itemsMap = new Map();
  for (const a of list) {
    const ts = a.testSeries;
    const isTest = a.type === "test";
    // Kind: platform quiz → "quiz"; client practice → the test series' practiceKind.
    const kind = isTest ? (ts?.practiceKind === "test" ? "test" : "quiz") : "quiz";
    const itemId = String(ts?._id || a.quiz?._id || a._id);
    const title = isTest ? ts?.name || "Untitled test" : a.quiz?.title || "Untitled quiz";
    // Where the item lives, so the UI can show the full Stream › Subject › Topic.
    const location = isTest
      ? { stream: ts?.practiceStream?.name || null, subject: ts?.practiceSubject?.name || null, topic: ts?.practiceTopic?.name || null }
      : { stream: null, subject: a.quiz?.subject?.name || null, topic: a.quiz?.session?.topic?.name || null };
    if (!itemsMap.has(itemId)) itemsMap.set(itemId, { id: itemId, title, kind, location, attempts: [] });
    itemsMap.get(itemId).attempts.push({
      _id: a._id,
      score: a.score,
      percentage: a.percentage,
      correct: a.correct,
      incorrect: a.incorrect,
      attempted: a.attempted,
      total: a.total,
      timeTaken: a.timeTaken,
      createdAt: a.createdAt,
    });
  }
  const items = [...itemsMap.values()].map((it) => {
    const best = it.attempts.reduce((m, x) => Math.max(m, x.percentage || 0), 0);
    const latest = it.attempts[0]; // attempts are newest-first
    return {
      ...it,
      count: it.attempts.length,
      best,
      lastAt: latest?.createdAt || null,
      lastPct: latest?.percentage ?? null,
    };
  });

  // ---- Weak areas: tally attempted vs wrong PER QUESTION, then join each
  // question to its subject (section) / topic so we can group and rank areas by
  // accuracy. Only answered questions (chosen != null) count toward accuracy.
  const perQ = new Map(); // questionId -> { attempted, wrong }
  for (const a of list) {
    for (const r of a.responses || []) {
      if (!r?.question || r.chosen == null) continue;
      const id = String(r.question);
      const e = perQ.get(id) || { attempted: 0, wrong: 0 };
      e.attempted += 1;
      if (r.isCorrect === false) e.wrong += 1;
      perQ.set(id, e);
    }
  }
  const qIds = [...perQ.keys()];
  const qDocs = qIds.length
    ? await Question.find({ _id: { $in: qIds } }).select("section topic subject").populate("subject", "name").lean()
    : [];

  const subjAgg = new Map(); // subject name -> { name, attempted, wrong }
  const topicAgg = new Map(); // "subject › topic" -> { name, subject, attempted, wrong }
  for (const q of qDocs) {
    const e = perQ.get(String(q._id));
    if (!e) continue;
    const subjName = (q.section && q.section.trim()) || q.subject?.name || "General";
    const topicName = (q.topic && String(q.topic).trim()) || "";
    const sa = subjAgg.get(subjName) || { name: subjName, attempted: 0, wrong: 0 };
    sa.attempted += e.attempted;
    sa.wrong += e.wrong;
    subjAgg.set(subjName, sa);
    if (topicName) {
      const key = `${subjName} › ${topicName}`;
      const ta = topicAgg.get(key) || { name: topicName, subject: subjName, attempted: 0, wrong: 0 };
      ta.attempted += e.attempted;
      ta.wrong += e.wrong;
      topicAgg.set(key, ta);
    }
  }
  // Rank weakest first: lowest accuracy, then most wrong answers.
  const toAreas = (m) =>
    [...m.values()]
      .map((x) => ({ ...x, accuracy: x.attempted ? Math.round(((x.attempted - x.wrong) / x.attempted) * 100) : 0 }))
      .sort((a, b) => a.accuracy - b.accuracy || b.wrong - a.wrong);
  const subjects = toAreas(subjAgg);
  const topics = toAreas(topicAgg);
  const weakSubjects = subjects.filter((s) => s.wrong > 0 && s.accuracy < 70);
  const weakTopics = topics.filter((t) => t.wrong > 0 && t.accuracy < 70);

  // ---- Overall summary
  const totalAttempts = list.length;
  const quizzesTaken = items.filter((i) => i.kind === "quiz").length;
  const testsTaken = items.filter((i) => i.kind === "test").length;
  const avgPct = totalAttempts ? Math.round(list.reduce((s, a) => s + (a.percentage || 0), 0) / totalAttempts) : 0;
  const totalAnswered = list.reduce((s, a) => s + (a.attempted || 0), 0);
  const totalCorrect = list.reduce((s, a) => s + (a.correct || 0), 0);
  const overallAccuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
  const best = list.reduce((m, a) => Math.max(m, a.percentage || 0), 0);

  res.json({
    summary: {
      totalAttempts,
      itemsAttempted: items.length,
      quizzesTaken,
      testsTaken,
      avgPct,
      overallAccuracy,
      best,
      totalAnswered,
      totalCorrect,
    },
    items,
    subjects,
    topics,
    weakSubjects,
    weakTopics,
  });
}


// GET /api/me/performance/attempt/:attemptId  (owner-scoped)
// The full question-by-question review of ONE completed attempt: every question
// with the option the user chose, the correct option, whether it was right, and
// the explanation — so a client can see exactly which questions they got right
// and wrong. Scoped by `user` (an Attempt has no owner field).
export async function myAttemptReview(req, res) {
  const attempt = await Attempt.findOne({ _id: req.params.attemptId, user: req.user._id })
    .populate("testSeries", "name practiceKind")
    .populate("quiz", "title")
    .lean();
  if (!attempt) return res.status(404).json({ message: "Attempt not found." });

  // Load the questions referenced by this attempt's responses, then join each
  // stored { chosen, isCorrect } with its question to build a review row that
  // mirrors the post-submit review shape (so the same renderer works).
  const ids = (attempt.responses || []).map((r) => r.question).filter(Boolean);
  const qDocs = ids.length
    ? await Question.find({ _id: { $in: ids } })
        .select("type text image options correct columnA columnB tableRows assertion reason graph explanation optionExplanations difficulty section")
        .lean()
    : [];
  const qMap = new Map(qDocs.map((q) => [String(q._id), q]));

  const review = (attempt.responses || []).map((r, i) => {
    const q = qMap.get(String(r.question)) || {};
    return {
      _id: String(r.question || i),
      type: q.type || "mcq",
      section: q.section,
      text: q.text || "(this question is no longer available)",
      image: q.image,
      options: q.options || [],
      columnA: q.columnA || [],
      columnB: q.columnB || [],
      tableRows: q.tableRows,
      assertion: q.assertion,
      reason: q.reason,
      graph: q.graph,
      correct: q.correct,
      difficulty: q.difficulty,
      explanation: q.explanation,
      optionExplanations: q.optionExplanations || [],
      chosen: r.chosen ?? null, // option index the user picked (null = skipped)
      isCorrect: !!r.isCorrect,
    };
  });

  res.json({
    _id: String(attempt._id),
    title: attempt.type === "test" ? attempt.testSeries?.name || "Test" : attempt.quiz?.title || "Quiz",
    kind: attempt.type === "test" ? (attempt.testSeries?.practiceKind === "test" ? "test" : "quiz") : "quiz",
    createdAt: attempt.createdAt,
    score: attempt.score,
    percentage: attempt.percentage,
    correct: attempt.correct,
    incorrect: attempt.incorrect,
    attempted: attempt.attempted,
    total: attempt.total,
    timeTaken: attempt.timeTaken,
    review,
  });
}
