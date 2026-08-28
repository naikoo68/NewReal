// Science / math illustration engine — pure SVG driven by structured data
// (no external library), so the AI can produce these from a prompt and they use
// the existing SVG exporters. A spec carries `spec.science = { kind, ... }`:
//   bohr       { symbol, protons, neutrons, shells:[2,8,1] }
//   freebody   { label, forces:[{ label, angle(deg, 0=right/90=up), magnitude }] }
//   energy     { levels:[{ label, energy }], transitions:[{ from, to, label }] }
//   numberline { min, max, step, points:[{ x, label }], intervals:[{ from,to,closedLeft,closedRight }] }
//   coordinate { min, max, points:[{ x, y, label }], lines:[{ label, points:[{x,y}] }] }
import { forwardRef, useImperativeHandle, useRef } from "react";

const W = 760, H = 520;
const PALETTE = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- Bohr / atomic model ---------------------------------------------------
function Bohr({ s }) {
  const cx = W / 2, cy = H / 2;
  const shells = (Array.isArray(s.shells) && s.shells.length ? s.shells : [2, 8, 1]).map((n) => Math.max(0, Math.round(num(n))));
  const nucleusR = 34;
  const gap = Math.min(66, (Math.min(W, H) / 2 - nucleusR - 40) / shells.length);
  const protons = num(s.protons, shells.reduce((a, b) => a + b, 0));
  const neutrons = num(s.neutrons, protons);
  return (
    <g>
      {shells.map((count, si) => {
        const r = nucleusR + (si + 1) * gap;
        return (
          <g key={si}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="2 4" />
            {Array.from({ length: count }).map((_, e) => {
              const a = (e / count) * 2 * Math.PI - Math.PI / 2;
              return <circle key={e} cx={cx + r * Math.cos(a)} cy={cy + r * Math.sin(a)} r="6.5" fill={PALETTE[si % PALETTE.length]} stroke="#fff" strokeWidth="1.5" />;
            })}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={nucleusR} fill="#1e293b" />
      {s.symbol && <text x={cx} y={cy - 4} fontSize="18" fontWeight="800" fill="#fff" textAnchor="middle">{s.symbol}</text>}
      <text x={cx} y={cy + (s.symbol ? 15 : 5)} fontSize="11" fill="#e2e8f0" textAnchor="middle">{protons}p · {neutrons}n</text>
    </g>
  );
}

// ---- Free-body diagram -----------------------------------------------------
function FreeBody({ s }) {
  const cx = W / 2, cy = H / 2;
  const forces = (Array.isArray(s.forces) && s.forces.length ? s.forces : [
    { label: "Weight", angle: 270, magnitude: 60 }, { label: "Normal", angle: 90, magnitude: 60 },
    { label: "Applied", angle: 0, magnitude: 50 }, { label: "Friction", angle: 180, magnitude: 25 },
  ]);
  const maxMag = Math.max(...forces.map((f) => Math.abs(num(f.magnitude, 1))), 1);
  return (
    <g>
      <rect x={cx - 42} y={cy - 42} width="84" height="84" rx="8" fill="#1e293b" />
      {s.label && <text x={cx} y={cy + 5} fontSize="13" fontWeight="700" fill="#fff" textAnchor="middle">{s.label}</text>}
      {forces.map((f, i) => {
        const rad = (num(f.angle) * Math.PI) / 180;
        const len = 44 + (Math.abs(num(f.magnitude, 1)) / maxMag) * 150;
        const ex = cx + len * Math.cos(rad), ey = cy - len * Math.sin(rad);
        const color = PALETTE[i % PALETTE.length];
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={color} strokeWidth="3" markerEnd="url(#sci-arrow)" />
            <text x={ex + 10 * Math.cos(rad)} y={ey - 12 * Math.sin(rad)} fontSize="12" fontWeight="600" fill={color} textAnchor="middle" dominantBaseline="middle">
              {f.label}{Number.isFinite(Number(f.magnitude)) ? ` (${f.magnitude})` : ""}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Energy level diagram --------------------------------------------------
function Energy({ s }) {
  const levels = (Array.isArray(s.levels) && s.levels.length ? s.levels : [
    { label: "n=1", energy: -13.6 }, { label: "n=2", energy: -3.4 }, { label: "n=3", energy: -1.51 }, { label: "n=4", energy: -0.85 },
  ]).map((l) => ({ label: l.label, energy: num(l.energy) }));
  const es = levels.map((l) => l.energy);
  const emin = Math.min(...es), emax = Math.max(...es), span = emax - emin || 1;
  const top = 50, bottom = H - 50, plotH = bottom - top, left = 150, right = W - 60;
  const yFor = (e) => bottom - ((e - emin) / span) * plotH;
  return (
    <g>
      {levels.map((l, i) => {
        const y = yFor(l.energy);
        return (
          <g key={i}>
            <line x1={left} y1={y} x2={right} y2={y} stroke={PALETTE[i % PALETTE.length]} strokeWidth="3" />
            <text x={left - 10} y={y + 4} fontSize="12" fontWeight="600" fill="currentColor" textAnchor="end">{l.label}</text>
            <text x={right + 6} y={y + 4} fontSize="11" fill="#64748b">{l.energy} eV</text>
          </g>
        );
      })}
      {(s.transitions || []).map((t, i) => {
        const a = levels[num(t.from)], b = levels[num(t.to)];
        if (!a || !b) return null;
        const x = left + 60 + i * 46;
        return <line key={i} x1={x} y1={yFor(a.energy)} x2={x} y2={yFor(b.energy)} stroke="#334155" strokeWidth="1.8" markerEnd="url(#sci-arrow)" />;
      })}
      <text x={left - 10} y={top - 20} fontSize="12" fontWeight="700" fill="currentColor" textAnchor="end">Energy</text>
    </g>
  );
}

// ---- Number line -----------------------------------------------------------
function NumberLine({ s }) {
  const min = num(s.min, -5), max = num(s.max, 5), step = num(s.step, 1) || 1;
  const left = 50, right = W - 50, y = H / 2, span = max - min || 1;
  const xFor = (x) => left + ((x - min) / span) * (right - left);
  const ticks = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return (
    <g>
      {(s.intervals || []).map((iv, i) => (
        <rect key={i} x={xFor(num(iv.from))} y={y - 8} width={Math.max(0, xFor(num(iv.to)) - xFor(num(iv.from)))} height="16" fill={`${PALETTE[i % PALETTE.length]}44`} />
      ))}
      <line x1={left - 10} y1={y} x2={right + 10} y2={y} stroke="currentColor" strokeWidth="2" markerStart="url(#sci-arrow)" markerEnd="url(#sci-arrow)" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={xFor(t)} y1={y - 6} x2={xFor(t)} y2={y + 6} stroke="currentColor" strokeWidth="1.5" />
          <text x={xFor(t)} y={y + 24} fontSize="11" fill="currentColor" textAnchor="middle">{t}</text>
        </g>
      ))}
      {(s.points || []).map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={xFor(num(p.x))} cy={y} r="7" fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth="1.5" />
          {p.label && <text x={xFor(num(p.x))} y={y - 16} fontSize="12" fontWeight="700" fill={PALETTE[i % PALETTE.length]} textAnchor="middle">{p.label}</text>}
        </g>
      ))}
    </g>
  );
}

// ---- Coordinate plane ------------------------------------------------------
function Coordinate({ s }) {
  const min = num(s.min, -10), max = num(s.max, 10), span = max - min || 1;
  const pad = 40, size = Math.min(W, H) - pad * 2, ox = (W - size) / 2, oy = (H - size) / 2;
  const px = (x) => ox + ((x - min) / span) * size;
  const py = (y) => oy + size - ((y - min) / span) * size;
  const stepGuess = span <= 12 ? 1 : span <= 30 ? 5 : 10;
  const ticks = [];
  for (let t = Math.ceil(min); t <= max; t += stepGuess) ticks.push(t);
  return (
    <g>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={px(t)} y1={oy} x2={px(t)} y2={oy + size} stroke="#e2e8f0" strokeWidth="1" />
          <line x1={ox} y1={py(t)} x2={ox + size} y2={py(t)} stroke="#e2e8f0" strokeWidth="1" />
        </g>
      ))}
      <line x1={ox} y1={py(0)} x2={ox + size} y2={py(0)} stroke="currentColor" strokeWidth="1.8" markerEnd="url(#sci-arrow)" />
      <line x1={px(0)} y1={oy + size} x2={px(0)} y2={oy} stroke="currentColor" strokeWidth="1.8" markerEnd="url(#sci-arrow)" />
      {ticks.filter((t) => t !== 0).map((t, i) => (
        <g key={`l${i}`}>
          <text x={px(t)} y={py(0) + 15} fontSize="10" fill="#64748b" textAnchor="middle">{t}</text>
          <text x={px(0) - 8} y={py(t) + 4} fontSize="10" fill="#64748b" textAnchor="end">{t}</text>
        </g>
      ))}
      {(s.lines || []).map((ln, i) => {
        const pts = (ln.points || []).map((p) => `${px(num(p.x))},${py(num(p.y))}`).join(" ");
        return <polyline key={`ln${i}`} points={pts} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="2.5" />;
      })}
      {(s.points || []).map((p, i) => (
        <g key={`pt${i}`}>
          <circle cx={px(num(p.x))} cy={py(num(p.y))} r="5.5" fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth="1.5" />
          {p.label && <text x={px(num(p.x)) + 8} y={py(num(p.y)) - 8} fontSize="11" fontWeight="600" fill={PALETTE[i % PALETTE.length]}>{p.label}</text>}
        </g>
      ))}
    </g>
  );
}

const KINDS = { bohr: Bohr, freebody: FreeBody, energy: Energy, numberline: NumberLine, coordinate: Coordinate };

const SciRenderer = forwardRef(function SciRenderer({ spec }, ref) {
  const holder = useRef(null);
  useImperativeHandle(ref, () => ({ engine: "svg", get node() { return holder.current; } }), []);

  const sci = spec?.science || {};
  const Body = KINDS[sci.kind] || Bohr;

  return (
    <div ref={holder} className="flex h-full w-full items-center justify-center overflow-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full max-w-3xl text-slate-700 dark:text-slate-200" role="img" aria-label={spec?.title || "Science diagram"}>
        <defs>
          <marker id="sci-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>
        {spec?.title && <text x={W / 2} y="26" fontSize="15" fontWeight="700" fill="currentColor" textAnchor="middle">{spec.title}</text>}
        <Body s={sci} />
      </svg>
    </div>
  );
});

export default SciRenderer;
