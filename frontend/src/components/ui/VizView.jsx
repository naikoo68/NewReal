// Renders a question's diagram (`q.viz`) using the app's Visualization Engine —
// the same JSON-spec renderer as the Visualization Studio (Chart.js / Mermaid /
// Plotly / graphs / SVG families). Used by "diagram" questions, whose stem asks
// about the figure drawn here. Returns null when there's no usable spec, so it's
// safe to drop in beside GraphView anywhere a question is shown.
import { Suspense, lazy } from "react";

// VizRenderer pulls in Chart.js eagerly and lazy-loads heavier engines; lazy-
// load the whole renderer so a question list without diagrams stays light.
const VizRenderer = lazy(() => import("../../viz/VizRenderer"));

// A spec is renderable when it's an object carrying a type + some payload.
function hasSpec(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (!String(v.type || "").trim() && !v.code) return false;
  return (
    (Array.isArray(v.series) && v.series.length > 0) ||
    (Array.isArray(v.labels) && v.labels.length > 0) ||
    (typeof v.code === "string" && v.code.trim() !== "") ||
    !!v.plotly || !!v.graph || !!v.network || !!v.framework ||
    !!v.map || !!v.science || !!v.illustration || !!v.chem
  );
}

// Chart.js / Plotly need a bounded (fixed-height) parent to size their canvas.
// Mermaid flowcharts, graphs and other SVG diagrams have their own intrinsic
// height and must NOT be squeezed into a short box (that clips tall diagrams),
// so they get an auto height that grows and scrolls up to a sensible cap.
function needsFixedHeight(v) {
  return !v.code && !v.graph && !v.network && !v.framework && !v.map && !v.science && !v.illustration && !v.chem;
}

export default function VizView({ q }) {
  const spec = q?.viz;
  if (!hasSpec(spec)) return null;
  const fixed = needsFixedHeight(spec);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
      {spec.title && (
        <p className="mb-1 text-center text-sm font-semibold text-slate-700 dark:text-slate-200">{spec.title}</p>
      )}
      {/* Charts keep a fixed height (Chart.js needs a bounded parent). SVG
          diagrams (Mermaid/graph) are CONTAINED within a sensible box: they
          scale DOWN to fit the width and a ~420px height while keeping their
          aspect ratio, and are never stretched beyond their natural size (so a
          small diagram isn't blown up into giant boxes). Very large diagrams
          scale down to fit; if still taller than the cap, the box scrolls. */}
      <div
        className={`mx-auto w-full ${
          fixed
            ? "h-[300px] max-w-xl"
            : "min-h-[200px] max-h-[70vh] overflow-auto [&_svg]:!h-auto [&_svg]:!w-auto [&_svg]:!max-h-[420px] [&_svg]:!max-w-full [&_svg]:mx-auto"
        }`}
      >
        <Suspense fallback={<div className="flex h-[220px] items-center justify-center text-sm text-slate-400">Loading diagram…</div>}>
          <VizRenderer spec={spec} />
        </Suspense>
      </div>
    </div>
  );
}
