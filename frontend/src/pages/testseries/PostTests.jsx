import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Clock, FileText, Award, Play, Lock, CheckCircle2, Layers, ChevronLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { examService, testService } from "../../services";
import Badge from "../../components/ui/Badge";
import PaperExport from "../../components/admin/PaperExport";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

const categories = ["All", "Full-Length", "Subject-wise", "Chapter-wise", "Previous Year"];

export default function PostTests() {
  const { examId, postId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState("All");
  const [post, setPost] = useState(null);
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([examService.posts(examId), testService.list({ post: postId })])
      .then(([posts, ts]) => {
        setPost(posts.find((p) => p._id === postId) || null);
        setTests(ts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [examId, postId]);

  const filtered = active === "All" ? tests : tests.filter((t) => t.category === active);

  return (
    <div className="container-page py-12">
      <Link to={`/test-series/${examId}`} className="btn-ghost mb-6 -ml-2 w-fit">
        <ChevronLeft className="h-4 w-4" /> Back to posts
      </Link>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-accent-600 dark:text-accent-400">Post</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">{post?.name || "Tests"}</h1>
        <p className="text-slate-600 dark:text-slate-300">Full-length mocks, subject &amp; chapter tests, and previous-year papers.</p>
      </div>

      {!user && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <Lock className="h-5 w-5 flex-shrink-0" />
          <span>
            You need to <Link to="/login" className="font-semibold underline">log in</Link> to start a test.
          </span>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              active === c
                ? "bg-brand-600 text-white shadow-soft"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-brand-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading label="Loading tests..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState message="No tests in this category yet." />
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t, i) => (
            <div
              key={t._id}
              onClick={() => navigate(user ? `/test-series/attempt/${t._id}` : "/login")}
              style={{ animationDelay: `${i * 40}ms` }}
              className="card-hover flex animate-fade-in-up cursor-pointer flex-col p-6 opacity-0"
            >
              <div className="flex items-start justify-between">
                <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  <Layers className="h-3.5 w-3.5" /> {t.category}
                </span>
                {t.enrolled && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Enrolled
                  </span>
                )}
              </div>

              <h3 className="mt-3 text-lg font-bold">{t.name}</h3>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
                  <Clock className="mx-auto h-4 w-4 text-brand-500" />
                  <p className="mt-1 font-semibold">{t.duration}m</p>
                </div>
                <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
                  <FileText className="mx-auto h-4 w-4 text-accent-500" />
                  <p className="mt-1 font-semibold">{t.questionCount} Q</p>
                </div>
                <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
                  <Award className="mx-auto h-4 w-4 text-violet-500" />
                  <p className="mt-1 font-semibold">{t.marks}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <Badge variant={t.difficulty}>{t.difficulty}</Badge>
                <span className="text-xs text-slate-400">{(t.attempts || 0).toLocaleString()} attempts</span>
              </div>

              {t.validUntil && (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                  <Clock className="h-3.5 w-3.5" /> Access valid until{" "}
                  {new Date(t.validUntil).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}

              {user ? (
                <div className="mt-5 space-y-2">
                  <span className="btn-primary w-full">
                    <Play className="h-4 w-4" /> Start Test
                  </span>
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <PaperExport title={t.name || "Test"} label="Download question paper" paperOnly load={() => testService.get(t._id)} />
                  </div>
                </div>
              ) : (
                <span className="btn-outline mt-5 w-full">
                  <Lock className="h-4 w-4" /> Login to Start
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
