// Business / strategy framework templates — rendered as pure SVG from
// structured data (no external library). Covers SWOT, PESTLE, BCG Matrix,
// Porter's Five Forces, Business Model Canvas and Cycle diagrams. A spec carries
// `spec.framework = { kind, cols?, rows?, cells: [{ title, items[] }] }`. The
// renderer exposes an SVG-shaped handle so the existing SVG exporters work.
import { forwardRef, useImperativeHandle, useRef } from "react";

const PALETTE = ["#10b981", "#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];
const W = 840, H = 560, PAD = 16, GAP = 12;

// Wrap a list of bullet items into short SVG text lines (SVG has no auto-wrap).
function itemLines(items, maxChars) {
  const out = [];
  (items || []).forEach((it) => {
    const words = String(it).split(/\s+/);
    let line = "• ";
    words.forEach((w) => {
      if ((line + w).length > maxChars && line.trim() !== "•") { out.push(line); line = "   " + w + " "; }
      else line += w + " ";
    });
    out.push(line.replace(/\s+$/, ""));
  });
  return out;
}

// A titled coloured cell with a bulleted list.
function Cell({ x, y, w, h, title, items, color }) {
  const lines = itemLines(items, Math.max(12, Math.floor(w / 7.5)));
  const max = Math.max(0, Math.floor((h - 42) / 17));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill={`${color}18`} stroke={color} strokeWidth="1.5" />
      <rect x={x} y={y} width={w} height="30" rx="12" fill={color} />
      <rect x={x} y={y + 18} width={w} height="12" fill={color} />
      <text x={x + 12} y={y + 20} fontSize="14" fontWeight="700" fill="#ffffff">{title}</text>
      {lines.slice(0, max).map((ln, j) => (
        <text key={j} x={x + 12} y={y + 50 + j * 17} fontSize="12" fill="currentColor">{ln}</text>
      ))}
    </g>
  );
}

function GridLayout({ cells, cols, rows }) {
  const cw = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const ch = (H - PAD * 2 - GAP * (rows - 1)) / rows;
  return (cells || []).slice(0, cols * rows).map((c, i) => (
    <Cell key={i} x={PAD + (i % cols) * (cw + GAP)} y={PAD + Math.floor(i / cols) * (ch + GAP)} w={cw} h={ch} title={c.title} items={c.items} color={c.color || PALETTE[i % PALETTE.length]} />
  ));
}

function BcgLayout({ cells }) {
  // 2×2 with axis labels: x = market share, y = growth rate.
  const cw = (W - PAD * 2 - GAP - 40) / 2, ch = (H - PAD * 2 - GAP - 30) / 2, ox = PAD + 40, oy = PAD;
  const titles = ["Stars", "Question Marks", "Cash Cows", "Dogs"];
  const items = cells && cells.length ? cells : titles.map((t) => ({ title: t, items: [] }));
  return (
    <>
      {items.slice(0, 4).map((c, i) => (
        <Cell key={i} x={ox + (i % 2) * (cw + GAP)} y={oy + Math.floor(i / 2) * (ch + GAP)} w={cw} h={ch} title={c.title || titles[i]} items={c.items} color={PALETTE[i % PALETTE.length]} />
      ))}
      <text x={14} y={oy + ch} fontSize="12" fontWeight="700" fill="currentColor" transform={`rotate(-90 14 ${oy + ch})`}>Market Growth →</text>
      <text x={ox + cw} y={H - 2} fontSize="12" fontWeight="700" fill="currentColor" textAnchor="middle">← Market Share</text>
    </>
  );
}

function ForcesLayout({ cells }) {
  // Center = competitive rivalry; four boxes around it.
  const bw = 220, bh = 92, cx = W / 2, cy = H / 2;
  const list = cells && cells.length >= 5 ? cells : [
    { title: "Competitive Rivalry", items: [] }, { title: "Threat of New Entrants", items: [] },
    { title: "Bargaining Power of Suppliers", items: [] }, { title: "Bargaining Power of Buyers", items: [] },
    { title: "Threat of Substitutes", items: [] },
  ];
  const pos = [
    { x: cx - bw / 2, y: cy - bh / 2, color: "#7c3aed" },       // center
    { x: cx - bw / 2, y: PAD, color: "#3b82f6" },                // top
    { x: PAD, y: cy - bh / 2, color: "#10b981" },                // left
    { x: W - PAD - bw, y: cy - bh / 2, color: "#f59e0b" },       // right
    { x: cx - bw / 2, y: H - PAD - bh, color: "#ef4444" },       // bottom
  ];
  return (
    <>
      {pos.slice(1).map((p, i) => (
        <line key={"l" + i} x1={cx} y1={cy} x2={p.x + bw / 2} y2={p.y + bh / 2} stroke="#94a3b8" strokeWidth="1.5" />
      ))}
      {list.slice(0, 5).map((c, i) => (
        <Cell key={i} x={pos[i].x} y={pos[i].y} w={bw} h={bh} title={c.title} items={c.items} color={pos[i].color} />
      ))}
    </>
  );
}

function CycleLayout({ cells }) {
  const steps = (cells || []).slice(0, 8);
  const n = steps.length || 1;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 90, bw = 150, bh = 60;
  return (
    <>
      {steps.map((_, i) => {
        const a1 = (i / n) * 2 * Math.PI - Math.PI / 2;
        const a2 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
        return <line key={"a" + i} x1={cx + Math.cos(a1) * R} y1={cy + Math.sin(a1) * R} x2={cx + Math.cos(a2) * R} y2={cy + Math.sin(a2) * R} stroke="#94a3b8" strokeWidth="2" markerEnd="url(#fw-arrow)" />;
      })}
      {steps.map((c, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        return <Cell key={i} x={cx + Math.cos(a) * R - bw / 2} y={cy + Math.sin(a) * R - bh / 2} w={bw} h={bh} title={c.title} items={c.items} color={PALETTE[i % PALETTE.length]} />;
      })}
    </>
  );
}

const FrameworkRenderer = forwardRef(function FrameworkRenderer({ spec }, ref) {
  const holder = useRef(null);
  useImperativeHandle(ref, () => ({ engine: "svg", get node() { return holder.current; } }), []);

  const fw = spec?.framework || {};
  const kind = fw.kind || "grid";
  const cells = Array.isArray(fw.cells) ? fw.cells : [];

  let body;
  if (kind === "bcg") body = <BcgLayout cells={cells} />;
  else if (kind === "forces") body = <ForcesLayout cells={cells} />;
  else if (kind === "cycle") body = <CycleLayout cells={cells} />;
  else {
    const cols = fw.cols || (kind === "swot" ? 2 : kind === "pestle" ? 3 : kind === "canvas" ? 3 : 2);
    const rows = fw.rows || Math.ceil((cells.length || 4) / cols);
    body = <GridLayout cells={cells} cols={cols} rows={rows} />;
  }

  return (
    <div ref={holder} className="flex h-full w-full items-center justify-center overflow-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full max-w-3xl text-slate-700 dark:text-slate-200" role="img" aria-label={spec?.title || "Framework"}>
        <defs>
          <marker id="fw-arrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
          </marker>
        </defs>
        {body}
      </svg>
    </div>
  );
});

export default FrameworkRenderer;
