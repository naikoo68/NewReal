import Stream from "../models/Stream.js";
import Subject from "../models/Subject.js";
import Topic from "../models/Topic.js";
import Session from "../models/Session.js";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import TestSeries from "../models/TestSeries.js";

// Escape user input so it is treated as a literal string inside a RegExp.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NAME_LIMIT = 8; // max results per metadata type
// The primary full-text search scans the WHOLE collection (relevance-ranked).
// This cap only bounds the temporary regex fallback used while the text index
// is still building — set high enough to cover the entire bank in practice.
const Q_CANDIDATES = 50000;
const Q_RESULTS = 15; // max question results returned

// Option labels that must NOT count as search words (roman numerals ii–xv;
// single letters a/b/c/d and lone digits 1/2 are dropped by the length rule).
const OPTION_LABELS = new Set(["ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "xiii", "xiv", "xv"]);

// Meaningful words from a query. Splits on ANY non-alphanumeric char so option
// labels like "(a)", "1.", "(ii)" detach from the real word ("(a)Dual" → "dual"),
// then drops single letters, lone digits and roman-numeral labels — so the
// search keys off the question body only, never the option marker or its place.
const meaningfulWords = (query) => [
  ...new Set(
    String(query || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 2 && !OPTION_LABELS.has(w))
  ),
];

// All searchable text of a question, across every question type.
function questionHaystack(q) {
  const parts = [
    q.text,
    q.explanation,
    q.topic,
    q.section,
    q.assertion,
    q.reason,
    ...(q.options || []),
    ...(q.optionExplanations || []),
    ...(q.columnA || []),
    ...(q.columnB || []),
    ...(Array.isArray(q.tableRows) ? q.tableRows.flat(Infinity) : []),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// 0–100%: full phrase present → 100; else the share of query words found.
function questionMatchPercent(queryLower, words, q) {
  const hay = questionHaystack(q);
  if (!hay) return 0;
  if (queryLower.length >= 3 && hay.includes(queryLower)) return 100;
  if (!words.length) return 0;
  const matched = words.filter((w) => hay.includes(w)).length;
  return Math.round((matched / words.length) * 100);
}

// Short preview of a question stem for the results list.
const preview = (t, n = 90) => {
  const s = String(t || "").replace(/\$/g, "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};

// GET /api/search?q=...
// One endpoint powering the landing-page, admin and (future) global search.
// Finds content by NAME (streams/subjects/topics/quizzes/tests) AND finds
// QUESTIONS by their body text / options / statements (word-level matching).
// Visibility is role-aware via optionalAuth:
//   • admin           → everything (incl. drafts and client-owned items)
//   • logged-in user  → published platform content + their own
//   • anonymous       → published platform content only
export async function globalSearch(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ query: q, count: 0, results: [], meta: { version: "search-v4", scope: "n/a" } });
    }

    const rx = new RegExp(escapeRegex(q), "i");
    const isAdmin = req.user?.role === "admin";
    const active = isAdmin ? {} : { isActive: true };
    const results = [];

    // ---- 1) Metadata (names) ----
    const [streams, subjects, topics, sessions, quizzes, tests] = await Promise.all([
      Stream.find({ name: rx, ...active }).limit(NAME_LIMIT).lean(),
      Subject.find({ name: rx, ...active }).limit(NAME_LIMIT).populate("stream", "name").lean(),
      Topic.find({ title: rx, ...active }).limit(NAME_LIMIT).populate("subject", "name").lean(),
      Session.find({ title: rx, ...active }).limit(NAME_LIMIT).populate("subject", "name").populate("topic", "title").lean(),
      Quiz.find({ title: rx, ...active }).limit(NAME_LIMIT).populate("subject", "name").populate("session", "title topic").lean(),
      TestSeries.find(
        isAdmin ? { name: rx } : { name: rx, practice: { $ne: true }, status: "published", owner: null }
      ).limit(NAME_LIMIT).lean(),
    ]);

    for (const s of streams)
      results.push({ type: "Stream", id: String(s._id), title: s.name, subtitle: "Stream", path: `/quiz/stream/${s._id}`, adminPath: "/admin/content", active: s.isActive !== false });
    for (const s of subjects)
      results.push({ type: "Subject", id: String(s._id), title: s.name, subtitle: [s.stream?.name, "Subject"].filter(Boolean).join(" · "), path: `/quiz/${s._id}`, adminPath: "/admin/content", active: s.isActive !== false });
    for (const t of topics)
      results.push({ type: "Topic", id: String(t._id), title: t.title, subtitle: [t.subject?.name, "Topic"].filter(Boolean).join(" · "), path: t.subject ? `/quiz/${t.subject._id}/${t._id}` : "/quiz", adminPath: "/admin/content", active: t.isActive !== false });
    for (const s of sessions)
      results.push({ type: "Session", id: String(s._id), title: s.title, subtitle: [s.subject?.name, s.topic?.title].filter(Boolean).join(" · ") || "Session", path: s.subject && s.topic ? `/quiz/${s.subject._id}/${s.topic._id}/${s._id}` : "/quiz", adminPath: "/admin/content", active: s.isActive !== false });
    for (const qz of quizzes) {
      const subjId = qz.subject?._id, sessId = qz.session?._id, topicId = qz.session?.topic;
      results.push({ type: "Quiz", id: String(qz._id), title: qz.title, subtitle: [qz.subject?.name, qz.session?.title].filter(Boolean).join(" · ") || "Quiz", path: subjId && sessId && topicId ? `/quiz/${subjId}/${topicId}/${sessId}/${qz._id}` : "/quiz", adminPath: "/admin/content", active: qz.isActive !== false });
    }
    for (const t of tests) {
      const isPractice = t.practice === true;
      results.push({ type: isPractice ? (t.practiceKind === "quiz" ? "My Quiz" : "My Test") : "Test", id: String(t._id), title: t.name, subtitle: isPractice ? "Practice item" : "Test Series", path: "/test-series", adminPath: isPractice ? "/admin/practice" : "/admin/tests", active: t.status === "published" });
    }

    // ---- 2) Questions (by body / options / statements / etc.) ----
    const queryLower = q.toLowerCase();
    const allWords = meaningfulWords(q); // ignores option labels a/b/c/d, 1/2, i/ii…
    let candidateWords = [...allWords].filter((w) => w.length >= 4).sort((a, b) => b.length - a.length).slice(0, 12);
    if (!candidateWords.length) candidateWords = allWords.slice(0, 12);

    let questionsScanned = 0;
    let questionsMatched = 0;

    if (candidateWords.length) {
      const visibility = {};
      if (!isAdmin) {
        visibility.status = "published";
        visibility.owner = req.user ? { $in: [null, req.user._id] } : null;
      }
      const withRefs = (query) =>
        query
          .populate({ path: "subject", select: "name stream", populate: { path: "stream", select: "name" } })
          .populate({ path: "session", select: "title topic", populate: { path: "topic", select: "title" } })
          .populate("quiz", "title")
          .populate("testSeries", "name practice practiceKind")
          .lean();

      let candidates = [];
      let via = "text";
      // Primary: relevance-ranked full-text search — the exact question ranks
      // first regardless of how many questions exist.
      try {
        candidates = await withRefs(
          Question.find({ $text: { $search: q }, ...visibility })
            .sort({ score: { $meta: "textScore" } })
            .limit(150)
        );
      } catch {
        candidates = [];
      }
      // Fallback: word regexes (used only if the text index isn't ready yet).
      if (!candidates.length) {
        via = "regex";
        const or = [];
        for (const w of candidateWords) {
          const wrx = new RegExp(escapeRegex(w), "i");
          or.push({ text: wrx }, { options: wrx }, { assertion: wrx }, { reason: wrx }, { explanation: wrx }, { columnA: wrx }, { columnB: wrx });
        }
        candidates = await withRefs(Question.find({ $or: or, ...visibility }).limit(Q_CANDIDATES));
      }
      questionsScanned = candidates.length;
      void via;

      const scored = candidates
        .map((qq) => ({ qq, m: questionMatchPercent(queryLower, allWords, qq) }))
        .filter((x) => x.m >= 40)
        .sort((a, b) => b.m - a.m)
        .slice(0, Q_RESULTS);
      questionsMatched = scored.length;

      for (const { qq, m } of scored) {
        const streamName = qq.subject?.stream?.name || "";
        const subjName = qq.subject?.name || "";
        const topicTitle = qq.session?.topic?.title || qq.topic || "";
        const sessTitle = qq.session?.title || "";
        const quizTitle = qq.quiz?.title || "";
        let path = "/quiz";
        let adminPath = "/admin/content";
        let subtitle = "Question";
        if (qq.testSeries) {
          const ts = qq.testSeries;
          const isPractice = ts.practice === true;
          adminPath = isPractice ? "/admin/practice" : "/admin/tests";
          path = "/test-series";
          subtitle = ts.name ? `${ts.name} · Question` : "Test question";
        } else {
          const subjId = qq.subject?._id, sessId = qq.session?._id, topicId = qq.session?.topic?._id, quizId = qq.quiz?._id;
          if (subjId && sessId && topicId && quizId) path = `/quiz/${subjId}/${topicId}/${sessId}/${quizId}`;
          subtitle = [streamName, subjName, quizTitle].filter(Boolean).join(" · ") || "Question";
        }
        const result = { type: "Question", id: String(qq._id), title: preview(qq.text), subtitle, match: m, path, adminPath, active: qq.status === "published" };
        // Ship the full question for EVERYONE (students, clients, admin) so the
        // UI can open the detail panel on tap, site-wide.
        result.raw = {
          _id: String(qq._id), type: qq.type, text: qq.text, image: qq.image,
          options: qq.options, correct: qq.correct, optionExplanations: qq.optionExplanations,
          columnA: qq.columnA, columnB: qq.columnB, tableRows: qq.tableRows,
          assertion: qq.assertion, reason: qq.reason, explanation: qq.explanation,
          difficulty: qq.difficulty, status: qq.status, section: qq.section, createdAt: qq.createdAt, updatedAt: qq.updatedAt,
          stream: streamName, subject: subjName, topicName: topicTitle, session: sessTitle, quiz: quizTitle,
        };
        results.push(result);
      }
    }

    res.json({
      query: q,
      count: results.length,
      results,
      // Open /api/search?q=... in a browser to read these diagnostics.
      meta: {
        version: "search-v4",
        scope: isAdmin ? "admin (all content)" : req.user ? "user (published + own)" : "public (published only)",
        candidateWords,
        questionsScanned,
        questionsMatched,
      },
    });
  } catch (err) {
    // Never 500 the search — return the error text so it's visible in the UI.
    res.status(200).json({ query: String(req.query.q || ""), count: 0, results: [], error: err.message, meta: { version: "search-v4", scope: "error" } });
  }
}
