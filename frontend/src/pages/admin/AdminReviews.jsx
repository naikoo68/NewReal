import { useEffect, useState } from "react";
import { Star, Check, X, Trash2, MessageSquareQuote } from "lucide-react";
import { reviewService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";
import Badge from "../../components/ui/Badge";
import Avatar from "../../components/ui/Avatar";

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const statusVariant = (s) => (s === "approved" ? "brand" : s === "rejected" ? "neutral" : "accent");
const fmt = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; } };

export default function AdminReviews() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");

  const load = () => {
    setLoading(true);
    setError("");
    reviewService
      .list()
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const approve = async (r) => {
    try {
      await reviewService.approve(r._id);
      setItems((l) => l.map((x) => (x._id === r._id ? { ...x, status: "approved" } : x)));
    } catch (e) { alert(e.message); }
  };
  const reject = async (r) => {
    try {
      await reviewService.reject(r._id);
      setItems((l) => l.map((x) => (x._id === r._id ? { ...x, status: "rejected" } : x)));
    } catch (e) { alert(e.message); }
  };
  const remove = async (r) => {
    if (!window.confirm("Delete this review permanently?")) return;
    try {
      await reviewService.remove(r._id);
      setItems((l) => l.filter((x) => x._id !== r._id));
    } catch (e) { alert(e.message); }
  };

  const pendingCount = items.filter((r) => r.status === "pending").length;
  const shown = filter === "all" ? items : items.filter((r) => r.status === filter);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <MessageSquareQuote className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold leading-none">Reviews</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Approve student &amp; client reviews to feature them on your home page.{pendingCount ? ` ${pendingCount} awaiting review.` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === f.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
          >
            {f.label}{f.key === "pending" && pendingCount ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {loading ? (
          <Loading label="Loading reviews…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : shown.length === 0 ? (
          <EmptyState message="No reviews here yet." />
        ) : (
          <div className="space-y-3">
            {shown.map((r) => (
              <div key={r._id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.name}</span>
                      {r.exam && <span className="text-sm text-slate-500 dark:text-slate-400">· {r.exam}</span>}
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      <span className="text-xs capitalize text-slate-400">{r.role}</span>
                    </div>
                    <div className="mt-1 flex gap-0.5 text-amber-400">
                      {Array.from({ length: 5 }).map((_, k) => (
                        <Star key={k} className={`h-4 w-4 ${k < (r.rating || 5) ? "fill-current" : "opacity-30"}`} />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Avatar src={r.photo} name={r.name} size={40} />
                    <span className="text-xs text-slate-400">{fmt(r.createdAt)}</span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">“{r.text}”</p>
                {r.email && <p className="mt-1 text-xs text-slate-400">{r.email}</p>}

                <div className="mt-4 flex flex-wrap gap-2">
                  {r.status !== "approved" && (
                    <button onClick={() => approve(r)} className="btn-primary py-1.5 text-sm"><Check className="h-4 w-4" /> Approve &amp; feature</button>
                  )}
                  {r.status !== "rejected" && (
                    <button onClick={() => reject(r)} className="btn-outline py-1.5 text-sm"><X className="h-4 w-4" /> Reject</button>
                  )}
                  <button onClick={() => remove(r)} className="btn-outline py-1.5 text-sm text-rose-600"><Trash2 className="h-4 w-4" /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Approving copies the review into your home-page testimonials. To later remove a featured review, edit the list in <b>Customization → Testimonials</b>.
      </p>
    </div>
  );
}
