// Renders a visualization JSON spec with Chart.js (the library already in the
// app). Converts our normalized spec → a Chart.js config. Exposes the underlying
// Chart.js instance via ref so the Studio can export a PNG. Additive: reuses the
// existing chartSetup registration; adds nothing global.
import { forwardRef } from "react";
import "../lib/chartSetup"; // registers scales/elements/plugins (side-effect)
import { Bar, Line, Pie, Doughnut, Scatter, Bubble, Radar, PolarArea } from "react-chartjs-2";
import { getModule, CHARTJS_TYPES } from "./registry";

// A pleasant, high-contrast default palette (works in light & dark).
const PALETTE = ["#2563eb", "#f97316", "#059669", "#db2777", "#7c3aed", "#0891b2", "#eab308", "#ef4444", "#14b8a6", "#8b5cf6"];
const withAlpha = (hex, a) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || "").replace("#", ""));
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
};

const COMPONENTS = { bar: Bar, line: Line, pie: Pie, doughnut: Doughnut, scatter: Scatter, bubble: Bubble, radar: Radar, polarArea: PolarArea };

// Resolve our spec.type → a Chart.js base type ("bar", "line", …).
function chartTypeFor(spec) {
  const mod = getModule(spec?.type);
  if (mod?.chartType) return mod.chartType;
  const t = String(spec?.type || "").toLowerCase();
  if (t === "donut") return "doughnut";
  if (t === "polar") return "polarArea";
  return CHARTJS_TYPES.has(t) ? t : null;
}

// Build a Chart.js { data, options } from the spec.
function buildConfig(spec, chartType) {
  const opts = spec?.options || {};
  const colors = Array.isArray(spec?.colors) && spec.colors.length ? spec.colors : PALETTE;
  const series = Array.isArray(spec?.series) ? spec.series : [];
  const labels = Array.isArray(spec?.labels) ? spec.labels : [];
  const isPieLike = chartType === "pie" || chartType === "doughnut" || chartType === "polarArea";
  const isXY = chartType === "scatter" || chartType === "bubble";

  let data;
  if (isPieLike) {
    // One dataset; each slice its own colour.
    const first = series[0] || { data: [] };
    data = {
      labels,
      datasets: [{
        label: first.name || spec?.title || "",
        data: first.data || [],
        backgroundColor: (labels.length ? labels : (first.data || [])).map((_, i) => colors[i % colors.length]),
        borderColor: "#ffffff",
        borderWidth: chartType === "polarArea" ? 0 : 2,
      }],
    };
  } else if (isXY) {
    data = {
      datasets: series.map((s, i) => ({
        label: s.name || `Series ${i + 1}`,
        data: Array.isArray(s.data) ? s.data : [],
        backgroundColor: withAlpha(s.color || colors[i % colors.length], 0.7),
        borderColor: s.color || colors[i % colors.length],
        // A series can opt into a connecting line (e.g. a regression trend line
        // or a parametric curve) via `line: true`.
        showLine: !!s.line,
        fill: false,
      })),
    };
  } else {
    // bar / line / radar
    data = {
      labels,
      datasets: series.map((s, i) => {
        const c = s.color || colors[i % colors.length];
        const base = { label: s.name || `Series ${i + 1}`, data: Array.isArray(s.data) ? s.data : [] };
        if (chartType === "line") {
          return {
            ...base,
            borderColor: c,
            backgroundColor: opts.area ? withAlpha(c, 0.25) : c,
            fill: !!opts.area,
            tension: opts.smooth ? 0.4 : 0,
            stepped: !!opts.stepped,
            pointRadius: 3,
          };
        }
        if (chartType === "radar") {
          return { ...base, borderColor: c, backgroundColor: withAlpha(c, 0.3), pointBackgroundColor: c };
        }
        // bar
        return { ...base, backgroundColor: withAlpha(c, 0.85), borderColor: c, borderWidth: 1, borderRadius: 4 };
      }),
    };
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: isPieLike || series.length > 1, position: "bottom" },
      title: { display: false },
      tooltip: { enabled: true },
    },
  };
  if (chartType === "bar") options.indexAxis = opts.horizontal ? "y" : "x";
  if (chartType === "bar" || chartType === "line") {
    options.scales = {
      x: { stacked: !!opts.stacked },
      y: { stacked: !!opts.stacked, beginAtZero: opts.beginAtZero !== false },
    };
  }
  return { data, options };
}

// forwardRef → parent gets the Chart.js instance (has toBase64Image(), canvas).
const ChartRenderer = forwardRef(function ChartRenderer({ spec }, ref) {
  const chartType = chartTypeFor(spec);
  const Comp = chartType ? COMPONENTS[chartType] : null;
  if (!Comp) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        This diagram type (“{spec?.type}”) isn't available in this build yet — it's on the roadmap and will render once its plugin module ships.
      </div>
    );
  }
  let config;
  try {
    config = buildConfig(spec, chartType);
  } catch {
    return <div className="p-4 text-sm text-rose-600">Couldn't build this chart from the data. Check the JSON.</div>;
  }
  return (
    <div className="h-full w-full">
      <Comp ref={ref} data={config.data} options={config.options} />
    </div>
  );
});

export default ChartRenderer;
