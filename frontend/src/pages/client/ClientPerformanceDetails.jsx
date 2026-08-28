import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import ClientPerformance from "./ClientPerformance";

// Full-page performance details, opened by tapping the "Attempts" card on the
// dashboard. Shows the complete view (summary, weak areas, and every attempted
// quiz/test with its full per-attempt history) via <ClientPerformance full />.
export default function ClientPerformanceDetails() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button onClick={() => navigate("/client")} className="btn-ghost" title="Back to dashboard">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </button>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <BarChart3 className="h-5 w-5 text-emerald-600" /> Performance details
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="card p-5">
          <ClientPerformance full />
        </div>
      </main>
    </div>
  );
}
