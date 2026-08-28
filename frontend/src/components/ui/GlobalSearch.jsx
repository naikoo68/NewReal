import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Search, X, Loader2 } from "lucide-react";
import { searchService, contentService } from "../../services";
import { searchQuestions } from "../../lib/questions";
import QuestionView from "../admin/QuestionView";

// Colour chip per result type.
const TYPE_STYLES = {
  Stream: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  Subject: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  Topic: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  Session: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  Quiz: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Test: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "My Quiz": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "My Test": "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  Question: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

const preview = (t, n = 90) => {
  const s = String(t || "").replace(/\$/g, "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};

// Reusable metadata + question search box with a live results dropdown.
//   • mode="public" → calls /api/search (names + published questions)
//   • mode="admin"  → searches ALL your questions CLIENT-SIDE via the existing
//                     /api/questions endpoint (works even if the new search API
//                     hasn't redeployed), and adds name matches from /api/search.
// The dropdown renders in a portal so it is never clipped by a parent.
export default function GlobalSearch({
  mode = "public",
  placeholder = "Search streams, subjects, topics, quizzes, tests…",
  className = "",
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [detail, setDetail] = useState(null); // full question shown on tap
  const [rect, setRect] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const questionCache = useRef(null); // admin: cached /api/questions list
  const navigate = useNavigate();

  const measure = useCallback(() => {
    if (!boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 6, width: r.width });
  }, []);

  // Load (and cache) all questions for admin client-side search.
  const loadQuestions = useCallback(async () => {
    if (questionCache.current) return questionCache.current;
    const list = await contentService.allQuestions();
    questionCache.current = Array.isArray(list) ? list : [];
    return questionCache.current;
  }, []);

  // Debounced search (300ms). Needs at least 2 characters.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setErr("");
      setNote("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        if (mode === "admin") {
          // 1) Questions — client-side over the recent bank (instant, has full data).
          const list = await loadQuestions();
          const qMap = new Map();
          for (const qq of searchQuestions(list, query) || []) {
            qMap.set(String(qq._id), {
              type: "Question",
              id: qq._id,
              title: preview(qq.text),
              subtitle:
                [qq.stream, qq.subject, qq.quiz].filter((x) => x && x !== "—").join(" · ") || "Question",
              match: qq._match,
              raw: qq, // full question → shown in a detail panel on tap
            });
          }
          // 2) Whole-library matches + name matches from the search API. This
          //    covers questions older than the locally-loaded set.
          let nameHits = [];
          let wholeLibrary = false;
          try {
            const r = await searchService.query(query);
            wholeLibrary = !!r?.meta?.version?.startsWith?.("search-v");
            for (const x of r.results || []) {
              if (x.type === "Question") {
                if (!qMap.has(String(x.id))) qMap.set(String(x.id), x); // adds older questions (with raw for admin)
              } else {
                nameHits.push(x);
              }
            }
          } catch {
            /* search API optional in admin mode */
          }
          const qHits = [...qMap.values()].sort((a, b) => (b.match || 0) - (a.match || 0)).slice(0, 25);
          if (!cancelled) {
            setResults([...nameHits, ...qHits]);
            setErr("");
            setNote(`${list.length} recent · ${wholeLibrary ? "full library" : "local only"}`);
          }
        } else {
          const r = await searchService.query(query);
          if (!cancelled) {
            setResults(r.results || []);
            setErr(r.error || "");
            setNote(r.meta ? `${r.meta.version || ""} · ${r.meta.scope || ""}` : "");
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e.message || "Search failed");
          setResults([]);
          setNote("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, mode, loadQuestions]);

  // Close on outside click (ignore clicks in the box or the portal panel).
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Keep the dropdown aligned while open.
  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  const go = (item) => {
    // Question with full data → show it right here with its breadcrumb.
    if (item.raw) {
      setDetail(item.raw);
      setOpen(false);
      return;
    }
    const path = mode === "admin" ? item.adminPath || item.path : item.path;
    setOpen(false);
    setQ("");
    setResults([]);
    if (path) navigate(path);
  };

  // Stream › Subject › Topic › Session › Quiz from whatever fields are present.
  const trail = (d) =>
    [d?.stream, d?.subject, d?.topicName || d?.topic, d?.session, d?.quiz]
      .filter((x) => x && x !== "—")
      .join(" › ");

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            measure();
          }}
          onFocus={() => {
            setOpen(true);
            measure();
          }}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        {loading && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-slate-400" />}
        {q && !loading && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setResults([]);
            }}
            title="Clear"
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showPanel &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, zIndex: 70 }}
            className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {err ? (
              <p className="px-3 py-4 text-center text-sm text-rose-500">{err}</p>
            ) : loading && !results.length ? (
              <p className="px-3 py-4 text-center text-sm text-slate-500">Searching…</p>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-sm text-slate-500">No matches for “{q.trim()}”.</p>
                {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
              </div>
            ) : (
              <>
                <p className="px-3 py-1 text-xs font-semibold text-slate-400">
                  {results.length} result{results.length === 1 ? "" : "s"}
                  {note ? ` · ${note}` : ""}
                </p>
                {results.map((item) => (
                  <button
                    type="button"
                    key={`${item.type}-${item.id}`}
                    onClick={() => go(item)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span
                      className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${
                        TYPE_STYLES[item.type] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {item.type}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.title}</span>
                      {(item.subtitle || item.match != null) && (
                        <span className="block truncate text-xs text-slate-400">
                          {item.match != null && (
                            <span className="mr-1.5 font-semibold text-rose-500">{item.match}% match</span>
                          )}
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )}

      {/* Question detail — opens on tap, shows the full question + its location. */}
      {detail &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
            onMouseDown={() => setDetail(null)}
          >
            <div
              className="my-10 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Question</p>
                  {trail(detail) && (
                    <p className="mt-0.5 break-words text-sm font-semibold text-brand-600 dark:text-brand-400">
                      {trail(detail)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <QuestionView q={detail} />

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDetail(null)} className="btn-outline">
                  Close
                </button>
                {mode === "admin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetail(null);
                      navigate("/admin/content");
                    }}
                    className="btn-primary"
                  >
                    Open Content Manager
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
