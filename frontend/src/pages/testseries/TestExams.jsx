import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, ChevronRight, Layers } from "lucide-react";
import { examService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function TestExams() {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    examService.exams()
      .then(setExams)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="container-page py-12">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Test Series</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">Choose an exam to see its posts and mock tests.</p>

      {loading ? (
        <Loading label="Loading exams..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : exams.length === 0 ? (
        <EmptyState message="No exams available yet. Please check back soon." />
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {exams.map((ex, i) => (
            <Link
              key={ex._id}
              to={`/test-series/${ex._id}`}
              style={{ animationDelay: `${i * 40}ms` }}
              className="card-hover flex animate-fade-in-up items-center gap-4 p-6 opacity-0"
            >
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <GraduationCap className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-bold">{ex.name}</h3>
                <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                  <Layers className="h-4 w-4" /> {ex.posts ?? 0} posts
                </p>
              </div>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
