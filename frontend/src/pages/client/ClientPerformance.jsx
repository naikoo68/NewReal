import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Trophy,
  Target,
  TrendingDown,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  ListChecks,
  FileStack,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { analyticsService } from "../../services";
import { Loading, ErrorState } from "../../components/ui/AsyncState";
import QuestionView from "../../components/admin/QuestionView";

// Option index → letter (A, B, …); null/negative = not answered.
const optLetter = (i) => (i == null || i < 0 ? "—" : String.fromCharCode(65 + i));

const fmtDate = (d) =>
  new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// seconds -> "1m 05s" / "45s"
const fmtTime = (s) => {
  const secs = Math.max(0, Math.round(s || 0));
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};

// Colour a percentage: red (weak) → amber → emerald (strong).
const pctTone = (p) =>
  p >= 70 ? "text-emerald-600 dark:text-emerald-400" : p >= 40 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
const barTone = (p) => (p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-rose-500");

function StatCard({ Icon, label, value, sub, tone = "text-brand-600", onClick }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Icon className={`h-4 w-4 ${tone}`} /> {label}
        </span>
        {onClick && <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
      >
        {body}
      </button>
    );
  }
  return <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">{body}</div>;
}

// A single weak-area row (subject or topic) with an accuracy bar.
function AreaRow({ area, showSubject = false }) {
  const attempted = area.attempted || 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {area.name}
          {showSubject && area.subject ? <span className="font-normal text-slate-400"> · {area.subject}</span> : null}
        </p>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full ${barTone(area.accuracy)}`} style={{ width: `${area.accuracy}%` }} />
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className={`text-sm font-bold ${pctTone(area.accuracy)}`}>{area.accuracy}%</p>
        <p className="text-[11px] text-slate-400">
          {area.wrong} wrong / {attempted}
        </p>
      </div>
    </div>
  );
}

// The client's personal, real-time performance view: every attempted quiz &
// test with its full attempt history, plus weak areas from wrong answers.
// Refetches on mount, on a manual refresh, and whenever the tab regains focus
// so a freshly-finished attempt shows up without a full reload.
export default function ClientPerformance({ full = false }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState(null); // which item's attempt history is expanded
  const [openAttempt, setOpenAttempt] = useState(null); // which attempt's question review is open
  const [reviews, setReviews] = useState({}); // attemptId -> { loading } | { error } | { data }

  // Expand an attempt and lazily load its full question-by-question review.
  const toggleAttempt = async (id) => {
    if (openAttempt === id) { setOpenAttempt(null); return; }
    setOpenAttempt(id);
    if (!reviews[id]) {
      setReviews((r) => ({ ...r, [id]: { loading: true } }));
      try {
        const data = await analyticsService.attemptReview(id);
        setReviews((r) => ({ ...r, [id]: { data } }));
      } catch (e) {
        setReviews((r) => ({ ...r, [id]: { error: e.message || "Couldn't load this attempt's questions." } }));
      }
    }
  };

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const r = await analyticsService.myPerformance();
      setData(r);
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load your performance.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const onFocus = () => fetchData(true); // near real-time: refresh when returning to the tab
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  if (loading) return <div className="mt-6"><Loading label="Loading your performance…" /></div>;
  if (error) return <div className="mt-6"><ErrorState message={error} onRetry={() => fetchData()} /></div>;

  const s = data?.summary || {};
  const items = data?.items || [];
  const weakSubjects = data?.weakSubjects || [];
  const weakTopics = data?.weakTopics || [];

  if (!s.totalAttempts) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-2 text-sm font-medium">No attempts yet</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Practise a quiz or take a test and your scores, history and weak areas will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-6">
      {/* Refresh */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your results update automatically as you practise.
        </p>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard Icon={ListChecks} label="Attempts" value={s.totalAttempts} sub={full ? `${s.itemsAttempted} quiz/test` : `${s.itemsAttempted} quiz/test · tap for details`} onClick={full ? undefined : () => navigate("/client/performance")} />
        <StatCard Icon={Target} label="Accuracy" value={`${s.overallAccuracy}%`} sub={`${s.totalCorrect}/${s.totalAnswered} correct`} tone="text-emerald-600" />
        <StatCard Icon={BarChart3} label="Avg score" value={`${s.avgPct}%`} sub="across attempts" tone="text-violet-600" />
        <StatCard Icon={Trophy} label="Best" value={`${s.best}%`} sub={`${s.quizzesTaken} quizzes · ${s.testsTaken} tests`} tone="text-amber-500" />
      </div>

      {/* Weak areas */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <TrendingDown className="h-4 w-4 text-rose-500" /> Weak areas
        </h3>
        {weakSubjects.length === 0 && weakTopics.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
            <Sparkles className="mr-1 inline h-4 w-4" /> No weak areas yet — you're scoring above 70% everywhere. Keep it up!
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {weakSubjects.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">By subject</p>
                <div className="space-y-2">
                  {weakSubjects.map((a) => <AreaRow key={a.name} area={a} />)}
                </div>
              </div>
            )}
            {weakTopics.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">By topic</p>
                <div className="space-y-2">
                  {weakTopics.slice(0, 12).map((a) => <AreaRow key={`${a.subject}-${a.name}`} area={a} showSubject />)}
                </div>
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Weak areas are the subjects/topics where you answered below 70% correctly. Revise these, then re-attempt to improve.
        </p>
      </div>

      {/* Attempted quizzes & tests — shown in full on the details page; on the
          dashboard the Attempts card links here instead of listing inline. */}
      {full && (
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <BarChart3 className="h-4 w-4 text-brand-600" /> Your quizzes & tests ({items.length})
        </h3>
        <div className="space-y-2">
          {items.map((it) => {
            const open = openId === it.id;
            const KindIcon = it.kind === "test" ? FileStack : ListChecks;
            return (
              <div key={it.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setOpenId(open ? null : it.id)}
                  className="flex w-full items-center gap-2 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  {open ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />}
                  <KindIcon className={`h-4 w-4 flex-shrink-0 ${it.kind === "test" ? "text-brand-600" : "text-violet-600"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{it.title}</p>
                    {(() => {
                      const trail = [it.location?.stream, it.location?.subject, it.location?.topic].filter(Boolean).join(" › ");
                      return trail ? <p className="truncate text-[11px] text-slate-400">{trail}</p> : null;
                    })()}
                    <p className="text-xs text-slate-400">
                      {it.kind === "test" ? "Test" : "Quiz"} · attempted {it.count} time{it.count === 1 ? "" : "s"}
                      {it.lastAt ? ` · last ${fmtDate(it.lastAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-sm font-bold ${pctTone(it.best)}`}>{it.best}%</p>
                    <p className="text-[11px] text-slate-400">best</p>
                  </div>
                </button>
                {open && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    {it.attempts.map((a, i) => {
                      const aOpen = openAttempt === a._id;
                      const rev = reviews[a._id];
                      return (
                        <div key={a._id} className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
                          {/* Tap an attempt to see its full question-by-question review. */}
                          <button
                            type="button"
                            onClick={() => toggleAttempt(a._id)}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:text-sm"
                          >
                            {aOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                            <span className="w-6 flex-shrink-0 font-semibold text-slate-400">#{it.attempts.length - i}</span>
                            <span className="min-w-[8rem] flex-1 text-slate-500 dark:text-slate-400">{fmtDate(a.createdAt)}</span>
                            <span className={`font-bold ${pctTone(a.percentage)}`}>{a.percentage}%</span>
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {a.correct}
                            </span>
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                              <XCircle className="h-3.5 w-3.5" /> {a.incorrect}
                            </span>
                            <span className="text-slate-400">of {a.total}</span>
                            <span className="inline-flex items-center gap-1 text-slate-400">
                              <Clock className="h-3.5 w-3.5" /> {fmtTime(a.timeTaken)}
                            </span>
                          </button>
                          {aOpen && (
                            <div className="bg-slate-50/60 px-3 pb-3 pt-1 dark:bg-slate-900/30">
                              {rev?.loading ? (
                                <p className="px-1 py-3 text-xs text-slate-400">Loading the questions…</p>
                              ) : rev?.error ? (
                                <p className="px-1 py-3 text-xs text-rose-500">{rev.error}</p>
                              ) : rev?.data ? (
                                <div className="space-y-3">
                                  <p className="px-1 pt-1 text-xs text-slate-400">
                                    {rev.data.correct} correct · {rev.data.incorrect} incorrect · {rev.data.total} question{rev.data.total === 1 ? "" : "s"}
                                  </p>
                                  {rev.data.review.map((rq, k) => (
                                    <div key={`${rq._id}-${k}`}>
                                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                                        <span className={`rounded-full px-2 py-0.5 font-semibold ${rq.isCorrect
                                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                          : rq.chosen == null
                                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                            : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
                                          {rq.isCorrect ? "Correct" : rq.chosen == null ? "Skipped" : "Incorrect"}
                                        </span>
                                        <span className="text-slate-500 dark:text-slate-400">Your answer: <b>{optLetter(rq.chosen)}</b></span>
                                      </div>
                                      <QuestionView q={rq} index={k + 1} />
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
