import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Icons from "lucide-react";
import { ChevronLeft, ArrowRight, Layers, FileQuestion } from "lucide-react";
import { contentService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function SubjectTopics() {
  const { subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([contentService.subjects(), contentService.topics(subjectId)])
      .then(([subjects, tps]) => {
        setSubject(subjects.find((s) => s._id === subjectId) || null);
        setTopics(tps);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [subjectId]);

  if (loading) return <div className="container-page"><Loading label="Loading topics..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;
  if (!subject) {
    return (
      <div className="container-page py-20 text-center">
        <FileQuestion className="mx-auto h-12 w-12 text-slate-400" />
        <h2 className="mt-4 text-2xl font-bold">Subject not found</h2>
        <Link to="/quiz" className="btn-primary mt-6">Back to subjects</Link>
      </div>
    );
  }

  const Icon = Icons[subject.icon] || Icons.BookOpen;
  const backTo = subject.stream ? `/quiz/stream/${subject.stream}` : "/quiz";

  return (
    <div className="container-page py-12">
      <Link to={backTo} className="btn-ghost mb-6 -ml-2 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to subjects
      </Link>

      <div className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${subject.color} text-white shadow-soft`}>
          <Icon className="h-8 w-8" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-extrabold">{subject.name}</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{subject.description}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400">{topics.length}</p>
          <p className="text-xs text-slate-500">Topics</p>
        </div>
      </div>

      <h2 className="mt-10 text-xl font-bold">Topics</h2>
      {topics.length === 0 ? (
        <EmptyState message="No topics in this subject yet." />
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {topics.map((t, i) => (
            <Link
              key={t._id}
              to={`/quiz/${subjectId}/${t._id}`}
              style={{ animationDelay: `${i * 50}ms` }}
              className="card-hover group animate-fade-in-up flex flex-col p-6 opacity-0"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300">
                  <Layers className="h-5 w-5" />
                </span>
                <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {t.sessions} sessions
                </span>
              </div>
              <h3 className="mt-3 text-lg font-bold">{t.title}</h3>
              {t.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{t.description}</p>
              )}
              <span className="mt-4 flex items-center gap-1 text-sm font-semibold text-brand-600 transition group-hover:gap-2 dark:text-brand-400">
                View sessions <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
