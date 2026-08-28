import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trophy, CheckCircle2, XCircle, Printer, Award, User as UserIcon, Mail, Clock, RefreshCw } from "lucide-react";
import { cbtService } from "../../services";
import { Loading, ErrorState } from "../../components/ui/AsyncState";
import MathText from "../../components/ui/MathText";
import OptionContent from "../../components/ui/OptionContent";
import StatementPairView from "../../components/ui/StatementPairView";
import TableView from "../../components/ui/TableView";
import GraphView from "../../components/ui/GraphView";
import AssertionReasonView from "../../components/ui/AssertionReasonView";
import { stemText, displayOptions } from "../../lib/questions";

function toRoman(n) {
  const m = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [s, v] of m) while (n >= v) { r += s; n -= v; }
  return r;
}
const fmtTime = (s) => {
  const n = Number(s) || 0;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

// Public, printable result page for a CBT exam (reached from the emailed link —
// no login). Renders the full graded breakdown with proper maths, and a
// Print → Save-as-PDF button for a clean offline copy.
export default function CbtResult() {
  const { resultToken } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    cbtService
      .getResult(resultToken)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [resultToken]);

  const reload = () => {
    setLoading(true);
    cbtService.getResult(resultToken).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  if (loading) return <div className="container-page"><Loading label="Loading your result..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} /></div>;
  if (!data) return null;

  // Results are DEFERRED — shown only after the exam ends / is released.
  if (data.pending) {
    const endText = data.endAt ? new Date(data.endAt).toLocaleString() : null;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="card w-full max-w-lg p-8 text-center">
          <Clock className="mx-auto h-14 w-14 text-amber-500" />
          <h1 className="mt-4 text-2xl font-extrabold">Results not out yet</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">{data.examName}</p>
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            Hi {data.name}, your response is recorded. Your <b>score and rank</b> will be published{" "}
            {endText ? <>after the exam ends on <b>{endText}</b></> : <>once the exam is over</>}.
            {data.email && <> We'll email your full scorecard to <b>{data.email}</b>.</>}
          </div>
          <button onClick={reload} className="btn-outline mt-6"><RefreshCw className="h-4 w-4" /> Check again</button>
        </div>
      </div>
    );
  }

  const review = data.review || [];
  const stats = [
    ...(data.rank ? [{ l: "Rank", v: `#${data.rank}${data.candidates ? ` / ${data.candidates}` : ""}`, c: "text-amber-600 dark:text-amber-400" }] : []),
    { l: "Score", v: `${data.score}/${data.maxScore ?? "—"}`, c: "text-brand-600 dark:text-brand-400" },
    { l: "Percentage", v: `${data.percentage}%`, c: "text-brand-600 dark:text-brand-400" },
    { l: "Correct", v: data.correct, c: "text-emerald-600 dark:text-emerald-400" },
    { l: "Wrong", v: data.incorrect, c: "text-rose-600 dark:text-rose-400" },
    { l: "Skipped", v: data.skipped, c: "text-amber-600 dark:text-amber-400" },
    { l: "Time", v: fmtTime(data.timeTaken), c: "text-slate-700 dark:text-slate-200" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-8 dark:bg-slate-950 print:bg-white print:py-0">
      <div className="container-page max-w-4xl">
        <div className="card p-6 print:border-0 print:shadow-none sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold">{data.examName}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1"><UserIcon className="h-4 w-4" /> {data.name}</span>
                <span className="inline-flex items-center gap-1"><Mail className="h-4 w-4" /> {data.email}</span>
              </p>
            </div>
            <button onClick={() => window.print()} className="btn-primary print:hidden">
              <Printer className="h-4 w-4" /> Print / Save as PDF
            </button>
          </div>

          {data.rank && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 to-brand-50 p-4 dark:from-amber-900/20 dark:to-brand-900/20">
              <Award className="h-10 w-10 flex-shrink-0 text-amber-500" />
              <div>
                <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">Rank #{data.rank}{data.candidates ? ` of ${data.candidates}` : ""}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Score {data.score}/{data.maxScore} · {data.percentage}%</p>
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {stats.map((s) => (
              <div key={s.l} className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/60">
                <p className={`text-xl font-bold ${s.c}`}>{s.v}</p>
                <p className="text-xs text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Full answer key + explanations */}
        <div className="mt-6 space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Trophy className="h-5 w-5 text-brand-600" /> Answers &amp; Explanations</h2>
          {review.map((r, i) => (
            <div key={r._id || i} className="card p-5 print:break-inside-avoid">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  <span className="mr-2 text-slate-400">Q{i + 1}.</span>
                  <MathText>{stemText(r)}</MathText>
                </p>
                <span className={`flex-shrink-0 text-xs font-semibold ${r.chosen == null ? "text-amber-600" : r.isCorrect ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.chosen == null ? "Skipped" : r.isCorrect ? "Correct" : "Wrong"}
                </span>
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
          ))}
        </div>

        <p className="py-6 text-center text-xs text-slate-400">Submitted {data.submittedAt ? new Date(data.submittedAt).toLocaleString() : ""}</p>
      </div>
    </div>
  );
}
