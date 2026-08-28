// Plotly engine for the Visualization Engine — renders advanced scientific /
// statistical charts (heatmap, box, violin, sankey, treemap, sunburst,
// candlestick, OHLC, gauge, funnel, waterfall, 3D surface, contour, splom).
// Plotly is loaded LAZILY from a CDN (ESM) at runtime — it's never bundled and
// never touches package.json/the lockfile, so it can't break `npm ci`. A Plotly
// spec carries a ready figure in `spec.plotly = { data, layout }`.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "../context/ThemeContext";

const PLOTLY_CDN = "https://esm.sh/plotly.js-dist-min@2";

const PlotlyRenderer = forwardRef(function PlotlyRenderer({ spec }, ref) {
  const holder = useRef(null);
  const lib = useRef(null); // the loaded Plotly library
  const [error, setError] = useState("");
  const { theme } = useTheme();

  // Read node/lib lazily (getters) — Plotly loads async, so capture at call time.
  useImperativeHandle(ref, () => ({
    engine: "plotly",
    get node() { return holder.current; },
    get lib() { return lib.current; },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const fig = spec?.plotly;
    if (!fig || !Array.isArray(fig.data)) {
      setError("");
      return;
    }
    (async () => {
      try {
        const Plotly = (await import(/* @vite-ignore */ PLOTLY_CDN)).default;
        lib.current = Plotly;
        if (cancelled || !holder.current) return;
        const dark = theme === "dark";
        const layout = {
          autosize: true,
          margin: { t: 36, r: 16, b: 44, l: 52 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { color: dark ? "#cbd5e1" : "#334155" },
          ...(fig.layout || {}),
        };
        await Plotly.newPlot(holder.current, fig.data, layout, { responsive: true, displayModeBar: false });
        if (!cancelled) setError("");
      } catch (e) {
        if (!cancelled) setError(e?.message || "Couldn't render this chart — check the Plotly data.");
      }
    })();
    return () => {
      cancelled = true;
      try { lib.current?.purge?.(holder.current); } catch { /* ignore */ }
    };
  }, [spec?.plotly, theme]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={holder} className="h-full min-h-[320px] w-full" />
      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
});

export default PlotlyRenderer;
