import { useEffect, useMemo, useState } from "react";
import { FileDown, X, Loader2, Download, Maximize2, Minimize2 } from "lucide-react";
import { printPaper, buildPaperHtml, savePdf, paginateByLength } from "../../lib/paper";
import { useSettings } from "../../context/SettingsContext";

// Download a quiz/test as a QUESTION PAPER (PDF, no answers) or ANSWER KEY (PDF,
// with answers + explanations), and VIEW the answer key on screen.
//
// Pass either `questions` (already loaded, admin data incl. `correct`) OR a
// `load` async function that fetches them on demand (for list rows). Renders a
// single button that opens a small chooser modal.
export default function PaperExport({ title = "Question Paper", questions = null, load = null, compact = false, label = "Paper / Key", paperOnly = false }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(Array.isArray(questions) ? questions : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [perPage, setPerPage] = useState(0); // 0 = Auto: fit by text length
  const [border, setBorder] = useState("single"); // none | single | thick | double
  const [previewMode, setPreviewMode] = useState("paper"); // "paper" | "key"
  const [previewFull, setPreviewFull] = useState(false); // full-screen PDF preview
  const [autoGroups, setAutoGroups] = useState(null); // length-based page grouping (Auto)
  const [textScale, setTextScale] = useState(0.5); // manual text-size multiplier (+/-), default 50%
  const bumpText = (d) => setTextScale((s) => Math.min(1.6, Math.max(0.1, Math.round((s + d) * 100) / 100)));

  const { settings } = useSettings();

  useEffect(() => { if (Array.isArray(questions)) setList(questions); }, [questions]);

  // Watermark is ALWAYS added to downloaded PDFs (independent of the on-screen
  // watermark toggle), using the configured text or the site name.
  const wmText = (settings?.watermarkText || "").trim() || `${settings?.siteName || "My Study Guide"} \u00a9`;
  const wmYear = new Date().getFullYear();
  const wmLabel = wmText.includes("\u00a9") ? `${wmText} ${wmYear}` : `${wmText} \u00a9 ${wmYear}`;
  const wmOpacity = Math.min(0.5, Math.max(0.08, (Number(settings?.watermarkOpacity) || 12) / 100));
  const wmSize = Math.min(40, Math.max(12, Number(settings?.watermarkSize) || 16));
  const brand = (settings?.siteName || "My Study Guide").trim();
  // Use the site's brand/accent colours for headings, question numbers, badge
  // and the coloured Column A/B boxes (fall back to the defaults).
  const brandColor = (settings?.primaryColor || "#2563eb").trim();
  const accentColor = (settings?.accentColor || "#f97316").trim();

  const opts = (withAnswers) => ({
    withAnswers,
    perPage: Number(perPage) || 0,
    // In Auto mode (perPage 0) pass the measured length-based page grouping.
    groups: Number(perPage) > 0 ? undefined : (autoGroups || undefined),
    typeScale: textScale, // manual text-size adjustment (+/-)
    border,
    watermark: wmLabel,
    watermarkOpacity: wmOpacity,
    watermarkSize: wmSize,
    brand,
    brandColor,
    accentColor,
  });

  const ensure = async () => {
    if (list.length) return list;
    if (!load) return list;
    setBusy(true);
    setErr("");
    try {
      const res = await load();
      const arr = Array.isArray(res) ? res : (res?.questions || []);
      setList(arr);
      return arr;
    } catch (e) {
      setErr(e.message || "Couldn't load questions.");
      return [];
    } finally {
      setBusy(false);
    }
  };

  const mode = paperOnly ? "paper" : previewMode; // which doc the preview/save uses
  const [saving, setSaving] = useState(false);
  const openModal = async () => { await ensure(); setPreviewFull(false); setOpen(true); };

  // Auto mode: measure the questions and group them into pages by text length,
  // so the preview and the PDF break pages identically. Recomputed whenever the
  // content or layout options change.
  useEffect(() => {
    if (Number(perPage) > 0 || !list.length) { setAutoGroups(null); return; }
    let cancelled = false;
    paginateByLength(mode === "key" ? `${title} — Answer Key` : title, list, opts(mode === "key"))
      .then((g) => { if (!cancelled) setAutoGroups(g); })
      .catch(() => { if (!cancelled) setAutoGroups(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, list, mode, perPage, border, wmSize, brand, brandColor, accentColor, textScale]);

  // Download the PDF file automatically. Falls back to the print window if the
  // in-browser PDF generator can't load.
  const save = async () => {
    const t = mode === "key" ? `${title} — Answer Key` : title;
    setSaving(true);
    try {
      const ok = await savePdf(t, list, opts(mode === "key"));
      if (!ok && !printPaper(t, list, opts(mode === "key"))) {
        window.alert("Couldn't generate the PDF. Allow pop-ups and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  // Live preview HTML (no auto-print) reflecting the chosen layout options.
  const previewHtml = useMemo(
    () => buildPaperHtml(mode === "key" ? `${title} — Answer Key` : title, list, { ...opts(mode === "key"), autoPrint: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, list, mode, perPage, border, wmLabel, wmOpacity, wmSize, brand, brandColor, accentColor, autoGroups, textScale]
  );

  // Estimated page count: fixed per-page → simple division; Auto → the measured
  // length-based grouping (null while still measuring).
  const estPages = Number(perPage) > 0
    ? Math.max(1, Math.ceil(list.length / Number(perPage)))
    : (autoGroups ? autoGroups.length : null);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={busy}
        title="Download question paper / answer key"
        className={compact
          ? "rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
          : "btn-outline !py-1 !text-xs"}
      >
        {busy ? <Loader2 className={compact ? "h-4 w-4 animate-spin" : "h-3.5 w-3.5 animate-spin"} /> : <FileDown className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />}
        {!compact && <> {label}</>}
      </button>

      {open && previewFull && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-slate-900">
          <div className="flex flex-wrap items-center gap-2 bg-slate-800 px-4 py-2 text-white">
            <span className="mr-auto truncate text-sm font-semibold">{mode === "key" ? `${title} — Answer Key` : title}</span>
            {!paperOnly && (
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-600 text-xs font-semibold">
                <button type="button" onClick={() => setPreviewMode("paper")} className={`px-2.5 py-1 ${mode === "paper" ? "bg-brand-600 text-white" : "bg-slate-900 text-slate-300"}`}>Paper</button>
                <button type="button" onClick={() => setPreviewMode("key")} className={`px-2.5 py-1 ${mode === "key" ? "bg-brand-600 text-white" : "bg-slate-900 text-slate-300"}`}>Answer key</button>
              </div>
            )}
            <label className="flex items-center gap-1 text-xs">
              <span className="text-slate-300">Per page</span>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white">
                <option value={0}>Auto (by length)</option>
                <option value={1}>1</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-slate-300">Border</span>
              <select value={border} onChange={(e) => setBorder(e.target.value)} className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white">
                <option value="single">Single</option>
                <option value="thick">Thick</option>
                <option value="double">Double</option>
                <option value="none">None</option>
              </select>
            </label>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-300">Text</span>
              <div className="inline-flex overflow-hidden rounded-md border border-slate-600">
                <button type="button" onClick={() => bumpText(-0.1)} disabled={textScale <= 0.1} title="Smaller text" className="bg-slate-900 px-2 py-1 font-bold text-white disabled:opacity-40">A−</button>
                <span className="bg-slate-800 px-2 py-1 tabular-nums text-white">{Math.round(textScale * 100)}%</span>
                <button type="button" onClick={() => bumpText(0.1)} disabled={textScale >= 1.6} title="Larger text" className="bg-slate-900 px-2 py-1 font-bold text-white disabled:opacity-40">A+</button>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">{estPages ? `${estPages} page${estPages > 1 ? "s" : ""}` : "measuring…"}</span>
            <button type="button" onClick={save} disabled={saving} className="btn-primary !py-1 !text-xs">
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</> : <><Download className="h-3.5 w-3.5" /> Download PDF</>}
            </button>
            <button type="button" onClick={() => setPreviewFull(false)} className="btn-outline !py-1 !text-xs !text-white"><Minimize2 className="h-3.5 w-3.5" /> Exit</button>
          </div>
          <iframe title="PDF full-screen preview" srcDoc={previewHtml} className="min-h-0 flex-1 w-full bg-white" />
        </div>
      )}

      {open && !previewFull && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-2xl animate-scale-in card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-lg font-bold"><FileDown className="h-5 w-5 text-brand-600" /> Download — {title}</h3>
              <button onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </div>

            {err && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</p>}

            {!list.length ? (
              <p className="py-6 text-center text-sm text-slate-500">No questions to export.</p>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">PDF layout</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-semibold">Page break — questions per page</span>
                      <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="input !py-1 !text-sm">
                        <option value={0}>Auto — fit by text length (recommended)</option>
                        <option value={1}>1 per page</option>
                        <option value={5}>5 per page</option>
                        <option value={10}>10 per page</option>
                        <option value={15}>15 per page</option>
                        <option value={20}>20 per page</option>
                      </select>
                      <span className="mt-1 block text-xs text-slate-400">
                        {Number(perPage) > 0
                          ? `≈ ${estPages} page(s)`
                          : (estPages ? `${estPages} page(s) — packed by text length` : "Measuring text length…")}
                      </span>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-semibold">Border</span>
                      <select value={border} onChange={(e) => setBorder(e.target.value)} className="input !py-1 !text-sm">
                        <option value="single">Single (thin)</option>
                        <option value="thick">Thick</option>
                        <option value="double">Double line</option>
                        <option value="none">No border</option>
                      </select>
                      <span className="mt-1 block text-xs text-slate-400">Frame around each page</span>
                    </label>
                    <div className="text-sm">
                      <span className="mb-1 block font-semibold">Text size</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => bumpText(-0.1)} disabled={textScale <= 0.1} title="Smaller text" className="btn-outline !px-3 !py-1 !text-sm font-bold disabled:opacity-40">A−</button>
                        <span className="min-w-[3.25rem] text-center text-sm font-semibold tabular-nums">{Math.round(textScale * 100)}%</span>
                        <button type="button" onClick={() => bumpText(0.1)} disabled={textScale >= 1.6} title="Larger text" className="btn-outline !px-3 !py-1 !text-sm font-bold disabled:opacity-40">A+</button>
                        {textScale !== 1 && <button type="button" onClick={() => setTextScale(1)} className="ml-1 text-xs font-semibold text-brand-600 hover:underline">Reset</button>}
                      </div>
                      <span className="mt-1 block text-xs text-slate-400">Manually enlarge or shrink all text</span>
                    </div>
                  </div>
                </div>
                {/* Preview: what does the PDF look like? */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Preview</p>
                  <div className="flex items-center gap-2">
                    {!paperOnly && (
                      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold dark:border-slate-600">
                        <button type="button" onClick={() => setPreviewMode("paper")} className={`px-3 py-1 ${mode === "paper" ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Question paper</button>
                        <button type="button" onClick={() => setPreviewMode("key")} className={`px-3 py-1 ${mode === "key" ? "bg-brand-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>Answer key</button>
                      </div>
                    )}
                    <button type="button" onClick={() => setPreviewFull(true)} className="btn-outline !py-1 !text-xs" title="View full screen"><Maximize2 className="h-3.5 w-3.5" /> Full screen</button>
                  </div>
                </div>
                <div className="mb-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <iframe title="PDF preview" srcDoc={previewHtml} className="h-[56vh] w-full bg-white" />
                </div>
                <p className="mb-3 text-[11px] text-slate-400">
                  This is how the PDF will look ({estPages ? `${estPages} page(s)` : "measuring…"}{Number(perPage) > 0 ? "" : ", packed by text length"}, {border === "none" ? "no border" : `${border} border`}). Watermark “{wmLabel}” is on every page.
                  {paperOnly && " The answer key is available after the test is submitted."}
                </p>

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="btn-outline">Close</button>
                  <button type="button" onClick={save} disabled={saving} className="btn-primary">
                    {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Download className="h-4 w-4" /> Download PDF</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
