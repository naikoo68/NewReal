import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search, ArrowRightLeft, ChevronRight } from "lucide-react";
import { userManualService } from "../../services";
import { DEFAULT_MANUAL, manualImageSrc } from "./manualDefault";
import { Loading } from "../../components/ui/AsyncState";

// Returns true if an entry (or any of its descendants) matches the search text.
function matches(entry, q) {
  if (!q) return true;
  const hay = [entry.title, entry.summary, ...(entry.details || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes(q)) return true;
  return (entry.children || []).some((c) => matches(c, q));
}

// One manual entry, rendered recursively so functions → sub-functions → … all
// use the same layout (image + details + nested children), just indented more.
function Entry({ entry, depth, index, onGoTab }) {
  const isTop = depth === 0;
  const HeadingTag = isTop ? "h2" : "h3";
  const src = manualImageSrc(entry.image);

  return (
    <section
      className={
        isTop
          ? "card p-5"
          : "mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
      }
    >
      <div className="flex items-center gap-2">
        {isTop ? (
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-extrabold text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            {index}
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-brand-500" />
        )}
        <HeadingTag className={isTop ? "text-lg font-extrabold" : "font-bold"}>
          {entry.title}
        </HeadingTag>
        {entry.tab && onGoTab && (
          <button
            onClick={() => onGoTab(entry.tab)}
            className="btn-ghost ml-auto text-xs text-brand-600"
          >
            Open <ArrowRightLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {entry.summary && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{entry.summary}</p>
      )}

      {/* Screenshot / image for this function, managed from the Admin Panel. */}
      {src && (
        <figure className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <img
            src={src}
            alt={`Screenshot of ${entry.title}`}
            loading="lazy"
            className="block w-full"
          />
        </figure>
      )}

      {entry.details?.length > 0 && (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
          {entry.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ol>
      )}

      {/* Sub-functions — rendered with the exact same component, one level in. */}
      {entry.children?.length > 0 && (
        <div className={isTop ? "mt-4" : "mt-3"}>
          {entry.children.map((child, i) => (
            <Entry key={child.id || i} entry={child} depth={depth + 1} onGoTab={onGoTab} />
          ))}
        </div>
      )}
    </section>
  );
}

// The USER MANUAL clients see. Content is loaded live from the API (managed by
// admins in Admin → User Manual). If nothing has been saved yet — or the API
// can't be reached — it falls back to the built-in DEFAULT_MANUAL, so the page
// is never blank.
export default function ClientUserManual({ onGoTab }) {
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState(null); // sections loaded from the API
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    userManualService
      .get()
      .then((r) => active && setSaved(Array.isArray(r?.sections) ? r.sections : []))
      .catch(() => active && setSaved([])) // fall back to defaults on any error
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const base = saved && saved.length ? saved : DEFAULT_MANUAL;
  const query = q.trim().toLowerCase();
  const sections = useMemo(() => base.filter((e) => matches(e, query)), [base, query]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold leading-none">User Manual</h1>
            <p className="mt-1 text-sm text-slate-400">
              A step-by-step guide to every tool, with a screenshot of each screen.
            </p>
          </div>
        </div>

        {/* Search across every function and sub-function. */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the manual…"
            className="input pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="card p-6">
          <Loading label="Loading the manual…" />
        </div>
      ) : sections.length > 0 ? (
        sections.map((entry, i) => (
          <Entry key={entry.id || i} entry={entry} depth={0} index={i + 1} onGoTab={onGoTab} />
        ))
      ) : (
        <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Nothing matches “{q}”. Try a different search.
        </div>
      )}
    </div>
  );
}
