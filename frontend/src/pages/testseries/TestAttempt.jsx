import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Flag,
  Save,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  Trophy,
  ZoomIn,
  ZoomOut,
  Search,
  LogOut,
  Mail,
} from "lucide-react";
import { testService, cbtService } from "../../services";
import { useAuth } from "../../context/AuthContext";
import { Loading, ErrorState } from "../../components/ui/AsyncState";
import MathText from "../../components/ui/MathText";
import OptionContent from "../../components/ui/OptionContent";
import { getCbtSession, clearCbtSession } from "../../lib/cbtSession";
import StatementPairView from "../../components/ui/StatementPairView";
import TableView from "../../components/ui/TableView";
import GraphView from "../../components/ui/GraphView";
import AssertionReasonView from "../../components/ui/AssertionReasonView";
import Watermark from "../../components/ui/Watermark";
import FeedbackButton from "../../components/ui/FeedbackButton";
import { useZoom } from "../../context/ZoomContext";
import { questionDateText, searchQuestions, stemText, displayOptions } from "../../lib/questions";
import { shuffleAll, shuffleQuestion, shuffleQuestionOrder, toOriginalIndex, toDisplayIndex, makeSeed } from "../../lib/shuffleOptions";
import PaperExport from "../../components/admin/PaperExport";

// Roman numerals for Column B labels (I, II, III, IV…)
function toRoman(n) {
  const m = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of m) while (n >= v) { r += s; n -= v; }
  return r;
}

// Option index → letter (A, B, C…), or — when none.
const optLetter = (n) => (n == null ? "—" : String.fromCharCode(65 + n));

const STATUS = {
  NOT_VISITED: "not_visited",
  NOT_ANSWERED: "not_answered",
  ANSWERED: "answered",
  MARKED: "marked",
  ANSWERED_MARKED: "answered_marked",
};

// Bind the CBT timer to the exam's end: a late joiner gets only the time left
// until the exam closes (never more than the test's own duration). serverNow
// avoids trusting the client's clock.
function cbtRemainingSeconds(endAt, serverNow, durationMin) {
  const dur = (durationMin || 30) * 60;
  if (!endAt) return dur;
  const secsToEnd = Math.floor((new Date(endAt).getTime() - new Date(serverNow || Date.now()).getTime()) / 1000);
  return Math.max(1, Math.min(dur, secsToEnd));
}

// CBT results are DEFERRED: after submitting, the candidate sees only a
// confirmation. Their score & rank are emailed and become viewable once the
// exam is over (its end time / the admin's release).
function CbtSubmitted({ result, test, candidate, navigate }) {
  const endText = result?.endAt
    ? `after the exam ends on ${new Date(result.endAt).toLocaleString()}`
    : "once the exam is over";
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="card w-full max-w-lg p-8 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-extrabold">Response recorded</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">{test?.name}</p>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-left text-sm dark:bg-slate-800/60">
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <span>Your <b>score and rank</b> will be available <b>{endText}</b> — results are released only after the exam is over so ranks are final.</span>
          </p>
          <p className="mt-3 flex items-start gap-2">
            <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" />
            <span>
              {result?.emailConfigured
                ? <>We'll email your full scorecard to <b>{candidate?.email}</b> when results are released.</>
                : <>Save the status link below — you can check your result there once it's released.</>}
            </span>
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {result?.resultToken && (
            <a href={`#/cbt/result/${result.resultToken}`} target="_blank" rel="noreferrer" className="btn-outline">
              Check result status
            </a>
          )}
          <button onClick={() => navigate("/online-exams")} className="btn-primary">Back to exams</button>
        </div>
      </div>
    </div>
  );
}

export default function TestAttempt() {
  const { testId, token, cbtToken, freeId } = useParams();
  const isPublic = !!token; // opened via /public/test/:token — no login needed
  const isCbt = !!cbtToken; // opened via /cbt/exam/:token — sign in with name+email
  const isFree = !!freeId; // FREE first-test-per-subject preview — no login needed
  const anonymous = isPublic || isCbt || isFree; // no logged-in user → hide student-only UI
  const navigate = useNavigate();
  const { user } = useAuth();
  const isClient = user?.role === "client"; // clients return to their own workspace

  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState({});
  const [visited, setVisited] = useState({ 0: true });
  const [remaining, setRemaining] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const { zoom, zoomIn, zoomOut } = useZoom();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [seed] = useState(makeSeed()); // per-attempt option shuffle
  const [candidate, setCandidate] = useState(null); // CBT: { name, email } (sign-in gate)
  const containerRef = useRef(null);

  // CBT: set up questions from the /start response and bind the timer to the
  // exam's end (late joiners get only the time left until it closes).
  const startCbtExam = useCallback((res, cand) => {
    const t = { name: res.name, duration: res.duration, marks: res.marks, negativeMarking: res.negativeMarking, questions: res.questions, endAt: res.endAt };
    setTest(t);
    const qs = shuffleQuestionOrder(t.questions || [], seed);
    setQuestions(shuffleAll(qs, seed));
    setCandidate(cand);
    setRemaining(cbtRemainingSeconds(res.endAt, res.serverNow, res.duration));
  }, [seed]);

  // Load the test + its questions (answers hidden by the API). For CBT the
  // candidate must already be registered on the portal — we read that session
  // and start the exam directly; if there's no session we send them to the
  // portal to register there (registration is NOT done per-test).
  const load = useCallback(() => {
    if (isCbt) {
      const session = getCbtSession();
      if (!session) { navigate("/online-exams", { replace: true }); return; }
      setLoading(true);
      setError("");
      cbtService
        .start(cbtToken, { email: session.email, sessionToken: session.sessionToken })
        .then((res) => startCbtExam(res, session))
        .catch((e) => {
          // Session expired/invalid → clear it and go register on the portal.
          if (e?.status === 401 || e?.data?.needRegister) { clearCbtSession(); navigate("/online-exams", { replace: true }); return; }
          setError(e.message || "Could not start the exam.");
        })
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    setError("");
    (isPublic ? testService.getPublic(token) : isFree ? testService.getFree(freeId) : testService.get(testId))
      .then((t) => {
        // A shared QUIZ (practiceKind "quiz") should open in the quiz-style
        // player, not this exam UI. Redirect old /public/test links accordingly.
        if (isPublic && t?.practiceKind === "quiz") {
          navigate(`/public/quiz/${token}`, { replace: true });
          return;
        }
        setTest(t);
        // Keep each subject's questions together, but reshuffle the SUBJECT
        // order and the questions WITHIN each subject for this attempt (so GK
        // isn't always first), then reshuffle each question's OPTIONS too.
        const qs = shuffleQuestionOrder(t.questions || [], seed);
        setQuestions(shuffleAll(qs, seed));
        setRemaining((t.duration || 30) * 60);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [testId, token, cbtToken, freeId, isPublic, isCbt, isFree, seed, navigate, startCbtExam]);

  useEffect(load, [load]);

  // Count a public OPEN once per browser (impression tracking for shared links).
  useEffect(() => {
    if (!isPublic || !token) return;
    const key = `mpm-viewed-${token}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    testService.registerPublicView(token).catch(() => {});
  }, [isPublic, token]);

  // Count a CBT exam OPEN once per browser (impression tracking for the exam).
  useEffect(() => {
    if (!isCbt || !cbtToken) return;
    const key = `mpm-cbt-viewed-${cbtToken}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    cbtService.registerView(cbtToken).catch(() => {});
  }, [isCbt, cbtToken]);

  const finalize = useCallback(async () => {
    if (submitting || result) return;
    setSubmitting(true);
    setConfirmOpen(false);
    const byId = {};
    questions.forEach((q, i) => {
      if (answers[i] !== undefined) byId[q._id] = toOriginalIndex(q, answers[i]);
    });
    const elapsed = (test?.duration || 0) * 60 - remaining;
    try {
      const res = isCbt
        ? await cbtService.submit(cbtToken, { name: candidate?.name, email: candidate?.email, sessionToken: candidate?.sessionToken, answers: byId, timeTaken: elapsed })
        : isPublic
        ? await testService.submitPublic(token, byId, elapsed)
        : isFree
        ? await testService.submitFree(freeId, byId, elapsed)
        : await testService.submit(testId, byId, elapsed);
      setResult(res);
    } catch (e) {
      setError(e.message || "Could not submit the test.");
    } finally {
      setSubmitting(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [answers, questions, test, remaining, testId, token, cbtToken, freeId, isPublic, isCbt, isFree, candidate, submitting, result]);

  // Countdown with auto-submit at 0.
  useEffect(() => {
    if (loading || result || !test || (isCbt && !candidate)) return; // CBT: wait for sign-in
    if (remaining <= 0) {
      finalize();
      return;
    }
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining, loading, result, test, finalize, isCbt, candidate]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Leave the test. After submitting, just go back; mid-test, confirm first
  // (answers are not saved) and drop out of fullscreen.
  const exitTest = () => {
    const dest = anonymous ? "/" : isClient ? "/client" : "/test-series";
    if (!result && !window.confirm("Exit the test? Your answers won't be submitted or saved.")) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(dest);
  };

  const toggleFullscreen = () => {
    if (!fullscreen) {
      setFullscreen(true);
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      setFullscreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  };

  const goTo = (i) => {
    setCurrent(i);
    setVisited((v) => ({ ...v, [i]: true }));
  };
  const select = (idx) => setAnswers((a) => ({ ...a, [current]: idx }));
  const saveNext = () => current < questions.length - 1 && goTo(current + 1);
  const markReviewNext = () => {
    setMarked((m) => ({ ...m, [current]: true }));
    if (current < questions.length - 1) goTo(current + 1);
  };
  const clearResponse = () =>
    setAnswers((a) => {
      const copy = { ...a };
      delete copy[current];
      return copy;
    });

  const statusOf = (i) => {
    const ans = answers[i] !== undefined;
    const mk = marked[i];
    if (ans && mk) return STATUS.ANSWERED_MARKED;
    if (mk) return STATUS.MARKED;
    if (ans) return STATUS.ANSWERED;
    if (visited[i]) return STATUS.NOT_ANSWERED;
    return STATUS.NOT_VISITED;
  };

  const paletteColor = (s) =>
    ({
      [STATUS.ANSWERED]: "bg-emerald-500 text-white",
      [STATUS.NOT_ANSWERED]: "bg-rose-500 text-white",
      [STATUS.MARKED]: "bg-violet-500 text-white",
      [STATUS.ANSWERED_MARKED]: "bg-violet-500 text-white ring-2 ring-emerald-400",
      [STATUS.NOT_VISITED]: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    }[s]);

  const counts = useMemo(() => {
    const c = { answered: 0, notAnswered: 0, marked: 0, notVisited: 0 };
    questions.forEach((_, i) => {
      const s = statusOf(i);
      if (s === STATUS.ANSWERED || s === STATUS.ANSWERED_MARKED) c.answered++;
      else if (s === STATUS.MARKED) c.marked++;
      else if (s === STATUS.NOT_ANSWERED) c.notAnswered++;
      else c.notVisited++;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, marked, visited, questions]);

  // Contiguous subject groups (for the palette + section titles).
  const groups = useMemo(() => {
    const out = [];
    questions.forEach((q, i) => {
      const sec = q.section || "";
      let g = out[out.length - 1];
      if (!g || g.section !== sec) { g = { section: sec, items: [] }; out.push(g); }
      g.items.push(i);
    });
    return out;
  }, [questions]);
  const hasSections = groups.some((g) => g.section);

  if (loading) return <div className="container-page"><Loading label="Loading test..." /></div>;
  if (error && !result) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  // CBT: while the exam is being started from the stored portal session, the
  // loading state covers it; if it fails we show the error (with retry). There's
  // no per-test sign-in — registration happens on the portal.

  const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const lowTime = remaining < 300;
  // Full context for feedback: "Exam › Post › Test (Test)"
  const testSource = test
    ? [test.exam?.name, test.post?.name, test.name].filter(Boolean).join(" › ") + " (Test)"
    : "Test";

  // ---- CBT: deferred-result confirmation (no score/rank shown now) ----
  if (result && isCbt) {
    return <CbtSubmitted result={result} test={test} candidate={candidate} navigate={navigate} />;
  }

  // ---- Result screen (uses backend-graded data) ----
  if (result) {
    const review = result.review || [];
    const stats = [
      { l: "Score", v: `${result.score}/${result.maxScore ?? test.marks}`, c: "text-brand-600 dark:text-brand-400" },
      { l: "Percentage", v: `${result.percentage}%`, c: "text-brand-600 dark:text-brand-400" },
      { l: "Total", v: result.total, c: "text-slate-700 dark:text-slate-200" },
      { l: "Attempted", v: result.attempted, c: "text-slate-700 dark:text-slate-200" },
      { l: "Correct", v: result.correct, c: "text-emerald-600 dark:text-emerald-400" },
      { l: "Wrong", v: result.incorrect, c: "text-rose-600 dark:text-rose-400" },
      { l: "Skipped", v: result.skipped, c: "text-amber-600 dark:text-amber-400" },
    ];
    // Searchable review list — keep the original index for numbering. Re-apply
    // the SAME per-attempt shuffle so the review shows options in the exact
    // order the user saw during the test (correct & chosen remapped to match).
    const reviewEntries = shuffleQuestionOrder(review, seed).map((r, i) => {
      const s = shuffleQuestion(r, seed);
      return { ...s, chosen: toDisplayIndex(s, r.chosen), _idx: i };
    });
    const reviewResults = searchQuestions(reviewEntries, reviewSearch);
    const reviewShown = reviewResults || reviewEntries;
    return (
      <div className="min-h-screen bg-slate-50 py-10 dark:bg-slate-950">
        <Watermark />
        <div className="container-page">
          <div className="card p-8 text-center">
            <Trophy className="mx-auto h-14 w-14 text-accent-500" />
            <h1 className="mt-4 text-2xl font-extrabold">Test Submitted</h1>
            <p className="mt-1 text-slate-500 dark:text-slate-400">{test.name}</p>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {stats.map((s) => (
                <div key={s.l} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-xs text-slate-500">{s.l}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {review.length > 0 && (
                <button onClick={() => setShowReview((v) => !v)} className="btn-accent">
                  {showReview ? "Hide" : "Review"} Answers
                </button>
              )}
              {review.length > 0 && <PaperExport title={test.name || "Test"} questions={review} />}
              {!anonymous && <FeedbackButton context="test" source={testSource} label="Give Feedback" className="btn-outline" />}
              {isPublic ? (
                <button onClick={() => navigate("/")} className="btn-primary">Done</button>
              ) : isFree && !user ? (
                // Free preview finished by a guest — nudge them to unlock the rest.
                <>
                  <button onClick={() => navigate(-1)} className="btn-outline">Back to Tests</button>
                  <button onClick={() => navigate("/register")} className="btn-primary">Sign up to unlock all tests</button>
                </>
              ) : isClient ? (
                <button onClick={() => navigate("/client")} className="btn-primary">Back to My Practice</button>
              ) : (
                <>
                  <button onClick={() => navigate("/dashboard")} className="btn-primary">Go to Dashboard</button>
                  <button onClick={() => navigate("/test-series")} className="btn-outline">More Tests</button>
                </>
              )}
            </div>
          </div>

          {/* Answer review */}
          {showReview && (
            <div className="mt-6 space-y-4">
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
              {reviewResults && (
                <p className="text-sm font-medium text-slate-500">{reviewResults.length} match{reviewResults.length === 1 ? "" : "es"} (40%+)</p>
              )}
              {reviewResults && reviewResults.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
                  No questions match “{reviewSearch}” at 40% or higher. Try fewer or different words.
                </p>
              )}
              {reviewShown.map((r) => {
                const i = r._idx;
                return (
                <div key={r._id || i} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">
                      <span className="mr-2 text-slate-400">Q{i + 1}.</span>
                      <MathText>{stemText(r)}</MathText>
                    </p>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className={`text-xs font-semibold ${
                        r.chosen === null ? "text-amber-600" : r.isCorrect ? "text-emerald-600" : "text-rose-600"
                      }`}>
                        {r.chosen === null ? "Skipped" : r.isCorrect ? "Correct" : "Wrong"}
                      </span>
                      {!anonymous && (
                        <FeedbackButton
                          context="question"
                          label="Feedback"
                          questionNumber={i + 1}
                          questionText={r.text}
                          source={testSource}
                          details={`Correct: ${optLetter(r.correct)}${r.chosen != null ? `, Chosen: ${optLetter(r.chosen)}` : ", Skipped"}`}
                          question={r}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400"
                        />
                      )}
                    </div>
                  </div>
                  {(r._match != null || questionDateText(r)) && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {r._match != null && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{r._match}% match</span>
                      )}
                      {questionDateText(r) && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> {questionDateText(r)}</span>
                      )}
                    </div>
                  )}
                  {r.image && <img src={r.image} alt="" className="mt-3 max-h-52 rounded-lg object-contain" />}

                  {r.type === "matching" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                        <p className="mb-1 text-xs font-semibold uppercase text-brand-600 dark:text-brand-400">Column A</p>
                        {(r.columnA || []).map((item, k) => (
                          <div key={k} className="flex items-start gap-1.5 text-sm"><span className="font-bold text-brand-700 dark:text-brand-300">{k + 1}.</span> <MathText>{item}</MathText></div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                        <p className="mb-1 text-xs font-semibold uppercase text-accent-600 dark:text-accent-400">Column B</p>
                        {(r.columnB || []).map((item, k) => (
                          <div key={k} className="flex items-start gap-1.5 text-sm"><span className="font-bold text-accent-700 dark:text-accent-300">{toRoman(k + 1)}.</span> <MathText>{item}</MathText></div>
                        ))}
                      </div>
                    </div>
                  )}

                  <StatementPairView q={r} />
                  <TableView q={r} />
                  <GraphView q={r} />
                  <AssertionReasonView q={r} />

                  <div className="mt-3 space-y-2">
                    {displayOptions(r).map((opt, idx) => {
                      const isCorrect = idx === r.correct;
                      const isChosen = idx === r.chosen;
                      const optExp = r.optionExplanations?.[idx];
                      let cls = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm ";
                      if (isCorrect) cls += "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
                      else if (isChosen) cls += "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
                      else cls += "text-slate-500 dark:text-slate-400";
                      return (
                        <div key={idx}>
                          <div className={cls}>
                            {isCorrect ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : isChosen ? <XCircle className="h-4 w-4 flex-shrink-0" /> : <span className="h-4 w-4" />}
                            {r.type === "matching" && <span className="font-bold">({String.fromCharCode(97 + idx)})</span>}
                            <OptionContent>{opt}</OptionContent>
                          </div>
                          {isChosen && !isCorrect && optExp && optExp.trim() && (
                            <p className="ml-6 mt-0.5 text-xs text-rose-500 dark:text-rose-400"><MathText>{optExp}</MathText></p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {r.explanation && (
                    <div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm dark:bg-brand-900/20">
                      <span className="font-semibold text-brand-700 dark:text-brand-300">Explanation: </span>
                      <MathText>{r.explanation}</MathText>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const q = questions[current];
  if (!q) {
    return (
      <div className="container-page">
        <ErrorState message="This test has no questions yet." onRetry={() => navigate("/test-series")} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`bg-slate-100 dark:bg-slate-950 ${fullscreen ? "fixed inset-0 z-[60] overflow-y-auto" : "min-h-screen"}`}>
      <Watermark />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 flex-1 truncate text-sm font-bold sm:text-base">{test.name}</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-sm font-bold sm:px-4 sm:text-base ${
                lowTime ? "animate-pulse bg-rose-500 text-white" : "bg-brand-600 text-white"
              }`}
            >
              <Clock className="h-4 w-4" /> {hh}:{mm}:{ss}
            </span>
            <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <button onClick={zoomOut} title="Zoom out" className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomOut className="h-4 w-4" /></button>
              <span className="min-w-[42px] text-center text-xs font-semibold tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
              <button onClick={zoomIn} title="Zoom in" className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><ZoomIn className="h-4 w-4" /></button>
            </div>
            <button onClick={toggleFullscreen} className="btn-outline px-3">
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            <button onClick={exitTest} className="btn-outline px-3" title="Exit the test (answers won't be saved)">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Exit</span>
            </button>
            <button onClick={() => setConfirmOpen(true)} className="btn-accent">Submit</button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr,320px]">
        <div className="card flex flex-col p-6">
          {hasSections && q.section && (
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{q.section}</span>
              <span className="text-xs text-slate-400">Section</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <span className="flex flex-wrap items-center gap-2 font-bold">
              Question {current + 1} of {questions.length}
              {questionDateText(q) && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-400"><Clock className="h-3 w-3" /> {questionDateText(q)}</span>
              )}
            </span>
            <div className="flex items-center gap-4">
              {!anonymous && <FeedbackButton context="question" questionText={q.text} questionNumber={current + 1} source={testSource} question={{ ...q, chosen: answers[current] ?? null }} label="Feedback" />}
              <span className="text-sm text-slate-500">
                +{(test.marks / questions.length).toFixed(1)} / -{test.negativeMarking ?? 0.25}
              </span>
            </div>
          </div>

          {q.image && <img src={q.image} alt="" className="mt-4 max-h-64 rounded-xl object-contain" />}
          <h2 className="mt-5 text-lg font-semibold leading-relaxed"><MathText>{stemText(q)}</MathText></h2>

          {/* Matching questions show the two columns before the answer options. */}
          {q.type === "matching" && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-1 text-xs font-semibold uppercase text-brand-600 dark:text-brand-400">Column A</p>
                {(q.columnA || []).map((item, k) => (
                  <div key={k} className="flex items-start gap-1.5 py-0.5 text-sm"><span className="font-bold text-brand-700 dark:text-brand-300">{k + 1}.</span> <MathText>{item}</MathText></div>
                ))}
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-1 text-xs font-semibold uppercase text-accent-600 dark:text-accent-400">Column B</p>
                {(q.columnB || []).map((item, k) => (
                  <div key={k} className="flex items-start gap-1.5 py-0.5 text-sm"><span className="font-bold text-accent-700 dark:text-accent-300">{toRoman(k + 1)}.</span> <MathText>{item}</MathText></div>
                ))}
              </div>
            </div>
          )}

          {/* Statement/pair lists, table grids, and assertion–reason statements */}
          <StatementPairView q={q} />
          <TableView q={q} />
          <GraphView q={q} />
          <AssertionReasonView q={q} />

          <div className="mt-5 space-y-3">
            {q.type === "matching" && <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Choose the correct matching sequence:</p>}
            {displayOptions(q).map((opt, idx) => (
              <label
                key={idx}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-sm font-medium transition ${
                  answers[current] === idx
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30"
                    : "border-slate-200 hover:border-brand-300 dark:border-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name={`q-${current}`}
                  checked={answers[current] === idx}
                  onChange={() => select(idx)}
                  className="h-4 w-4 text-brand-600"
                />
                {q.type === "matching" && <span className="font-bold">({String.fromCharCode(97 + idx)})</span>}
                <OptionContent>{opt}</OptionContent>
              </label>
            ))}
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="flex gap-2">
              <button onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0} className="btn-outline">
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button onClick={clearResponse} className="btn-ghost">Clear</button>
            </div>
            <div className="flex gap-2">
              <button onClick={markReviewNext} className="btn-outline">
                <Flag className="h-4 w-4" /> Mark & Next
              </button>
              <button onClick={saveNext} className="btn-primary">
                <Save className="h-4 w-4" /> Save & Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <aside className="card flex flex-col p-5">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Answered ({counts.answered})</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-rose-500" /> Not Answered ({counts.notAnswered})</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-violet-500" /> Marked ({counts.marked})</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-300 dark:bg-slate-700" /> Not Visited ({counts.notVisited})</span>
          </div>

          <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {groups.map((g, gi) => (
              <div key={gi}>
                {hasSections && (
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                    {g.section || "General"} <span className="text-slate-400">({g.items.length})</span>
                  </p>
                )}
                <div className="grid grid-cols-6 gap-2">
                  {g.items.map((i) => (
                    <button
                      key={i}
                      onClick={() => goTo(i)}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold transition ${paletteColor(
                        statusOf(i)
                      )} ${i === current ? "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900" : ""}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setConfirmOpen(true)} className="btn-accent mt-5 w-full">
            <Flag className="h-4 w-4" /> Submit Test
          </button>
        </aside>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md animate-scale-in p-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <AlertTriangle className="h-5 w-5 text-amber-500" /> Submit Test?
              </h3>
              <button onClick={() => setConfirmOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/20">
                <p className="font-bold text-emerald-600">{counts.answered}</p> Answered
              </div>
              <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20">
                <p className="font-bold text-rose-600">{counts.notAnswered + counts.notVisited}</p> Unanswered
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              You won't be able to change answers after submitting.
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmOpen(false)} className="btn-outline flex-1">Resume</button>
              <button onClick={finalize} disabled={submitting} className="btn-accent flex-1">
                <CheckCircle2 className="h-4 w-4" /> {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
