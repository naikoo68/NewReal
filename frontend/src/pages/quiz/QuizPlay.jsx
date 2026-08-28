import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
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
} from "lucide-react";
import { contentService, quizService } from "../../services";
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
import { questionDateText, stemText, displayOptions } from "../../lib/questions";
import { shuffleAll, toOriginalIndex, makeSeed } from "../../lib/shuffleOptions";

const optionLabels = ["A", "B", "C", "D"];

// Works for both question types.
// Both question types are answered by picking one option index.
function isQuestionCorrect(q, ans) {
  return ans !== undefined && ans !== null && ans === q.correct;
}

function toRoman(num) {
  const map = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of map) while (num >= v) { r += s; num -= v; }
  return r;
}

const TIMER_OPTIONS = [
  { label: "No timer", sub: "Practice at your own pace", value: "off" },
  { label: "10 seconds", sub: "per question", value: 10 },
  { label: "30 seconds", sub: "per question", value: 30 },
  { label: "45 seconds", sub: "per question", value: 45 },
  { label: "1 minute", sub: "per question", value: 60 },
];

export default function QuizPlay() {
  const { subjectId, topicId, sessionId, quizId } = useParams();
  const navigate = useNavigate();
  const storageKey = `mpm-quiz-${quizId}`;

  // Read any saved progress once (so refresh resumes, including timer choice).
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
      return {};
    }
  })();

  const [questions, setQuestions] = useState([]);
  const [subjectName, setSubjectName] = useState("Quiz");
  const [crumb, setCrumb] = useState(""); // "Subject › Topic › Session › Quiz"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState(saved.current || 0);
  const [answers, setAnswers] = useState(saved.answers || {});
  const [timedOut, setTimedOut] = useState(saved.timedOut || {});
  const [bookmarks, setBookmarks] = useState(saved.bookmarks || {});
  const [seconds, setSeconds] = useState(saved.seconds || 0); // total elapsed
  const [timerMode, setTimerMode] = useState(saved.timerMode ?? null); // null=not chosen, "off", or seconds
  const [qTime, setQTime] = useState(saved.qTime ?? 0); // remaining for current question
  // Seed for per-attempt option shuffling — persisted so a refresh resumes the
  // SAME order; a new attempt (storage cleared on submit) gets a new order.
  const [seed, setSeed] = useState(() => (typeof saved.seed === "number" ? saved.seed : makeSeed()));
  // If a previous, UNFINISHED attempt is saved, ask whether to resume it or
  // start fresh — instead of silently resuming. "Continue" keeps the saved
  // answers AND the same question/option order (same seed); "Start new" clears
  // it and reshuffles.
  const hasSavedSession =
    saved.timerMode != null &&
    (Object.keys(saved.answers || {}).length > 0 || (saved.current || 0) > 0 || (saved.seconds || 0) > 0);
  const [showResume, setShowResume] = useState(hasSavedSession);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);

  // Site-wide zoom (also usable here, incl. full-screen).
  const { zoom, zoomIn, zoomOut } = useZoom();

  // Full-screen mode. Uses a CSS full-viewport overlay (works on iOS Safari,
  // which doesn't support the Fullscreen API for pages) and ALSO requests the
  // native Fullscreen API where available (Android/desktop).
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

  // Fetch questions + subject name
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([
      contentService.quizQuestions(quizId),
      contentService.subjects().catch(() => []),
      contentService.topics(subjectId).catch(() => []),
      contentService.sessions(topicId).catch(() => []),
      contentService.quizzes(sessionId).catch(() => []),
    ])
      .then(([qs, subjects, topics, sessions, quizzes]) => {
        setQuestions(shuffleAll(qs, seed)); // reshuffle options for this attempt
        const subj = subjects.find?.((s) => s._id === subjectId);
        const top = topics.find?.((t) => t._id === topicId);
        const ses = sessions.find?.((s) => s._id === sessionId);
        const qz = quizzes.find?.((q) => q._id === quizId);
        if (subj) setSubjectName(subj.name);
        setCrumb([subj?.name, top?.title, ses?.title, qz?.title].filter(Boolean).join(" › "));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [quizId, subjectId, seed]);

  useEffect(load, [load]);

  // Total elapsed timer (runs once the quiz has started)
  useEffect(() => {
    if (!started || showResume) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [started]);

  // Saved progress (from localStorage) may point past a shorter, recreated
  // question list. Clamp it so we never index an undefined question.
  useEffect(() => {
    if (questions.length && current > questions.length - 1) setCurrent(0);
  }, [questions, current]);

  const lockedAt = (i) => answers[i] !== undefined || !!timedOut[i];

  // Reset the per-question countdown whenever the question (or mode) changes.
  useEffect(() => {
    if (!isTimed) return;
    setQTime(lockedAt(current) ? 0 : timerMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, timerMode]);

  // Per-question countdown → when it hits 0, lock the question (reveal answer).
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

  // Auto-save
  useEffect(() => {
    if (!loading && started) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ answers, timedOut, bookmarks, seconds, current, timerMode, qTime, seed })
      );
    }
  }, [answers, timedOut, bookmarks, seconds, current, timerMode, qTime, seed, storageKey, loading, started]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    let correct = 0;
    questions.forEach((qq, i) => {
      if (isQuestionCorrect(qq, answers[i])) correct += 1;
    });
    const attempted = Object.keys(answers).length;
    const result = {
      subjectId,
      sessionId,
      subjectName,
      source: crumb,
      total: questions.length,
      attempted,
      correct,
      incorrect: attempted - correct,
      score: correct * 4 - (attempted - correct),
      maxScore: questions.length * 4,
      percentage: Math.round((correct / questions.length) * 100),
      timeTaken: seconds,
      weakTopics: [
        ...new Set(
          questions
            .filter((qq, i) => answers[i] !== undefined && !isQuestionCorrect(qq, answers[i]))
            .map((qq) => qq.topic)
        ),
      ],
      review: questions.map((qq, i) => ({
        _id: qq._id,
        type: qq.type || "mcq",
        text: qq.text,
        image: qq.image,
        options: qq.options,
        optionExplanations: qq.optionExplanations,
        correct: qq.correct,
        columnA: qq.columnA,
        columnB: qq.columnB,
        tableRows: qq.tableRows,
        graph: qq.graph,
        viz: qq.viz,
        assertion: qq.assertion,
        reason: qq.reason,
        chosen: answers[i] ?? null,
        topic: qq.topic,
        explanation: qq.explanation,
      })),
    };

    const byId = {};
    questions.forEach((qq, i) => {
      // Map the chosen DISPLAY index back to the original stored index so the
      // server (which scores against Question.correct) grades correctly.
      if (answers[i] !== undefined) byId[qq._id] = toOriginalIndex(qq, answers[i]);
    });
    try {
      await quizService.submit(quizId, byId, seconds);
    } catch {
      /* practice still works even if recording fails */
    }

    localStorage.removeItem(storageKey);
    navigate(`/quiz/${subjectId}/${topicId}/${sessionId}/${quizId}/result`, { state: result });
  }, [answers, questions, seconds, subjectId, topicId, sessionId, quizId, subjectName, navigate, storageKey]);

  // Resume an unfinished attempt as-is, or wipe it and begin a fresh one.
  const continueSession = () => setShowResume(false);
  const startNewSession = () => {
    localStorage.removeItem(storageKey);
    setAnswers({});
    setTimedOut({});
    setBookmarks({});
    setSeconds(0);
    setCurrent(0);
    setTimerMode(null);
    setQTime(0);
    setSeed(makeSeed()); // fresh seed → questions & options reshuffle
    setShowResume(false);
  };

  if (loading) return <div className="container-page"><Loading label="Loading quiz..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;
  if (!questions.length)
    return <div className="container-page"><EmptyState message="No questions in this session yet." /></div>;

  // ---- Resume prompt (an unfinished attempt exists) ----
  if (showResume) {
    const answeredCount = Object.keys(saved.answers || {}).length;
    return (
      <div className="container-page py-10">
        <button onClick={() => navigate(`/quiz/${subjectId}/${topicId}`)} className="btn-ghost -ml-2 mb-6">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="mx-auto max-w-lg card p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Play className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">Resume {subjectName} Quiz?</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            You have an unfinished attempt — {answeredCount} of {questions.length} question(s) answered.
          </p>
          <div className="mt-6 space-y-3">
            <button onClick={continueSession} className="btn-primary w-full justify-center">
              <Play className="h-4 w-4" /> Continue previous session
            </button>
            <button onClick={startNewSession} className="btn-outline w-full justify-center">
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

  // ---- Timer setup screen (shown before the quiz starts) ----
  if (!started) {
    return (
      <div className="container-page py-10">
        <button onClick={() => navigate(`/quiz/${subjectId}/${topicId}`)} className="btn-ghost -ml-2 mb-6">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="mx-auto max-w-lg card p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Hourglass className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">{subjectName} Quiz</h1>
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
      </div>
    );
  }

  const q = questions[current];
  // Defensive: covers the single render before the clamp effect above runs.
  if (!q) return <div className="container-page"><Loading label="Loading quiz..." /></div>;

  const locked = answers[current] !== undefined || !!timedOut[current];
  const wasTimedOut = !!timedOut[current] && answers[current] === undefined;

  const isMatching = q.type === "matching";

  const selectOption = (idx) => {
    if (locked) return;
    setAnswers((a) => ({ ...a, [current]: idx }));
  };
  const toggleBookmark = () => setBookmarks((b) => ({ ...b, [current]: !b[current] }));
  const goTo = (i) => {
    setCurrent(i);
    setPaletteOpen(false);
  };
  const next = () => current < questions.length - 1 && setCurrent((c) => c + 1);
  const prev = () => current > 0 && setCurrent((c) => c - 1);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const lowTime = isTimed && !locked && qTime <= 5;

  const optionClass = (idx) => {
    const base =
      "flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-sm font-medium transition-all duration-200";
    if (!locked) {
      return `${base} border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600 dark:hover:bg-slate-800`;
    }
    if (idx === q.correct) {
      return `${base} border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200`;
    }
    if (idx === answers[current]) {
      return `${base} border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200`;
    }
    return `${base} border-slate-200 bg-white opacity-60 dark:border-slate-700 dark:bg-slate-900`;
  };

  const Palette = () => (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
      {questions.map((_, i) => {
        const isAnswered = answers[i] !== undefined;
        const isCorrect = isAnswered && isQuestionCorrect(questions[i], answers[i]);
        const isBookmarked = bookmarks[i];
        let cls = "relative flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold transition";
        if (i === current) cls += " ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900";
        if (isAnswered) cls += isCorrect ? " bg-emerald-500 text-white" : " bg-rose-500 text-white";
        else if (timedOut[i]) cls += " bg-amber-500 text-white";
        else cls += " bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
        return (
          <button key={i} onClick={() => goTo(i)} className={cls}>
            {i + 1}
            {isBookmarked && <Flag className="absolute -right-1 -top-1 h-3 w-3 fill-accent-500 text-accent-500" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} className={fullscreen ? "fixed inset-0 z-[60] overflow-y-auto bg-slate-50 px-4 py-6 dark:bg-slate-950" : "container-page py-6"}>
      <Watermark />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(`/quiz/${subjectId}/${topicId}`)} className="btn-ghost -ml-2">
          <ChevronLeft className="h-4 w-4" /> Exit
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isTimed && !locked && (
            <span
              className={`flex items-center gap-2 rounded-xl px-4 py-2 font-bold tabular-nums text-white ${
                lowTime ? "animate-pulse bg-rose-500" : "bg-accent-500"
              }`}
            >
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
              <FeedbackButton context="question" questionText={q.text} questionNumber={current + 1} source={crumb || subjectName || "Quiz"} question={{ ...q, chosen: answers[current] ?? null }} label="Feedback" />
              <button
                onClick={toggleBookmark}
                className={`flex items-center gap-1.5 text-sm font-medium transition ${
                  bookmarks[current] ? "text-accent-600 dark:text-accent-400" : "text-slate-400 hover:text-accent-500"
                }`}
              >
                {bookmarks[current] ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
                {bookmarks[current] ? "Bookmarked" : "Bookmark"}
              </button>
            </div>
          </div>

          {q.image && <img src={q.image} alt="" className="mb-4 max-h-64 rounded-xl object-contain" />}
          <h2 className="text-lg font-semibold leading-relaxed">
            <MathText>{stemText(q)}</MathText>
          </h2>

          {/* Matching questions show the two columns above the answer options */}
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

          {/* Statement/pair lists, table grids, and assertion–reason statements */}
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
                    <span
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                        locked && idx === q.correct
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : locked && idx === answers[current]
                          ? "border-rose-500 bg-rose-500 text-white"
                          : "border-slate-300 dark:border-slate-600"
                      }`}
                    >
                      {isMatching ? `(${String.fromCharCode(97 + idx)})` : optionLabels[idx]}
                    </span>
                    <span className="flex-1"><OptionContent>{opt}</OptionContent></span>
                    {locked && idx === q.correct && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                    {locked && idx === answers[current] && idx !== q.correct && <XCircle className="h-5 w-5 text-rose-500" />}
                  </button>
                  {/* Once locked, show WHY each incorrect option is wrong — not
                      just the one the student picked. The chosen wrong option is
                      highlighted in red; the other wrong options use a neutral
                      tone. The correct answer's full explanation is in the box
                      below. */}
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

          {locked && (
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
