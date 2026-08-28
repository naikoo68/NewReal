import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, FileText, Download, ExternalLink } from "lucide-react";
import { studyService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

// Make sure a link is absolute so it opens correctly (a link saved without
// http:// would otherwise be treated as a path on our own site).
const safeUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return "#";
  return /^https?:\/\//i.test(s) || s.startsWith("data:") ? s : `https://${s}`;
};

// A URL that forces a download rather than opening in the browser. The HTML
// `download` attribute is ignored across origins, so we ask the file's host to
// serve it as an attachment instead.
const downloadUrl = (u) => {
  const s = safeUrl(u);
  // Cloudinary: fl_attachment makes it download.
  if (s.includes("res.cloudinary.com") && s.includes("/upload/")) {
    return s.replace("/upload/", "/upload/fl_attachment/");
  }
  // Google Drive: convert a share/view link to a direct-download link.
  if (s.includes("drive.google.com")) {
    const m = s.match(/\/file\/d\/([^/]+)/) || s.match(/[?&]id=([^&]+)/);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }
  return s;
};

export default function StudyFiles() {
  const { institutionId, subjectId, classId } = useParams();
  const [cls, setCls] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([studyService.classes(subjectId), studyService.files(classId)])
      .then(([classes, fs]) => {
        setCls(classes.find((x) => x._id === classId) || null);
        setFiles(fs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [subjectId, classId]);

  if (loading) return <div className="container-page"><Loading label="Loading files..." /></div>;
  if (error) return <div className="container-page"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="container-page py-12">
      <Link to={`/study/${institutionId}/${subjectId}`} className="btn-ghost mb-6 -ml-2 w-fit"><ChevronLeft className="h-4 w-4" /> Back</Link>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Class</p>
        <h1 className="text-3xl font-extrabold">{cls?.name || "Files"}</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">{files.length} file(s)</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">Study Files</h2>
      {files.length === 0 ? (
        <EmptyState message="No files uploaded yet." />
      ) : (
        <div className="mt-5 space-y-3">
          {files.map((f, i) => (
            <div key={f._id} style={{ animationDelay: `${i * 40}ms` }} className="card flex animate-fade-in-up items-center justify-between gap-3 p-4 opacity-0">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{f.title}</p>
                  {f.description && <p className="truncate text-sm text-slate-500 dark:text-slate-400">{f.description}</p>}
                  {f.fileType && <span className="text-xs font-medium uppercase text-slate-400">{f.fileType}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <a href={safeUrl(f.url)} target="_blank" rel="noreferrer" className="btn-outline py-2"><ExternalLink className="h-4 w-4" /> View</a>
                <a href={downloadUrl(f.url)} download target="_blank" rel="noreferrer" className="btn-primary py-2"><Download className="h-4 w-4" /> Download</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
