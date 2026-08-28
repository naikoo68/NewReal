import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Briefcase, FileText } from "lucide-react";
import { examService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function ExamPosts() {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([examService.exams(), examService.posts(examId)])
      .then(([exams, ps]) => {
        setExam(exams.find((e) => e._id === examId) || null);
        setPosts(ps);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [examId]);

  if (loading) return <div className="container-page"><Loading label="Loading posts..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="container-page py-12">
      <Link to="/test-series" className="btn-ghost mb-6 -ml-2 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to exams
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-brand-600 dark:text-brand-400">Exam</p>
        <h1 className="text-3xl font-extrabold">{exam?.name || "Posts"}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{posts.length} post(s) available</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Posts</h2>
      {posts.length === 0 ? (
        <EmptyState message="No posts in this exam yet." />
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p, i) => (
            <Link
              key={p._id}
              to={`/test-series/${examId}/${p._id}`}
              style={{ animationDelay: `${i * 40}ms` }}
              className="card-hover flex animate-fade-in-up items-center gap-4 p-6 opacity-0"
            >
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300">
                <Briefcase className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-bold">{p.name}</h3>
                <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                  <FileText className="h-4 w-4" /> {p.tests ?? 0} tests
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
