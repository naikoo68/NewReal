import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ListChecks, FileText, Clock, Award, HelpCircle, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { practiceService } from "../services";
import { useSettings } from "../context/SettingsContext";

// Player URL for a shared item, by kind (hash-router friendly). My Quiz opens
// in the reveal-style quiz player; everything else uses the exam-style player.
const itemPath = (kind, token) => `/public/${kind === "quiz" ? "quiz" : "test"}/${token}`;

const LEVEL_WORD = { stream: "stream", subject: "subject", topic: "topic" };

/**
 * PublicNode — the public page a shared stream/subject/topic link opens.
 * Lists every quiz/test under the node; each links to its own public player.
 * No account or login required.
 */
export default function PublicNode() {
  const { token } = useParams();
  const { settings } = useSettings();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    practiceService
      .getPublicNode(token)
      .then((r) => active && setData(r))
      .catch((e) => active && setError(e.message || "This link is invalid or public sharing was turned off."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const brand = settings?.siteName || settings?.brandName || "My Study Guide";

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      <div className="container-page py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm font-bold text-brand-600 hover:underline">{brand}</Link>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Public link</span>
        </div>

        {loading ? (
          <div className="py-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
        ) : error ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/50 dark:bg-rose-900/20">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-rose-500" />
            <p className="font-semibold text-rose-700 dark:text-rose-300">{error}</p>
            <Link to="/" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">Go to {brand} ↗</Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{LEVEL_WORD[data.level] || "collection"}</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{data.name}</h1>
              {data.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{data.description}</p>}
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {data.items.length} {data.items.length === 1 ? "item" : "items"} available — tap any to take it. No account or login needed.
              </p>
            </div>

            {data.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-700">
                Nothing is shared here yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((it) => {
                  const isQuiz = it.kind === "quiz";
                  const Icon = isQuiz ? ListChecks : FileText;
                  return (
                    <Link
                      key={it.token}
                      to={itemPath(it.kind, it.token)}
                      className="group card p-4 transition hover:border-brand-300 hover:shadow-md dark:hover:border-brand-600"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${isQuiz ? "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" : "bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300"}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
                      </div>
                      <p className="mt-3 font-bold text-slate-800 dark:text-slate-100">{it.name}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1"><HelpCircle className="h-3.5 w-3.5" /> {it.questionCount} Qs</span>
                        {it.duration ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {it.duration} min</span> : null}
                        {it.marks ? <span className="inline-flex items-center gap-1"><Award className="h-3.5 w-3.5" /> {it.marks} marks</span> : null}
                        {it.difficulty ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium dark:bg-slate-800">{it.difficulty}</span> : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
