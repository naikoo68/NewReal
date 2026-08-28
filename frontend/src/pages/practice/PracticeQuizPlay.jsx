import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  Clock,
  Timer,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Flag,
  Grid3x3,
  X,
  Hourglass,
  Play,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  Trophy,
  Search,
} from "lucide-react";
import { practiceService, testService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import ProgressBar from "../../components/ui/ProgressBar";
import Badge from "../../components/ui/Badge";
import MathText from "../../components/ui/MathText";
import OptionContent from "../../components/ui/OptionContent";
import StatementPairView from "../../components/ui/StatementPairView";
import TableView from "../../components/ui/TableView";
import GraphView from "../../components/ui/GraphView";
import VizView from "../../components/ui/VizView";
import AssertionReasonView from "../../components/ui/AssertionReasonView";
import Watermark from "../../components/ui/Watermark";
import FeedbackButton from "../../components/ui/FeedbackButton";
import { useZoom } from "../../context/ZoomContext";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";
import { questionDateText, searchQuestions, stemText, displayOptions } from "../../lib/questions";
import { shuffleAll, toOriginalIndex, makeSeed } from "../../lib/shuffleOptions";
import PaperExport from "../../components/admin/PaperExport";

const optionLabels = ["A", "B", "C", "D"];

const isQuestionCorrect = (q, ans) => ans !== undefined && ans !== null && ans === q.correct;

function toRoman(num) {
  const map = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of map) while (num >= v) { r += s; num -= v; }
  return r;
}

// Same timer choices as the regular Quiz, plus 15 seconds.
const TIMER_OPTIONS = [
  { label: "No timer", sub: "Practice at your own pace", value: "off" },
  { label: "15 seconds", sub: "per question", value: 15 },
  { label: "30 seconds", sub: "per question", value: 30 },
  { label: "45 seconds", sub: "per question", value: 45 },
  { label: "1 minute", sub: "per question", value: 60 },
];

// "My Quiz" practice quiz player. Mirrors the regular QuizPlay experience —
// pick a timer, one question at a time, tap an option to instantly reveal all
// options (correct = green, your wrong pick = red), explanation, palette,
// bookmarks. Loads questions WITH answers from the practice endpoint and
// records the attempt via testService.submit (so it shows in My Progress).
export default function PracticeQuizPlay() {
  const { itemId, token, freeId } = useParams();
  const isPublic = !!token; // opened via a public share link (no login needed)
  const isFree = !!freeId; // FREE first-quiz-per-topic preview (no login needed)
  const playId = itemId || token || freeId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const isClient = user?.role === "client"; // clients return to their own workspace
  const storageKey = `mpm-practice-quiz-${playId}`;

  // Any saved, unfinished progress for this quiz (so an exit/refresh can resume).
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
  })();

  const [questions, setQuestions] = useState([]);
  const [title, setTitle] = useState("Practice Quiz");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState(saved.current || 0);
  const [answers, setAnswers] = useState(saved.answers || {});
  const [timedOut, setTimedOut] = useState(saved.timedOut || {});
  const [bookmarks, setBookmarks] = useState(saved.bookmarks || {});
  const [seconds, setSeconds] = useState(saved.seconds || 0);
  const [timerMode, setTimerMode] = useState(saved.timerMode ?? null); // null=not chosen, "off", or seconds
  const [qTime, setQTime] = useState(saved.qTime ?? 0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [paper, setPaper] = useState({ paperPdfUrl: "", answerKeyPdfUrl: "", answerKeys: [], additionalInfo: "" }); // Previous Papers extras
  const [showReview, setShowReview] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");
  // Per-attempt option-shuffle seed — persisted so "Continue" keeps the SAME
  // question/option order; a new attempt gets a fresh seed (reshuffle).
  const [seed, setSeed] = useState(() => (typeof saved.seed === "number" ? saved.seed : makeSeed()));
  // Offer Continue/Start-new when an unfinished attempt is saved.
  const hasSavedSession =
    saved.timerMode != null &&
    (Object.keys(saved.answers || {}).length > 0 || (saved.current || 0) > 0 || (saved.seconds || 0) > 0);
  const [showResume, setShowResume] = useState(hasSavedSession);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);
  const { zoom, zoomIn, zoomOut } = useZoom();

  const toggleFullscreen = () => {
    if (!fullscreen) {
      setFullscreen(true);
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      setFullscreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const isTimed = typeof timerMode === "number";
  const started = timerMode !== null;

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    (isPublic ? testService.getPublic(token) : isFree ? practiceService.freeQuizPlay(freeId) : practiceService.quizPlay(itemId))
      .then((data) => {
        setQuestions(shuffleAll(data.questions || [], seed)); // reshuffle options
        setTitle(data.name || "Practice Quiz");
        setPaper({ paperPdfUrl: data.paperPdfUrl || "", answerKeyPdfUrl: data.answerKeyPdfUrl || "", answerKeys: Array.isArray(data.answerKeys) ? data.answerKeys : [], additionalInfo: data.additionalInfo || "" });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [itemId, token, freeId, isPublic, isFree, seed]);
  useEffect(load, [load]);

  // Count a public OPEN once per browser (impression tracking for shared links).
  useEffect(() => {
    if (!isPublic || !token) return;
    const key = `mpm-viewed-${token}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    testService.registerPublicView(token).catch(() => {});
  }, [isPublic, token]);

  // Saved position may point past a changed question list — clamp it.
  useEffect(() => {
    if (questions.length && current > questions.length - 1) setCurrent(0);
  }, [questions, current]);

  // Total elapsed timer.
  useEffect(() => {
    if (!started || result || showResume) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [started, result, showResume]);

  // Auto-save progress so an exit/refresh can resume this attempt.
  useEffect(() => {
    if (!loading && started && !result) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ answers, timedOut, bookmarks, seconds, current, timerMode, qTime, seed })
      );
    }
  }, [answers, timedOut, bookmarks, seconds, current, timerMode, qTime, seed, storageKey, loading, started, result]);

  const lockedAt = (i) => answers[i] !== undefined || !!timedOut[i];

  // Reset per-question countdown when the question (or mode) changes.
  useEffect(() => {
    if (!isTimed) return;
    setQTime(lockedAt(current) ? 0 : timerMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, timerMode]);

  // Per-question countdown → lock (reveal) at 0.
  useEffect(() => {
    if (!isTimed || showResume || lockedAt(current)) return;
    if (qTime <= 0) {
      setTimedOut((t) => ({ ...t, [current]: true }));
      return;
    }
    const id = setTimeout(() => setQTime((s) => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qTime, isTimed, current, answers, timedOut]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    const byId = {};
    questions.forEach((qq, i) => {
      if (answers[i] !== undefined) byId[qq._id] = toOriginalIndex(qq, answers[i]);
    });
    let graded = null;
    try {
      // FREE preview quizzes are graded LOCALLY (no server attempt is recorded
      // for a guest); public links and logged-in plays record on the server.
      if (isPublic) graded = await testService.submitPublic(token, byId, seconds);
      else if (!isFree) graded = await testService.submit(itemId, byId, seconds);
    } catch {
      /* still show a local result even if recording fails */
    }
    if (!graded) {
      let correct = 0;
      questions.forEach((qq, i) => { if (isQuestionCorrect(qq, answers[i])) correct += 1; });
      const attempted = Object.keys(answers).length;
      graded = {
        total: questions.length,
        attempted,
        correct,
        incorrect: attempted - correct,
        skipped: questions.length - attempted,
        percentage: questions.length ? Math.round((correct / questions.length) * 100) : 0,
        score: correct,
        maxScore: questions.length,
      };
    }
    graded.timeTaken = seconds;
    localStorage.removeItem(storageKey); // attempt finished — clear saved session
    setResult(graded);
    setSubmitting(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [answers, questions, seconds, itemId, token, isPublic, isFree, storageKey]);

  if (loading) return <div className="container-page"><Loading label="Loading quiz..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;
  if (!questions.length)
    return <div className="container-page"><EmptyState message="No questions in this quiz yet." /></div>;

  // Effective answer-key list: the new multi-key array if present, else the
  // legacy single key as one entry.
  const answerKeyList = (paper.answerKeys && paper.answerKeys.length)
    ? paper.answerKeys.filter((k) => k && k.url)
    : (paper.answerKeyPdfUrl ? [{ label: "Answer key", url: paper.answerKeyPdfUrl }] : []);

  // Uploaded Previous-Papers resources (question paper PDF, answer-key PDFs and
  // additional information). Shown on BOTH the start screen and the results
  // screen when present; empty/hidden for normal quizzes.
  const paperResources = (paper.paperPdfUrl || answerKeyList.length || paper.additionalInfo) ? (
    <div className="mx-auto mt-4 max-w-lg card p-5 text-left">
      <h2 className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-brand-600" /> Paper resources</h2>
      {(paper.paperPdfUrl || answerKeyList.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {paper.paperPdfUrl && <a href={paper.paperPdfUrl} target="_blank" rel="noreferrer" className="btn-outline text-sm"><FileText className="h-4 w-4" /> View question paper (PDF)</a>}
          {answerKeyList.map((k, i) => (
            <a key={i} href={k.url} target="_blank" rel="noreferrer" className="btn-outline text-sm"><FileText className="h-4 w-4" /> View {k.label || "answer key"} (PDF)</a>
          ))}
        </div>
      )}
      {paper.additionalInfo && (
        <div className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">Additional information</p>
          {paper.additionalInfo}
        </div>
      )}
    </div>
  ) : null;

  // ---- Result screen ----
  if (result) {
    const mmss = `${String(Math.floor((result.timeTaken || 0) / 60)).padStart(2, "0")}:${String((result.timeTaken || 0) % 60).padStart(2, "0")}`;
    const stats = [
      { l: "Score", v: `${result.score}/${result.maxScore ?? questions.length}`, c: "text-brand-600 dark:text-brand-400" },
      { l: "Percentage", v: `${result.percentage}%`, c: "text-brand-600 dark:text-brand-400" },
      { l: "Total", v: result.total, c: "text-slate-700 dark:text-slate-200" },
      { l: "Attempted", v: result.attempted, c: "text-slate-700 dark:text-slate-200" },
      { l: "Correct", v: result.correct, c: "text-emerald-600 dark:text-emerald-400" },
      { l: "Wrong", v: result.incorrect, c: "text-rose-600 dark:text-rose-400" },
      { l: "Time", v: mmss, c: "text-slate-700 dark:text-slate-200" },
    ];
    // Searchable review list: keep the original index so numbering/answers stay correct.
    const reviewEntries = questions.map((qq, idx) => ({ ...qq, _idx: idx }));
    const reviewResults = searchQuestions(reviewEntries, reviewSearch);
    const reviewShown = reviewResults || reviewEntries;
    return (
      <div className="container-page py-10">
        <Watermark />
        <div className="card p-8 text-center">
          <Trophy className="mx-auto h-14 w-14 text-accent-500" />
          <h1 className="mt-4 text-2xl font-extrabold">Quiz Complete</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">{title}</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {stats.map((s) => (
              <div key={s.l} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                <p className="text-xs text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => setShowReview((v) => !v)} className="btn-accent">
              <Lightbulb className="h-4 w-4" /> {showReview ? "Hide Answers" : "Review Answers"}
            </button>
            {/* Generated "Paper / Key" (built from the questions) — always
                shown. For Previous Papers, the admin-uploaded paper/answer keys
                also appear in the Paper resources panel below. */}
            <PaperExport title={title || "Practice Quiz"} questions={questions} />
            {isPublic ? (
              <button onClick={() => navigate("/")} className="btn-primary">Done</button>
            ) : isFree && !user ? (
              // Free preview finished by a guest — nudge them to unlock the rest.
              <>
                <button onClick={() => navigate(-1)} className="btn-outline">Back to Quizzes</button>
                <button onClick={() => navigate("/register")} className="btn-primary">Sign up to unlock all quizzes</button>
              </>
            ) : isClient ? (
              <button onClick={() => navigate("/client")} className="btn-primary">Back to My Practice</button>
            ) : (
              <>
                <button onClick={() => navigate(-1)} className="btn-primary">Back to Quizzes</button>
                <button onClick={() => navigate("/dashboard")} className="btn-outline">My Progress</button>
              </>
            )}
          </div>
        </div>

        {/* Uploaded question paper / answer key / additional info (papers) */}
        {paperResources}

        {/* Answer review */}
        {showReview && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Review Answers</h2>
              <div className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <input
                  value={reviewSearch}
                  onChange={(e) => setReviewSearch(e.target.value)}
                  placeholder="Search questions…  (matches 40%–100%)"
                  className="w-full bg-transparent text-sm outline-none"
                />
                {reviewSearch && (
                  <button onClick={() => setReviewSearch("")} title="Clear search" className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
                )}
              </div>
            </div>
            {reviewResults && (
              <p className="text-sm font-medium text-slate-500">{reviewResults.length} match{reviewResults.length === 1 ? "" : "es"} (40%+)</p>
            )}
            {reviewResults && reviewResults.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
                No questions match “{reviewSearch}” at 40% or higher. Try fewer or different words.
              </p>
            )}
            {reviewShown.map((q) => {
              const i = q._idx;
              const userAns = answers[i];
              const answered = userAns !== undefined && userAns !== null;
              const isCorrect = answered && userAns === q.correct;
              return (
                <div key={q._id || i} className="card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                      Question {i + 1}
                      {q._match != null && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{q._match}% match</span>
                      )}
                      {questionDateText(q) && (
                        <span className="inline-flex items-center gap-1 font-normal text-slate-400">
                          <Clock className="h-3 w-3" /> {questionDateText(q)}
                        </span>
                      )}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      isCorrect ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : answered ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                      {isCorrect ? "Correct" : answered ? "Incorrect" : "Not answered"}
                    </span>
                  </div>

                  {q.image && <img src={q.image} alt="" className="mb-3 max-h-56 rounded-xl object-contain" />}
                  <p className="font-semibold leading-relaxed"><MathText>{stemText(q)}</MathText></p>

                  {(Array.isArray(q.columnA) && q.columnA.length > 0) || (Array.isArray(q.columnB) && q.columnB.length > 0) ? (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="mb-2 text-xs font-semibold uppercase text-brand-600 dark:text-brand-400">Column A</p>
                        {(q.columnA || []).map((it, k) => <div key={k} className="flex gap-1.5 text-sm"><b>{k + 1}.</b> <MathText>{it}</MathText></div>)}
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <p className="mb-2 text-xs font-semibold uppercase text-accent-600 dark:text-accent-400">Column B</p>
                        {(q.columnB || []).map((it, k) => <div key={k} className="flex gap-1.5 text-sm"><b>{toRoman(k + 1)}.</b> <MathText>{it}</MathText></div>)}
                      </div>
                    </div>
                  ) : null}

                  <StatementPairView q={q} />
                  <TableView q={q} />
                  <GraphView q={q} />
                  <VizView q={q} />
                  <AssertionReasonView q={q} />

                  <div className="mt-3 space-y-2">
                    {displayOptions(q).map((opt, idx) => {
                      const optExp = q.optionExplanations?.[idx];
                      const cls =
                        idx === q.correct
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                          : idx === userAns
                          ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200"
                          : "border-slate-200 dark:border-slate-700";
                      return (
                        <div key={idx}>
                          <div className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm ${cls}`}>
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg border text-xs font-bold">{optionLabels[idx]}</span>
                            <span className="flex-1"><OptionContent>{opt}</OptionContent></span>
                            {idx === q.correct && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                            {idx === userAns && idx !== q.correct && <XCircle className="h-4 w-4 text-rose-500" />}
                          </div>
                          {/* Why each incorrect option is wrong */}
                          {idx !== q.correct && optExp && optExp.trim() && (
                            <p className={`ml-8 mt-1 text-xs ${idx === userAns ? "text-rose-500 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"}`}>
                              <MathText>{optExp}</MathText>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {q.explanation && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
                      <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                        <Lightbulb className="h-4 w-4" /> Explanation
                      </div>
                      <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-100/90"><MathText>{q.explanation}</MathText></p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- Resume prompt (an unfinished attempt exists) ----
  if (showResume) {
    const answeredCount = Object.keys(saved.answers || {}).length;
    return (
      <div className="container-page py-10">
        <button onClick={() => navigate(isPublic ? "/" : -1)} className="btn-ghost -ml-2 mb-6">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="mx-auto max-w-lg card p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Play className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">Resume {title}?</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            You have an unfinished attempt — {answeredCount} of {questions.length} question(s) answered.
          </p>
          <div className="mt-6 space-y-3">
            <button onClick={() => setShowResume(false)} className="btn-primary w-full justify-center">
              <Play className="h-4 w-4" /> Continue previous session
            </button>
            <button
              onClick={() => {
                localStorage.removeItem(storageKey);
                setAnswers({}); setTimedOut({}); setBookmarks({});
                setSeconds(0); setCurrent(0); setTimerMode(null); setQTime(0);
                setSeed(makeSeed()); // fresh seed → questions & options reshuffle
                setShowResume(false);
              }}
              className="btn-outline w-full justify-center"
            >
              Start a new session
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Continuing keeps your saved answers and the same question &amp; option order.
            Starting new discards the previous answers and reshuffles.
          </p>
        </div>
      </div>
    );
  }

  // ---- Timer setup screen ----
  if (!started) {
    return (
      <div className="container-page py-10">
        <button onClick={() => navigate(isPublic ? "/" : -1)} className="btn-ghost -ml-2 mb-6">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="mx-auto max-w-lg card p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Hourglass className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            {questions.length} questions · Choose your timer to begin
          </p>
          <div className="mt-6 space-y-2.5 text-left">
            {TIMER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setTimerMode(opt.value);
                  if (typeof opt.value === "number") setQTime(opt.value);
                }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-slate-200 px-4 py-3 text-left transition hover:border-brand-500 hover:bg-brand-50 dark:border-slate-700 dark:hover:border-brand-500 dark:hover:bg-slate-800"
              >
                <span className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${opt.value === "off" ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : "bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300"}`}>
                    {opt.value === "off" ? <Play className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
                  </span>
                  <span>
                    <span className="block font-semibold">{opt.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.sub}</span>
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </div>
          <p className="mt-5 text-xs text-slate-400">
            With a timer, each question reveals its answer when time runs out. You can still review and continue.
          </p>
        </div>

        {paperResources}
      </div>
    );
  }

  const q = questions[current];
  if (!q) return <div className="container-page"><Loading label="Loading quiz..." /></div>;

  const locked = answers[current] !== undefined || !!timedOut[current];
  const wasTimedOut = !!timedOut[current] && answers[current] === undefined;
  const isMatching = q.type === "matching";

  const selectOption = (idx) => {
    if (locked) return;
    setAnswers((a) => ({ ...a, [current]: idx }));
  };
  const toggleBookmark = () => setBookmarks((b) => ({ ...b, [current]: !b[current] }));
  const goTo = (i) => { setCurrent(i); setPaletteOpen(false); };
  const next = () => current < questions.length - 1 && setCurrent((c) => c + 1);
  const prev = () => current > 0 && setCurrent((c) => c - 1);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const lowTime = isTimed && !locked && qTime <= 5;

  const optionClass = (idx) => {
    const base = "flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-sm font-medium transition-all duration-200";
    if (!locked) return `${base} border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600 dark:hover:bg-slate-800`;
    if (idx === q.correct) return `${base} border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200`;
    if (idx === answers[current]) return `${base} border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200`;
    return `${base} border-slate-200 bg-white opacity-60 dark:border-slate-700 dark:bg-slate-900`;
  };

  const Palette = () => (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
      {questions.map((_, i) => {
        const isAnswered = answers[i] !== undefined;
        const isCorrect = isAnswered && isQuestionCorrect(questions[i], answers[i]);
        let cls = "relative flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold transition";
        if (i === current) cls += " ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900";
        if (isAnswered) cls += isCorrect ? " bg-emerald-500 text-white" : " bg-rose-500 text-white";
        else if (timedOut[i]) cls += " bg-amber-500 text-white";
        else cls += " bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
        return (
          <button key={i} onClick={() => goTo(i)} className={cls}>
            {i + 1}
            {bookmarks[i] && <Flag className="absolute -right-1 -top-1 h-3 w-3 fill-accent-500 text-accent-500" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} className={fullscreen ? "fixed inset-0 z-[60] overflow-y-auto bg-slate-50 px-4 py-6 dark:bg-slate-950" : "container-page py-6"}>
      <Watermark />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(isPublic ? "/" : -1)} className="btn-ghost -ml-2">
          <ChevronLeft className="h-4 w-4" /> Exit
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isTimed && !locked && (
            <span className={`flex items-center gap-2 rounded-xl px-4 py-2 font-bold tabular-nums text-white ${lowTime ? "animate-pulse bg-rose-500" : "bg-accent-500"}`}>
              <Timer className="h-4 w-4" /> {qTime}s
            </span>
          )}
          <span className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white">
            <Clock className="h-4 w-4" /> {mmss}
          </span>
          <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <button onClick={zoomOut} title="Zoom out" className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomOut className="h-4 w-4" /></button>
            <span className="min-w-[42px] text-center text-xs font-semibold tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} title="Zoom in" className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomIn className="h-4 w-4" /></button>
          </div>
          <button onClick={toggleFullscreen} title={fullscreen ? "Exit full screen" : "Full screen"} className="btn-outline px-3">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button onClick={() => setPaletteOpen(true)} className="btn-outline lg:hidden">
            <Grid3x3 className="h-4 w-4" /> Palette
          </button>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="font-medium">Question {current + 1} of {questions.length}</span>
          <span className="text-slate-500">{Object.keys(answers).length} answered</span>
        </div>
        <ProgressBar value={((current + 1) / questions.length) * 100} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,300px]">
        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={q.difficulty}>{q.difficulty}</Badge>
              {questionDateText(q) && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <Clock className="h-3 w-3" /> {questionDateText(q)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {!isPublic && <FeedbackButton context="question" questionText={q.text} questionNumber={current + 1} source={title} question={{ ...q, chosen: answers[current] ?? null }} label="Feedback" />}
              <button onClick={toggleBookmark} className={`flex items-center gap-1.5 text-sm font-medium transition ${bookmarks[current] ? "text-accent-600 dark:text-accent-400" : "text-slate-400 hover:text-accent-500"}`}>
                {bookmarks[current] ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                {bookmarks[current] ? "Bookmarked" : "Bookmark"}
              </button>
            </div>
          </div>

          {q.image && <img src={q.image} alt="" className="mb-4 max-h-64 rounded-xl object-contain" />}
          <h2 className="text-lg font-semibold leading-relaxed"><MathText>{stemText(q)}</MathText></h2>

          {isMatching && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Column A</p>
                <div className="space-y-2">
                  {(q.columnA || []).map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{i + 1}</span>
                      <MathText>{item}</MathText>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">Column B</p>
                <div className="space-y-2">
                  {(q.columnB || []).map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-accent-100 text-xs font-bold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">{toRoman(i + 1)}</span>
                      <MathText>{item}</MathText>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <StatementPairView q={q} />
          <TableView q={q} />
          <GraphView q={q} />
          <VizView q={q} />
          <AssertionReasonView q={q} />

          <div className="mt-5 space-y-3">
            {isMatching && <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Choose the correct matching sequence:</p>}
            {displayOptions(q).map((opt, idx) => {
              const optExp = q.optionExplanations?.[idx];
              return (
                <div key={idx}>
                  <button onClick={() => selectOption(idx)} disabled={locked} className={optionClass(idx)}>
                    <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                      locked && idx === q.correct ? "border-emerald-500 bg-emerald-500 text-white"
                      : locked && idx === answers[current] ? "border-rose-500 bg-rose-500 text-white"
                      : "border-slate-300 dark:border-slate-600"}`}>
                      {isMatching ? `(${String.fromCharCode(97 + idx)})` : optionLabels[idx]}
                    </span>
                    <span className="flex-1"><OptionContent>{opt}</OptionContent></span>
                    {locked && idx === q.correct && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                    {locked && idx === answers[current] && idx !== q.correct && <XCircle className="h-5 w-5 text-rose-500" />}
                  </button>
                  {/* Reveal WHY each incorrect option is wrong once locked, not
                      just the student's pick. Chosen wrong option is red; other
                      wrong options are neutral. */}
                  {locked && idx !== q.correct && optExp && optExp.trim() && (
                    <p className={`ml-9 mt-1 rounded-lg px-3 py-1.5 text-xs ${
                      idx === answers[current]
                        ? "bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-300"
                        : "bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"
                    }`}>
                      <MathText>{optExp}</MathText>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {wasTimedOut && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300">
              <Timer className="h-4 w-4" /> Time's up! The correct answer is highlighted above.
            </div>
          )}

          {locked && q.explanation && (
            <div className="mt-4 animate-fade-in rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
              <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                <Lightbulb className="h-5 w-5" /> Explanation
              </div>
              <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90"><MathText>{q.explanation}</MathText></p>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button onClick={prev} disabled={current === 0} className="btn-outline">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            {current === questions.length - 1 ? (
              <button onClick={submit} disabled={submitting} className="btn-accent">
                <Flag className="h-4 w-4" /> {submitting ? "Submitting..." : "Submit Quiz"}
              </button>
            ) : (
              <button onClick={next} className="btn-primary">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="card sticky top-20 p-5">
            <h3 className="mb-3 font-bold">Question Palette</h3>
            <Palette />
            <div className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-emerald-500" /> Correct</p>
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-rose-500" /> Incorrect</p>
              {isTimed && <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-amber-500" /> Timed out</p>}
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-300 dark:bg-slate-700" /> Not attempted</p>
              <p className="flex items-center gap-2"><Flag className="h-3 w-3 fill-accent-500 text-accent-500" /> Bookmarked</p>
            </div>
            <button onClick={submit} disabled={submitting} className="btn-accent mt-5 w-full">
              <Flag className="h-4 w-4" /> Submit Quiz
            </button>
          </div>
        </aside>
      </div>

      {paletteOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPaletteOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 animate-fade-in-up rounded-t-3xl bg-white p-6 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">Question Palette</h3>
              <button onClick={() => setPaletteOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <Palette />
            <button onClick={submit} disabled={submitting} className="btn-accent mt-5 w-full">
              <Flag className="h-4 w-4" /> Submit Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
