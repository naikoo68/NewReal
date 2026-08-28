import { useState } from "react";
import { Link, useLocation, useParams, Navigate } from "react-router-dom";
import { Doughnut, Bar } from "react-chartjs-2";
import "../../lib/chartSetup";
import {
  Trophy,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  Percent,
  ListChecks,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  Award,
  Search,
  X,
} from "lucide-react";
import PaperExport from "../../components/admin/PaperExport";
import StatCard from "../../components/ui/StatCard";
import MathText from "../../components/ui/MathText";
import OptionContent from "../../components/ui/OptionContent";
import StatementPairView from "../../components/ui/StatementPairView";
import TableView from "../../components/ui/TableView";
import GraphView from "../../components/ui/GraphView";
import AssertionReasonView from "../../components/ui/AssertionReasonView";
import Watermark from "../../components/ui/Watermark";
import FeedbackButton from "../../components/ui/FeedbackButton";
import { questionDateText, searchQuestions, stemText, displayOptions } from "../../lib/questions";

function toRomanLite(n) {
  const m = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of m) while (n >= v) { r += s; n -= v; }
  return r;
}

// Option index → letter (A, B, C…), or — when none.
const optLetter = (n) => (n == null ? "—" : String.fromCharCode(65 + n));

export default function QuizResult() {
  const { state } = useLocation();
  const { subjectId, topicId, sessionId, quizId } = useParams();
  const [showReview, setShowReview] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");

  if (!state) {
    // Direct visit without a submission — redirect back.
    return <Navigate to={`/quiz/${subjectId}/${topicId}/${sessionId}`} replace />;
  }

  const {
    subjectName,
    source,
    total,
    attempted,
    correct,
    incorrect,
    score,
    maxScore,
    percentage,
    timeTaken,
    weakTopics,
    review,
  } = state;

  const unattempted = total - attempted;
  const rank = Math.max(1, Math.round((100 - percentage) * 4 + 1));
  const mmss = `${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s`;

  // Searchable review list — keep the original index for numbering.
  const reviewEntries = (review || []).map((r, i) => ({ ...r, _idx: i }));
  const reviewResults = searchQuestions(reviewEntries, reviewSearch);
  const reviewShown = reviewResults || reviewEntries;

  const doughnutData = {
    labels: ["Correct", "Incorrect", "Unattempted"],
    datasets: [
      {
        data: [correct, incorrect, unattempted],
        backgroundColor: ["#10b981", "#f43f5e", "#cbd5e1"],
        borderWidth: 0,
      },
    ],
  };

  const barData = {
    labels: ["Score", "Accuracy", "Completion"],
    datasets: [
      {
        label: "Performance %",
        data: [
          Math.round((Math.max(0, score) / maxScore) * 100),
          attempted ? Math.round((correct / attempted) * 100) : 0,
          Math.round((attempted / total) * 100),
        ],
        backgroundColor: ["#2563eb", "#f97316", "#8b5cf6"],
        borderRadius: 8,
        barThickness: 38,
      },
    ],
  };

  const barOptions = {
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
    },
  };

  return (
    <div className="container-page py-10">
      <Watermark />
      {/* Header banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-accent-500 p-8 text-center text-white">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <Trophy className="mx-auto h-12 w-12" />
        <h1 className="mt-3 text-3xl font-extrabold">Quiz Completed!</h1>
        <p className="mt-1 text-white/90">{subjectName} — here's how you did.</p>
        <div className="mt-5 inline-flex items-baseline gap-2 rounded-2xl bg-white/15 px-6 py-3 backdrop-blur">
          <span className="text-4xl font-black">{percentage}%</span>
          <span className="text-white/80">score</span>
        </div>
      </div>

      {/* Stat grid */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="ListChecks" label="Total Questions" value={total} accent="brand" />
        <StatCard icon="Target" label="Attempted" value={attempted} accent="violet" />
        <StatCard icon="CheckCircle2" label="Correct" value={correct} accent="green" />
        <StatCard icon="XCircle" label="Incorrect" value={incorrect} accent="accent" />
        <StatCard icon="Award" label="Score" value={`${score} / ${maxScore}`} accent="brand" />
        <StatCard icon="Percent" label="Percentage" value={`${percentage}%`} accent="violet" />
        <StatCard icon="Clock" label="Time Taken" value={mmss} accent="accent" />
        <StatCard icon="Trophy" label="Rank" value={`#${rank}`} sub="among 4,200 peers" accent="green" />
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="mb-4 flex items-center gap-2 font-bold">
            <Target className="h-5 w-5 text-brand-600" /> Answer Distribution
          </h3>
          <div className="mx-auto h-64 max-w-xs">
            <Doughnut data={doughnutData} options={{ plugins: { legend: { position: "bottom" } } }} />
          </div>
        </div>
        <div className="card p-6">
          <h3 className="mb-4 flex items-center gap-2 font-bold">
            <ListChecks className="h-5 w-5 text-accent-500" /> Performance Breakdown
          </h3>
          <div className="h-64">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>
      </div>

      {/* Weak topics */}
      <div className="mt-6 card p-6">
        <h3 className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-5 w-5 text-amber-500" /> Weak Topics Analysis
        </h3>
        {weakTopics.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {weakTopics.map((t) => (
              <span key={t} className="badge bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                {t}
              </span>
            ))}
            <p className="mt-2 w-full text-sm text-slate-500 dark:text-slate-400">
              Focus on these topics in your next session to boost your score.
            </p>
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> No weak topics detected — excellent work!
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={() => setShowReview((s) => !s)} className="btn-primary">
          {showReview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showReview ? "Hide" : "Review"} Answers
        </button>
        {(review || []).length > 0 && <PaperExport title={`${subjectName || "Quiz"}`} questions={review} />}
        <Link to={`/quiz/${subjectId}/${topicId}/${sessionId}/${quizId}`} className="btn-outline">
          <RefreshCw className="h-4 w-4" /> Retake Quiz
        </Link>
        <FeedbackButton context="quiz" source={source || `${subjectName || "Quiz"} (Quiz)`} label="Give Feedback" className="btn-outline" />
        <Link to={`/quiz/${subjectId}/${topicId}/${sessionId}`} className="btn-ghost">
          Back to Quizzes
        </Link>
      </div>

      {/* Review */}
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
            <div key={i} className="card p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800">
                  {i + 1}
                </span>
                <div className="flex-1">
                  {(r._match != null || questionDateText(r)) && (
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {r._match != null && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{r._match}% match</span>
                      )}
                      {questionDateText(r) && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> {questionDateText(r)}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold"><MathText>{stemText(r)}</MathText></p>
                    <FeedbackButton
                      context="question"
                      label="Feedback"
                      questionNumber={i + 1}
                      questionText={r.text}
                      source={source || `${subjectName || "Quiz"} (Quiz)`}
                      details={`Correct: ${optLetter(r.correct)}${r.chosen != null ? `, Chosen: ${optLetter(r.chosen)}` : ", Not attempted"}`}
                      question={r}
                      className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400"
                    />
                  </div>
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
                          <div key={k} className="flex items-start gap-1.5 text-sm"><span className="font-bold text-accent-700 dark:text-accent-300">{toRomanLite(k + 1)}.</span> <MathText>{item}</MathText></div>
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
                            {isCorrect ? (
                              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                            ) : isChosen ? (
                              <XCircle className="h-4 w-4 flex-shrink-0" />
                            ) : (
                              <span className="h-4 w-4" />
                            )}
                            {r.type === "matching" && <span className="font-bold">({String.fromCharCode(97 + idx)})</span>}
                            <OptionContent>{opt}</OptionContent>
                          </div>
                          {!isCorrect && optExp && optExp.trim() && (
                            <p className={`ml-6 mt-0.5 text-xs ${isChosen ? "text-rose-500 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"}`}><MathText>{optExp}</MathText></p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {r.chosen === null && (
                    <p className="mt-2 text-xs font-medium text-slate-400">Not attempted</p>
                  )}
                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <span className="font-semibold">Explanation: </span>
                    <MathText>{r.explanation}</MathText>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
