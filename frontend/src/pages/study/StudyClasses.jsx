import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Users2, FileText } from "lucide-react";
import { studyService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function StudyClasses() {
  const { institutionId, subjectId } = useParams();
  const [subject, setSubject] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([studyService.subjects(institutionId), studyService.classes(subjectId)])
      .then(([subs, cls]) => {
        setSubject(subs.find((x) => x._id === subjectId) || null);
        setClasses(cls);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [institutionId, subjectId]);

  if (loading) return <div className="container-page"><Loading label="Loading classes..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="container-page py-12">
      <Link to={`/study/${institutionId}`} className="btn-ghost mb-6 -ml-2 w-fit"><ChevronLeft className="h-4 w-4" /> Back</Link>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-accent-600 dark:text-accent-400">Subject</p>
        <h1 className="text-3xl font-extrabold">{subject?.name || "Classes"}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{classes.length} class(es)</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Classes</h2>
      {classes.length === 0 ? (
        <EmptyState message="No classes yet." />
      ) : (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {classes.map((c, i) => (
            <Link key={c._id} to={`/study/${institutionId}/${subjectId}/${c._id}`} style={{ animationDelay: `${i * 40}ms` }} className="card-hover flex animate-fade-in-up items-center gap-4 p-6 opacity-0">
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"><Users2 className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-bold">{c.name}</h3>
                <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"><FileText className="h-4 w-4" /> {c.files ?? 0} files</p>
              </div>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
