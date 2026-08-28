import { useEffect, useState } from "react";
import { X, Trash2, Undo2, Loader2, Archive, AlertTriangle } from "lucide-react";
import { recycleService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../ui/AsyncState";
import Badge from "../ui/Badge";

// Friendly label + colour for each content type shown in the bin.
const TYPE_LABEL = {
  stream: "Stream",
  subject: "Subject",
  topic: "Topic",
  session: "Session",
  quiz: "Quiz",
  question: "Question",
};

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "";

/**
 * RecycleBinModal — lists every soft-deleted content item (Stream → Question)
 * and lets an admin RESTORE it (brings its whole subtree back) or DELETE it
 * FOREVER (a real cascade removal that can't be undone). "Empty bin" purges all.
 *
 * Props:
 *  - open: boolean
 *  - onClose()
 *  - onChange()  — called after any restore/delete so the parent can reload lists
 */
export default function RecycleBinModal({ open, onClose, onChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(""); // `${type}:${id}` currently acting on
  const [emptying, setEmptying] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    recycleService
      .list()
      .then((res) => setItems(res.items || []))
      .catch((e) => setError(e?.message || "Couldn't load the Recycle Bin."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  if (!open) return null;

  const restore = async (it) => {
    setBusyId(`${it.type}:${it._id}`);
    try {
      await recycleService.restore(it.type, it._id);
      setItems((list) => list.filter((x) => !(x.type === it.type && x._id === it._id)));
      onChange?.();
    } catch (e) {
      setError(e?.message || "Restore failed.");
    } finally {
      setBusyId("");
    }
  };

  const removeForever = async (it) => {
    if (!window.confirm(`Permanently delete this ${TYPE_LABEL[it.type] || it.type}?\n\nThis also removes everything inside it and CANNOT be undone.`)) return;
    setBusyId(`${it.type}:${it._id}`);
    try {
      await recycleService.remove(it.type, it._id);
      setItems((list) => list.filter((x) => !(x.type === it.type && x._id === it._id)));
      onChange?.();
    } catch (e) {
      setError(e?.message || "Delete failed.");
    } finally {
      setBusyId("");
    }
  };

  const emptyBin = async () => {
    if (!window.confirm("Permanently empty the Recycle Bin?\n\nEvery item here (and everything inside them) will be deleted forever. This CANNOT be undone.")) return;
    setEmptying(true);
    try {
      await recycleService.empty();
      setItems([]);
      onChange?.();
    } catch (e) {
      setError(e?.message || "Couldn't empty the bin.");
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="min-h-full w-full max-w-3xl animate-scale-in card m-0 rounded-none p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Archive className="h-5 w-5 text-brand-600" /> Recycle Bin
            {items.length > 0 && <Badge>{items.length}</Badge>}
          </h3>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button onClick={emptyBin} disabled={emptying} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:hover:bg-rose-900/20">
                {emptying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Empty bin
              </button>
            )}
            <button onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>

        <p className="mb-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          Deleted content is kept here so you can restore it. Restoring a stream, subject, topic, session or quiz brings back everything inside it. "Delete forever" cannot be undone.
        </p>

        {loading ? (
          <Loading label="Loading Recycle Bin…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="The Recycle Bin is empty. Deleted items will appear here." />
        ) : (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {items.map((it) => {
              const busy = busyId === `${it.type}:${it._id}`;
              return (
                <div key={`${it.type}:${it._id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge>{TYPE_LABEL[it.type] || it.type}</Badge>
                      <span className="truncate text-sm font-medium">{it.title}</span>
                    </div>
                    {it.deletedAt && <p className="mt-0.5 text-xs text-slate-400">Deleted {fmt(it.deletedAt)}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <button onClick={() => restore(it)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900/50 dark:hover:bg-emerald-900/20">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Restore
                    </button>
                    <button onClick={() => removeForever(it)} disabled={busy} title="Delete forever" className="rounded-lg bg-white p-1.5 text-rose-600 shadow hover:bg-rose-50 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-rose-900/30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn-outline">Close</button>
        </div>
      </div>
    </div>
  );
}
