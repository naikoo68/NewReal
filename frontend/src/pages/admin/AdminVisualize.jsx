// Visualization Studio — the UI for the Universal Visualization Engine (Phase 1).
// Browse the diagram catalogue, generate a chart from a natural-language prompt
// (AI → JSON spec), tweak the JSON, preview live, and export. Fully additive:
// a new admin page that reuses the existing AI backend + Chart.js. Diagram types
// not yet implemented are still listed (roadmap) and render a friendly notice.
import { useMemo, useRef, useState } from "react";
import {
  Sparkles, Wand2, Loader2, Download, Image as ImageIcon, FileJson, Table as TableIcon,
  Printer, Undo2, Redo2, Maximize2, Minimize2, Search, LayoutGrid, X,
} from "lucide-react";
import { aiService } from "../../services";
import VizRenderer from "../../viz/VizRenderer";
import { CATEGORIES, CATALOG, getModule, isImplemented, slug } from "../../viz/registry";
import { exportPNG, exportJSON, exportCSV, printChart, exportSVG, exportPNGFromSVG, printNode, exportPlotly, printPlotly, exportCytoscape, printCytoscape } from "../../viz/exporters";

export default function AdminVisualize() {
  const [category, setCategory] = useState("charts");
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Current spec + its JSON text (editor), plus an undo/redo history stack.
  const [spec, setSpec] = useState(getModule("bar").sample);
  const [specText, setSpecText] = useState(JSON.stringify(getModule("bar").sample, null, 2));
  const [history, setHistory] = useState([getModule("bar").sample]);
  const [hi, setHi] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const chartRef = useRef(null);

  // Adopt a new spec: update preview + editor + push onto history.
  const adopt = (next) => {
    setSpec(next);
    setSpecText(JSON.stringify(next, null, 2));
    setHistory((h) => {
      const trimmed = h.slice(0, hi + 1);
      trimmed.push(next);
      setHi(trimmed.length - 1);
      return trimmed;
    });
  };

  const undo = () => { if (hi > 0) { const i = hi - 1; setHi(i); setSpec(history[i]); setSpecText(JSON.stringify(history[i], null, 2)); } };
  const redo = () => { if (hi < history.length - 1) { const i = hi + 1; setHi(i); setSpec(history[i]); setSpecText(JSON.stringify(history[i], null, 2)); } };

  // Pick a diagram type from the catalogue browser.
  const pickType = (name) => {
    setMsg("");
    const mod = getModule(name);
    if (mod?.sample) { adopt(mod.sample); return; }
    setMsg(`“${name}” is on the roadmap — it renders once its plugin module ships. For now, try the AI prompt or an implemented chart type (they're marked “Ready”).`);
  };

  // Generate a spec from the AI prompt.
  const generate = async () => {
    if (!prompt.trim()) { setMsg("Type what you want, e.g. “GDP pie chart” or “sales line chart for Jan–Jun”."); return; }
    setBusy(true);
    setMsg("Generating…");
    try {
      const res = await aiService.visualize(prompt.trim());
      if (!res?.spec) throw new Error("No visualization returned.");
      adopt(res.spec);
      setMsg(isImplemented(res.spec.type) ? `✓ Generated a ${res.spec.type} with ${res.model || "AI"}.` : `✓ Generated (type “${res.spec.type}” isn't in this build yet — showing the JSON).`);
    } catch (e) {
      setMsg(e.message || "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  // Apply hand-edited JSON to the preview.
  const applyJSON = () => {
    try {
      const parsed = JSON.parse(specText);
      if (!parsed || !parsed.type) throw new Error("JSON must include a \"type\".");
      adopt(parsed);
      setMsg("✓ Applied your JSON.");
    } catch (e) {
      setMsg(`Invalid JSON: ${e.message}`);
    }
  };

  const doExport = (kind) => {
    const cur = chartRef.current;
    const isSvg = cur?.engine === "svg"; // Mermaid / SVG engines expose this
    const isPlotly = cur?.engine === "plotly";
    try {
      if (kind === "json") return exportJSON(spec);
      if (kind === "csv") return exportCSV(spec);
      if (isPlotly) {
        if (kind === "png") return exportPlotly(cur, "png", spec?.title);
        if (kind === "svg") return exportPlotly(cur, "svg", spec?.title);
        if (kind === "print") return printPlotly(cur, spec?.title).catch((e) => setMsg(e.message));
        return;
      }
      if (cur?.engine === "cytoscape") {
        if (kind === "png") return exportCytoscape(cur, spec?.title);
        if (kind === "svg") return setMsg("SVG export isn't available for graphs — use PNG.");
        if (kind === "print") return printCytoscape(cur, spec?.title);
        return;
      }
      if (cur?.engine === "leaflet") {
        // Live map tiles are cross-origin, so canvas image export is unreliable.
        return setMsg("Live maps export as JSON (use the JSON button) — or take a screenshot for an image.");
      }
      if (kind === "png") {
        if (isSvg) return exportPNGFromSVG(cur.node, spec?.title).catch((e) => setMsg(e.message));
        return exportPNG(cur, spec?.title);
      }
      if (kind === "svg") {
        if (isSvg) return exportSVG(cur.node, spec?.title);
        return setMsg("SVG export is available for diagram types (e.g. flowcharts). For data charts, use PNG.");
      }
      if (kind === "print") return isSvg ? printNode(cur.node, spec?.title) : printChart(cur, spec?.title);
    } catch (e) {
      setMsg(e.message || "Export failed.");
    }
  };

  // Catalogue list for the selected category, filtered by search.
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? CATEGORIES.flatMap((c) => (CATALOG[c.id] || []).map((n) => ({ name: n, cat: c.id }))).filter((x) => x.name.toLowerCase().includes(q))
      : (CATALOG[category] || []).map((n) => ({ name: n, cat: category }));
    return list;
  }, [category, search]);

  const Preview = (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold">{spec?.title || "Untitled visualization"}</h3>
          {spec?.description && <p className="truncate text-sm text-slate-500 dark:text-slate-400">{spec.description}</p>}
        </div>
        <button onClick={() => setFullscreen((f) => !f)} title="Fullscreen" className="flex-shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      <div className={`flex-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 ${fullscreen ? "" : "min-h-[360px]"}`}>
        <VizRenderer ref={chartRef} spec={spec} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <LayoutGrid className="h-6 w-6 text-brand-600" /> Visualization Studio
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Generate charts &amp; diagrams from a prompt or structured data, edit the JSON, preview live, and export. More diagram families roll out as plugin modules.
        </p>
      </div>

      {/* AI prompt bar */}
      <div className="card p-4">
        <label className="mb-1 block text-sm font-semibold">Describe your visualization</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input flex-1"
            placeholder='e.g. "GDP pie chart for India", "sales line chart Jan–Jun", "supply and demand curve"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
          />
          <button onClick={generate} disabled={busy} className="btn-primary sm:w-40">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 className="h-4 w-4" /> Generate</>}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">{msg}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* Catalogue browser */}
        <div className="card flex max-h-[560px] flex-col p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8 text-sm" placeholder="Search all diagram types…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!search && (
            <div className="mb-2 flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${category === c.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {items.map((it) => {
              const ready = isImplemented(it.name);
              return (
                <button key={`${it.cat}-${it.name}`} onClick={() => pickType(it.name)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${slug(spec?.type) === slug(it.name) ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                  <span className="truncate">{it.name}</span>
                  {ready
                    ? <span className="flex-shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Ready</span>
                    : <span className="flex-shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 dark:bg-slate-800">Soon</span>}
                </button>
              );
            })}
            {items.length === 0 && <p className="px-2 py-3 text-sm text-slate-400">No matches.</p>}
          </div>
        </div>

        {/* Preview + toolbar + JSON editor */}
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <button onClick={undo} disabled={hi <= 0} className="btn-outline py-1.5 text-xs disabled:opacity-40"><Undo2 className="h-4 w-4" /> Undo</button>
            <button onClick={redo} disabled={hi >= history.length - 1} className="btn-outline py-1.5 text-xs disabled:opacity-40"><Redo2 className="h-4 w-4" /> Redo</button>
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
            <button onClick={() => doExport("png")} className="btn-outline py-1.5 text-xs"><ImageIcon className="h-4 w-4" /> PNG</button>
            <button onClick={() => doExport("svg")} className="btn-outline py-1.5 text-xs"><ImageIcon className="h-4 w-4" /> SVG</button>
            <button onClick={() => doExport("json")} className="btn-outline py-1.5 text-xs"><FileJson className="h-4 w-4" /> JSON</button>
            <button onClick={() => doExport("csv")} className="btn-outline py-1.5 text-xs"><TableIcon className="h-4 w-4" /> CSV</button>
            <button onClick={() => doExport("print")} className="btn-outline py-1.5 text-xs"><Printer className="h-4 w-4" /> Print</button>
          </div>

          {!fullscreen && <div className="card p-4">{Preview}</div>}

          {/* JSON editor */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-600" /> Spec JSON <span className="font-normal text-slate-400">(edit &amp; apply)</span></label>
              <button onClick={applyJSON} className="btn-primary py-1.5 text-xs"><Download className="h-4 w-4 rotate-180" /> Apply</button>
            </div>
            <textarea
              className="input min-h-[220px] w-full font-mono text-xs"
              spellCheck={false}
              value={specText}
              onChange={(e) => setSpecText(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Fullscreen preview overlay */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-slate-950">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-bold">{spec?.title || "Visualization"}</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => doExport("png")} className="btn-outline py-1.5 text-xs"><ImageIcon className="h-4 w-4" /> PNG</button>
              <button onClick={() => setFullscreen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <VizRenderer ref={chartRef} spec={spec} />
          </div>
        </div>
      )}
    </div>
  );
}
