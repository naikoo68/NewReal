// Renders a question's diagram/graph (`q.graph`) as an SVG line chart — e.g. an
// economics supply/demand diagram. Fully data-driven: axes (labelled, with
// arrowheads), one or more labelled lines built from [x,y] points, and optional
// annotation points (like an equilibrium) with dashed guide lines to each axis.
// Returns null when there's no usable graph, so it's safe to drop in anywhere.
const PALETTE = ["#2563eb", "#f97316", "#059669", "#db2777", "#7c3aed"];

export default function GraphView({ q }) {
  const g = q?.graph;
  const lines = Array.isArray(g?.lines)
    ? g.lines.filter((l) => Array.isArray(l?.points) && l.points.length >= 2)
    : [];
  if (!g || !lines.length) return null;

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const points = Array.isArray(g.points)
    ? g.points.filter((p) => num(p?.x) != null && num(p?.y) != null)
    : [];

  // Economics diagrams start at the origin; compute the axis maxima from the
  // data unless the AI supplied explicit maxima.
  const allX = [0, ...lines.flatMap((l) => l.points.map((p) => num(p[0]) ?? 0)), ...points.map((p) => num(p.x))];
  const allY = [0, ...lines.flatMap((l) => l.points.map((p) => num(p[1]) ?? 0)), ...points.map((p) => num(p.y))];
  const xMax = num(g.xMax) && g.xMax > 0 ? g.xMax : Math.max(1, ...allX);
  const yMax = num(g.yMax) && g.yMax > 0 ? g.yMax : Math.max(1, ...allY);

  const W = 380, H = 280, padL = 46, padB = 40, padT = 18, padR = 18;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = (x) => padL + ((num(x) ?? 0) / xMax) * plotW;
  const sy = (y) => padT + plotH - ((num(y) ?? 0) / yMax) * plotH;
  const x0 = sx(0), y0 = sy(0);

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
      {g.title && (
        <p className="mb-1 text-center text-sm font-semibold text-slate-700 dark:text-slate-200">{g.title}</p>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block w-full max-w-md text-slate-500 dark:text-slate-400"
        role="img"
        aria-label={g.title || "Question diagram"}
      >
        <defs>
          <marker id="qg-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>

        {/* Axes (X to the right, Y upward) with arrowheads */}
        <line x1={x0} y1={y0} x2={W - padR + 4} y2={y0} stroke="currentColor" strokeWidth="1.5" markerEnd="url(#qg-arrow)" />
        <line x1={x0} y1={y0} x2={x0} y2={padT - 4} stroke="currentColor" strokeWidth="1.5" markerEnd="url(#qg-arrow)" />

        {/* Axis labels */}
        {g.xLabel && (
          <text x={x0 + plotW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="currentColor">{g.xLabel}</text>
        )}
        {g.yLabel && (
          <text x={14} y={padT + plotH / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 14 ${padT + plotH / 2})`}>{g.yLabel}</text>
        )}

        {/* Lines / curves */}
        {lines.map((l, i) => {
          const color = l.color || PALETTE[i % PALETTE.length];
          const pts = l.points.map((p) => `${sx(p[0])},${sy(p[1])}`).join(" ");
          const last = l.points[l.points.length - 1];
          const lx = sx(last[0]);
          return (
            <g key={i}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
              {l.label && (
                <text x={Math.max(padL, Math.min(lx + 4, W - 2))} y={Math.max(padT + 8, sy(last[1]) - 4)} fontSize="11" fontWeight="600" fill={color} textAnchor={lx > W - 70 ? "end" : "start"}>{l.label}</text>
              )}
            </g>
          );
        })}

        {/* Annotation points (e.g. equilibrium) with dashed guides to the axes */}
        {points.map((p, i) => {
          const cx = sx(p.x), cy = sy(p.y);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x0} y2={cy} stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
              <line x1={cx} y1={cy} x2={cx} y2={y0} stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
              <circle cx={cx} cy={cy} r="3.5" fill="#e11d48" />
              {p.label && (
                <text x={cx + 6} y={cy - 6} fontSize="11" fontWeight="600" fill="#e11d48" textAnchor={cx > W - 70 ? "end" : "start"}>{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
