// Curated science illustration engine — pure SVG driven by structured data.
// These are figures (not charts): the AI emits `spec.illustration = { kind, ... }`
// and they render offline and export through the existing SVG path.
//   wave      { amplitude, wavelength, cycles, showLabels }
//   projectile{ angle, speed }                         (parabolic trajectory + vectors)
//   circuit   { components:[{ type:"battery|resistor|bulb|switch|capacitor", label }] }
//   ray       { focalLength, objectDistance, objectHeight, lens:"convex|concave" }
//   molecule  { atoms:[{ el, x, y }], bonds:[{ a, b, order }] }
//   reaction  { reactants, products, activationEnergy, exothermic }
//   orbital   { subshells:[{ label, electrons, capacity }] }
//   dna       { pairs, sequence:"ATGC..." }
//   cell      { type:"animal|plant" }
//   efield    { charges:[{ x, q }] }
//   bmagnet   {}
import { forwardRef, useImperativeHandle, useRef } from "react";

const W = 760, H = 520;
const P = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const ATOM_COLOR = { H: "#e2e8f0", O: "#ef4444", C: "#334155", N: "#2563eb", S: "#f59e0b", Cl: "#10b981", Na: "#8b5cf6", P: "#f97316" };
const BASE_COLOR = { A: "#2563eb", T: "#ef4444", G: "#10b981", C: "#f59e0b", U: "#ec4899" };

// ---- Wave ------------------------------------------------------------------
function Wave({ s }) {
  const amp = num(s.amplitude, 90), wl = num(s.wavelength, 200), cy = H / 2;
  const cycles = Math.max(0.5, num(s.cycles, 2));
  const left = 70, right = W - 40, width = right - left;
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const x = left + (i / 240) * width;
    const y = cy - amp * Math.sin((i / 240) * cycles * 2 * Math.PI);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <g>
      <line x1={left - 20} y1={cy} x2={right + 10} y2={cy} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
      <polyline points={pts.join(" ")} fill="none" stroke={P[0]} strokeWidth="3" />
      <line x1={left} y1={cy} x2={left} y2={cy - amp} stroke={P[1]} strokeWidth="2" markerEnd="url(#il-arrow)" />
      <text x={left - 8} y={cy - amp / 2} fontSize="12" fill={P[1]} textAnchor="end">A</text>
      <line x1={left} y1={cy + amp + 20} x2={left + wl} y2={cy + amp + 20} stroke={P[2]} strokeWidth="2" markerStart="url(#il-arrow)" markerEnd="url(#il-arrow)" />
      <text x={left + wl / 2} y={cy + amp + 36} fontSize="12" fill={P[2]} textAnchor="middle">λ (wavelength)</text>
    </g>
  );
}

// ---- Projectile motion -----------------------------------------------------
function Projectile({ s }) {
  const angle = Math.min(85, Math.max(5, num(s.angle, 45)));
  const rad = (angle * Math.PI) / 180;
  const ground = H - 70, left = 90, span = W - 180;
  const apexX = left + span / 2, apexY = 90;
  const pts = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = left + t * span;
    const y = ground - 4 * (apexY < ground ? ground - apexY : 200) * t * (1 - t);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const vlen = 70;
  return (
    <g>
      <line x1={40} y1={ground} x2={W - 40} y2={ground} stroke="#334155" strokeWidth="2" />
      <polyline points={pts.join(" ")} fill="none" stroke={P[0]} strokeWidth="2.5" strokeDasharray="6 5" />
      <circle cx={left} cy={ground} r="8" fill={P[1]} />
      <line x1={left} y1={ground} x2={left + vlen * Math.cos(rad)} y2={ground - vlen * Math.sin(rad)} stroke={P[3]} strokeWidth="3" markerEnd="url(#il-arrow)" />
      <text x={left + vlen * Math.cos(rad) + 6} y={ground - vlen * Math.sin(rad) - 6} fontSize="12" fill={P[3]}>v₀ ({angle}°)</text>
      <line x1={left} y1={ground} x2={left + vlen * Math.cos(rad)} y2={ground} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 3" />
      <line x1={left + vlen * Math.cos(rad)} y1={ground} x2={left + vlen * Math.cos(rad)} y2={ground - vlen * Math.sin(rad)} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx={apexX} cy={90} r="4" fill={P[2]} />
      <text x={apexX + 8} y={86} fontSize="11" fill={P[2]}>max height</text>
      <text x={left + span / 2} y={ground + 22} fontSize="11" fill="#64748b" textAnchor="middle">range</text>
    </g>
  );
}

// ---- Circuit ---------------------------------------------------------------
function Zig(x, y, w = 46) {
  const n = 6, seg = w / n, pts = [`${x},${y}`];
  for (let i = 1; i < n; i++) pts.push(`${x + i * seg},${y + (i % 2 ? -8 : 8)}`);
  pts.push(`${x + w},${y}`);
  return pts.join(" ");
}
function Circuit({ s }) {
  const x0 = 120, y0 = 150, x1 = 640, y1 = 370;
  const comps = Array.isArray(s.components) && s.components.length ? s.components : [{ type: "battery" }, { type: "resistor", label: "R" }, { type: "bulb", label: "Lamp" }];
  const battery = comps.find((c) => c.type === "battery") || { type: "battery" };
  const rest = comps.filter((c) => c !== battery);
  const drawTop = rest.map((c, i) => {
    const cx = x0 + ((i + 1) / (rest.length + 1)) * (x1 - x0), cy = y0;
    const color = P[(i + 1) % P.length];
    let sym = null;
    if (c.type === "resistor") sym = <polyline points={Zig(cx - 23, cy)} fill="none" stroke={color} strokeWidth="2.5" />;
    else if (c.type === "bulb") sym = <g stroke={color} strokeWidth="2.5" fill="none"><circle cx={cx} cy={cy} r="14" /><line x1={cx - 10} y1={cy - 10} x2={cx + 10} y2={cy + 10} /><line x1={cx - 10} y1={cy + 10} x2={cx + 10} y2={cy - 10} /></g>;
    else if (c.type === "switch") sym = <g stroke={color} strokeWidth="2.5"><circle cx={cx - 16} cy={cy} r="3" fill={color} /><line x1={cx - 16} y1={cy} x2={cx + 14} y2={cy - 14} /><circle cx={cx + 16} cy={cy} r="3" fill={color} /></g>;
    else if (c.type === "capacitor") sym = <g stroke={color} strokeWidth="2.5"><line x1={cx - 6} y1={cy - 14} x2={cx - 6} y2={cy + 14} /><line x1={cx + 6} y1={cy - 14} x2={cx + 6} y2={cy + 14} /></g>;
    else sym = <g stroke={color} strokeWidth="2.5" fill="none"><rect x={cx - 22} y={cy - 10} width="44" height="20" rx="3" /></g>;
    return (
      <g key={i}>
        <rect x={cx - 26} y={cy - 18} width="52" height="36" fill="var(--il-bg,#fff)" opacity="0" />
        {sym}
        <text x={cx} y={cy - 22} fontSize="11" fontWeight="600" fill={color} textAnchor="middle">{c.label || c.type}</text>
      </g>
    );
  });
  const bcy = (y0 + y1) / 2;
  return (
    <g>
      <path d={`M${x0} ${y0} H${x1} V${y1} H${x0} Z`} fill="none" stroke="#334155" strokeWidth="2.5" />
      {/* battery on left edge */}
      <rect x={x0 - 3} y={bcy - 20} width="6" height="40" fill="var(--il-bg,#fff)" opacity="0" />
      <line x1={x0 - 9} y1={bcy - 14} x2={x0 + 9} y2={bcy - 14} stroke={P[0]} strokeWidth="3" />
      <line x1={x0 - 5} y1={bcy - 4} x2={x0 + 5} y2={bcy - 4} stroke={P[0]} strokeWidth="3" />
      <line x1={x0 - 9} y1={bcy + 6} x2={x0 + 9} y2={bcy + 6} stroke={P[0]} strokeWidth="3" />
      <line x1={x0 - 5} y1={bcy + 16} x2={x0 + 5} y2={bcy + 16} stroke={P[0]} strokeWidth="3" />
      <text x={x0 - 16} y={bcy + 4} fontSize="11" fontWeight="600" fill={P[0]} textAnchor="end">{battery.label || "Battery"}</text>
      {drawTop}
    </g>
  );
}

// ---- Ray diagram (thin lens) -----------------------------------------------
function Ray({ s }) {
  const concave = s.lens === "concave";
  const f = Math.abs(num(s.focalLength, 3)) * (concave ? -1 : 1);
  const doo = Math.abs(num(s.objectDistance, 6)) || 6;
  const h = Math.abs(num(s.objectHeight, 2)) || 2;
  const cx = W / 2, cy = H / 2;
  const di = 1 / (1 / f - (1 / -doo)); // 1/f = 1/di - 1/(-do)  -> convex real when do>f
  const hi = -h * di / doo;
  const scale = Math.min(240 / Math.max(doo, Math.abs(di) || 1, 1), 100 / Math.max(h, Math.abs(hi) || 1, 1));
  const objX = cx - doo * scale, objTipY = cy - h * scale;
  const f2x = cx + f * scale, f1x = cx - f * scale;
  const real = Number.isFinite(di) && di > 0 && di < 300;
  const imgX = cx + di * scale, imgTipY = cy - hi * scale;
  const ext = (x1, y1, x2, y2) => { const t = (cx + 250 - x1) / (x2 - x1 || 1); return `${cx + 250},${(y1 + t * (y2 - y1)).toFixed(1)}`; };
  return (
    <g>
      <line x1={60} y1={cy} x2={W - 60} y2={cy} stroke="#334155" strokeWidth="1.5" />
      <line x1={cx} y1={cy - 130} x2={cx} y2={cy + 130} stroke={P[0]} strokeWidth="2.5" markerStart="url(#il-arrow)" markerEnd="url(#il-arrow)" />
      <text x={cx} y={cy - 138} fontSize="11" fill={P[0]} textAnchor="middle">{concave ? "concave" : "convex"} lens</text>
      {[f2x, f1x].map((fx, i) => (<g key={i}><circle cx={fx} cy={cy} r="3" fill="#64748b" /><text x={fx} y={cy + 16} fontSize="10" fill="#64748b" textAnchor="middle">{i ? "F" : "F'"}</text></g>))}
      {/* object */}
      <line x1={objX} y1={cy} x2={objX} y2={objTipY} stroke={P[2]} strokeWidth="2.5" markerEnd="url(#il-arrow)" />
      <text x={objX} y={cy + 16} fontSize="10" fill={P[2]} textAnchor="middle">object</text>
      {/* ray 1: parallel then through F' */}
      <polyline points={`${objX},${objTipY} ${cx},${objTipY} ${real ? `${imgX},${imgTipY}` : ext(cx, objTipY, f2x, cy)}`} fill="none" stroke={P[1]} strokeWidth="1.6" />
      {/* ray 2: through center */}
      <polyline points={`${objX},${objTipY} ${real ? `${imgX},${imgTipY}` : ext(objX, objTipY, cx, cy)}`} fill="none" stroke={P[3]} strokeWidth="1.6" />
      {real && (<><line x1={imgX} y1={cy} x2={imgX} y2={imgTipY} stroke={P[5]} strokeWidth="2.5" markerEnd="url(#il-arrow)" /><text x={imgX} y={cy - 8} fontSize="10" fill={P[5]} textAnchor="middle">image</text></>)}
      {!real && <text x={cx} y={H - 30} fontSize="11" fill="#64748b" textAnchor="middle">virtual/upright image (rays diverge)</text>}
    </g>
  );
}

// ---- Molecule --------------------------------------------------------------
function Molecule({ s }) {
  const atoms = Array.isArray(s.atoms) && s.atoms.length ? s.atoms : [{ el: "O", x: 0, y: 0 }, { el: "H", x: -1, y: 0.8 }, { el: "H", x: 1, y: 0.8 }];
  const bonds = Array.isArray(s.bonds) ? s.bonds : [{ a: 0, b: 1 }, { a: 0, b: 2 }];
  const xs = atoms.map((a) => num(a.x)), ys = atoms.map((a) => num(a.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sc = Math.min(360 / ((maxX - minX) || 1), 260 / ((maxY - minY) || 1));
  const px = (x) => W / 2 + (x - (minX + maxX) / 2) * sc;
  const py = (y) => H / 2 + (y - (minY + maxY) / 2) * sc;
  return (
    <g>
      {bonds.map((b, i) => {
        const a1 = atoms[num(b.a)], a2 = atoms[num(b.b)];
        if (!a1 || !a2) return null;
        const order = num(b.order, 1), offs = order === 2 ? [-3, 3] : order === 3 ? [-5, 0, 5] : [0];
        const dx = px(num(a2.x)) - px(num(a1.x)), dy = py(num(a2.y)) - py(num(a1.y)), L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        return offs.map((o, j) => <line key={`${i}-${j}`} x1={px(num(a1.x)) + nx * o} y1={py(num(a1.y)) + ny * o} x2={px(num(a2.x)) + nx * o} y2={py(num(a2.y)) + ny * o} stroke="#475569" strokeWidth="2.5" />);
      })}
      {atoms.map((a, i) => (
        <g key={i}>
          <circle cx={px(num(a.x))} cy={py(num(a.y))} r="18" fill={ATOM_COLOR[a.el] || "#94a3b8"} stroke="#1e293b" strokeWidth="1.5" />
          <text x={px(num(a.x))} y={py(num(a.y)) + 5} fontSize="14" fontWeight="800" fill={["H", "Cl"].includes(a.el) ? "#1e293b" : "#fff"} textAnchor="middle">{a.el}</text>
        </g>
      ))}
    </g>
  );
}

// ---- Reaction energy profile -----------------------------------------------
function Reaction({ s }) {
  const r = num(s.reactants, 40), p = num(s.products, s.exothermic === false ? 70 : 15);
  const ea = num(s.activationEnergy, 60);
  const bottom = H - 80, top = 70, plotH = bottom - top;
  const eMax = Math.max(r, p, ea + Math.max(r, p) * 0.2, 100);
  const yF = (e) => bottom - (e / eMax) * plotH;
  const peakY = yF(Math.max(r, p) + ea);
  const d = `M100 ${yF(r)} L240 ${yF(r)} Q380 ${peakY} 520 ${yF(p)} L660 ${yF(p)}`;
  return (
    <g>
      <line x1={90} y1={bottom} x2={W - 60} y2={bottom} stroke="currentColor" strokeWidth="1.5" />
      <line x1={90} y1={bottom} x2={90} y2={top - 10} stroke="currentColor" strokeWidth="1.5" markerEnd="url(#il-arrow)" />
      <text x={70} y={(top + bottom) / 2} fontSize="12" fill="currentColor" textAnchor="middle" transform={`rotate(-90 70 ${(top + bottom) / 2})`}>Energy</text>
      <path d={d} fill="none" stroke={P[0]} strokeWidth="3" />
      <line x1={240} y1={yF(Math.max(r, p))} x2={240} y2={peakY} stroke={P[1]} strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={250} y={(yF(Math.max(r, p)) + peakY) / 2} fontSize="11" fill={P[1]}>Ea</text>
      <text x={170} y={yF(r) - 10} fontSize="11" fill="currentColor" textAnchor="middle">reactants</text>
      <text x={590} y={yF(p) - 10} fontSize="11" fill="currentColor" textAnchor="middle">products</text>
      <text x={W / 2} y={H - 30} fontSize="11" fill="#64748b" textAnchor="middle">{p < r ? "exothermic (ΔH < 0)" : "endothermic (ΔH > 0)"}</text>
    </g>
  );
}

// ---- Orbital / electron-in-boxes -------------------------------------------
function Orbital({ s }) {
  const subs = Array.isArray(s.subshells) && s.subshells.length ? s.subshells : [
    { label: "1s", electrons: 2, capacity: 2 }, { label: "2s", electrons: 2, capacity: 2 }, { label: "2p", electrons: 4, capacity: 6 },
  ];
  const box = 34, gap = 8, startY = 120;
  return (
    <g>
      {subs.map((ss, i) => {
        const cap = num(ss.capacity, 2), boxes = Math.max(1, cap / 2), e = num(ss.electrons);
        const totalW = boxes * box + (boxes - 1) * gap, startX = (W - totalW) / 2;
        const y = startY + i * (box + 30);
        const ups = Math.min(boxes, e), downs = Math.max(0, e - boxes);
        return (
          <g key={i}>
            <text x={startX - 16} y={y + box / 2 + 4} fontSize="13" fontWeight="700" fill="currentColor" textAnchor="end">{ss.label}</text>
            {Array.from({ length: boxes }).map((_, b) => {
              const bx = startX + b * (box + gap);
              return (
                <g key={b}>
                  <rect x={bx} y={y} width={box} height={box} fill="none" stroke="#64748b" strokeWidth="1.5" rx="3" />
                  {b < ups && <line x1={bx + box * 0.35} y1={y + box - 6} x2={bx + box * 0.35} y2={y + 6} stroke={P[0]} strokeWidth="2" markerEnd="url(#il-arrow)" />}
                  {b < downs && <line x1={bx + box * 0.65} y1={y + 6} x2={bx + box * 0.65} y2={y + box - 6} stroke={P[1]} strokeWidth="2" markerEnd="url(#il-arrow)" />}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ---- DNA / RNA double (or single) helix ------------------------------------
function Dna({ s, single }) {
  const seq = String(s.sequence || "ATGCGATCGT").toUpperCase().replace(/[^ATGCU]/g, "") || "ATGCGATCGT";
  const pairs = Math.min(14, Math.max(4, num(s.pairs, seq.length)));
  const cx = W / 2, top = 60, bottom = H - 60, amp = 90;
  const yOf = (i) => top + (i / (pairs - 1)) * (bottom - top);
  const s1 = [], s2 = [];
  for (let i = 0; i < pairs; i++) { const a = (i / (pairs - 1)) * 3.2 * Math.PI; s1.push(`${cx + amp * Math.sin(a)},${yOf(i)}`); s2.push(`${cx - amp * Math.sin(a)},${yOf(i)}`); }
  const comp = { A: single ? "" : "T", T: "A", G: "C", C: "G", U: "A" };
  return (
    <g>
      <polyline points={s1.join(" ")} fill="none" stroke={P[0]} strokeWidth="4" />
      {!single && <polyline points={s2.join(" ")} fill="none" stroke={P[4]} strokeWidth="4" />}
      {Array.from({ length: pairs }).map((_, i) => {
        const a = (i / (pairs - 1)) * 3.2 * Math.PI, x1 = cx + amp * Math.sin(a), x2 = cx - amp * Math.sin(a), y = yOf(i);
        const base = seq[i % seq.length];
        return (
          <g key={i}>
            {!single && <line x1={x1} y1={y} x2={x2} y2={y} stroke={BASE_COLOR[base] || "#94a3b8"} strokeWidth="3" />}
            <circle cx={x1} cy={y} r="7" fill={BASE_COLOR[base] || "#94a3b8"} />
            <text x={x1} y={y + 3.5} fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">{base}</text>
            {!single && <circle cx={x2} cy={y} r="7" fill={BASE_COLOR[comp[base]] || "#94a3b8"} />}
            {!single && <text x={x2} y={y + 3.5} fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">{comp[base]}</text>}
          </g>
        );
      })}
    </g>
  );
}

// ---- Cell (animal / plant) -------------------------------------------------
function label(x, y, tx, ty, text, color) {
  return <g><line x1={x} y1={y} x2={tx} y2={ty} stroke="#94a3b8" strokeWidth="1" /><circle cx={x} cy={y} r="2.5" fill={color} /><text x={tx + (tx > W / 2 ? 4 : -4)} y={ty + 3} fontSize="11" fill="currentColor" textAnchor={tx > W / 2 ? "start" : "end"}>{text}</text></g>;
}
function Cell({ s }) {
  const plant = s.type === "plant", cx = W / 2, cy = H / 2;
  return (
    <g>
      {plant && <rect x={cx - 220} y={cy - 150} width="440" height="300" rx="14" fill="#dcfce7" stroke="#16a34a" strokeWidth="6" />}
      <ellipse cx={cx} cy={cy} rx={plant ? 200 : 210} ry={plant ? 135 : 140} fill={plant ? "#f0fdf4" : "#eff6ff"} stroke={plant ? "#65a30d" : "#3b82f6"} strokeWidth="2.5" />
      {plant && <ellipse cx={cx + 40} cy={cy} rx="120" ry="80" fill="#bfdbfe66" stroke="#60a5fa" strokeWidth="1.5" />}
      <circle cx={cx - 70} cy={cy - 20} r="46" fill="#c7d2fe" stroke="#4f46e5" strokeWidth="2" />
      <circle cx={cx - 70} cy={cy - 20} r="16" fill="#4f46e5" />
      {[[cx + 70, cy - 60], [cx + 100, cy + 40], [cx - 20, cy + 70]].map(([mx, my], i) => (
        <g key={i}><ellipse cx={mx} cy={my} rx="30" ry="15" fill="#fecaca" stroke="#ef4444" strokeWidth="1.5" /><path d={`M${mx - 22} ${my} q11 -8 22 0 q11 8 22 0`} fill="none" stroke="#ef4444" strokeWidth="1.2" /></g>
      ))}
      {plant && [[cx + 30, cy - 30], [cx + 60, cy - 10], [cx - 30, cy + 40]].map(([gx, gy], i) => <ellipse key={i} cx={gx} cy={gy} rx="16" ry="10" fill="#22c55e" stroke="#15803d" strokeWidth="1.2" />)}
      {Array.from({ length: 14 }).map((_, i) => <circle key={i} cx={cx - 130 + (i % 7) * 30} cy={cy + 30 + Math.floor(i / 7) * 24} r="2.5" fill="#f59e0b" />)}
      {label(cx - 70, cy - 20, cx - 250, cy - 90, "Nucleus", "#4f46e5")}
      {label(cx + 70, cy - 60, cx + 250, cy - 100, "Mitochondrion", "#ef4444")}
      {label(cx - 130, cy + 30, cx - 250, cy + 110, "Ribosomes", "#f59e0b")}
      {plant ? label(cx - 200, cy - 150, cx - 250, cy - 150, "Cell wall", "#16a34a") : label(cx, cy - 140, cx + 250, cy + 110, "Cell membrane", "#3b82f6")}
      {plant && label(cx + 40, cy, cx + 250, cy + 40, "Vacuole", "#60a5fa")}
      {plant && label(cx + 30, cy - 30, cx + 250, cy - 30, "Chloroplast", "#22c55e")}
    </g>
  );
}

// ---- Electric field --------------------------------------------------------
function EField({ s }) {
  const cy = H / 2;
  const charges = Array.isArray(s.charges) && s.charges.length ? s.charges : [{ x: -0.5, q: 1 }, { x: 0.5, q: -1 }];
  const px = (x) => W / 2 + x * 200;
  return (
    <g>
      {charges.map((c, i) => {
        const pos = num(c.q) >= 0, x = px(num(c.x));
        return Array.from({ length: 12 }).map((_, k) => {
          const a = (k / 12) * 2 * Math.PI, r1 = 26, r2 = 70;
          const x1 = x + r1 * Math.cos(a), y1 = cy + r1 * Math.sin(a), x2 = x + r2 * Math.cos(a), y2 = cy + r2 * Math.sin(a);
          return <line key={`${i}-${k}`} x1={pos ? x1 : x2} y1={pos ? y1 : y2} x2={pos ? x2 : x1} y2={pos ? y2 : y1} stroke="#94a3b8" strokeWidth="1.3" markerEnd="url(#il-arrow)" />;
        });
      })}
      {charges.map((c, i) => {
        const pos = num(c.q) >= 0, x = px(num(c.x));
        return <g key={i}><circle cx={x} cy={cy} r="22" fill={pos ? P[1] : P[0]} /><text x={x} y={cy + 8} fontSize="24" fontWeight="800" fill="#fff" textAnchor="middle">{pos ? "+" : "−"}</text></g>;
      })}
    </g>
  );
}

// ---- Bar magnet field ------------------------------------------------------
function BMagnet({ s }) {
  const cx = W / 2, cy = H / 2;
  return (
    <g>
      {[40, 80, 130, 185].map((r, i) => (
        <g key={i}>
          <path d={`M${cx - 60} ${cy} C${cx - 60} ${cy - r} ${cx + 60} ${cy - r} ${cx + 60} ${cy}`} fill="none" stroke="#94a3b8" strokeWidth="1.4" markerEnd="url(#il-arrow)" />
          <path d={`M${cx - 60} ${cy} C${cx - 60} ${cy + r} ${cx + 60} ${cy + r} ${cx + 60} ${cy}`} fill="none" stroke="#94a3b8" strokeWidth="1.4" markerEnd="url(#il-arrow)" />
        </g>
      ))}
      <rect x={cx - 60} y={cy - 26} width="60" height="52" fill={P[1]} />
      <rect x={cx} y={cy - 26} width="60" height="52" fill={P[0]} />
      <text x={cx - 30} y={cy + 7} fontSize="20" fontWeight="800" fill="#fff" textAnchor="middle">N</text>
      <text x={cx + 30} y={cy + 7} fontSize="20" fontWeight="800" fill="#fff" textAnchor="middle">S</text>
    </g>
  );
}

// ---- Vector / slope field --------------------------------------------------
function Field({ s }) {
  const slope = s.type === "slope";
  const cx = W / 2, cy = H / 2, n = 9, gap = 62, len = 26;
  const items = [];
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const x = cx + (gx - (n - 1) / 2) * gap, y = cy + (gy - (n - 1) / 2) * gap;
    const ux = (x - cx) / 62, uy = -(y - cy) / 62;
    let vx, vy;
    if (slope) { vx = 1; vy = Math.tanh(ux + uy); } else { vx = -uy; vy = ux; }
    const L = Math.hypot(vx, vy) || 1, dx = (vx / L) * len, dy = (vy / L) * len;
    items.push({ x, y, dx, dy: -dy });
  }
  return (
    <g>
      {items.map((c, i) => (
        <line key={i} x1={c.x - c.dx / 2} y1={c.y - c.dy / 2} x2={c.x + c.dx / 2} y2={c.y + c.dy / 2} stroke={P[0]} strokeWidth="1.6" markerEnd={slope ? undefined : "url(#il-arrow)"} />
      ))}
    </g>
  );
}

// ---- Generic data table ----------------------------------------------------
const tr = (t, n = 26) => { t = String(t ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
function TableFig({ s }) {
  const headers = Array.isArray(s.headers) ? s.headers : [];
  const rows = Array.isArray(s.rows) && s.rows.length ? s.rows : [["No data"]];
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const tW = Math.min(680, Math.max(300, cols * 150)), x0 = (W - tW) / 2, colW = tW / cols;
  const rowH = 40, y0 = 90, hasH = headers.length > 0, total = rows.length + (hasH ? 1 : 0);
  return (
    <g>
      {hasH && (
        <g>
          <rect x={x0} y={y0} width={tW} height={rowH} fill={P[0]} />
          {headers.map((h, i) => <text key={i} x={x0 + i * colW + colW / 2} y={y0 + rowH / 2 + 4} fontSize="13" fontWeight="700" fill="#fff" textAnchor="middle">{tr(h, 18)}</text>)}
        </g>
      )}
      {rows.map((r, ri) => {
        const ry = y0 + (hasH ? rowH : 0) + ri * rowH;
        return (
          <g key={ri}>
            <rect x={x0} y={ry} width={tW} height={rowH} fill={ri % 2 ? "#94a3b822" : "transparent"} />
            {Array.from({ length: cols }).map((_, ci) => <text key={ci} x={x0 + ci * colW + colW / 2} y={ry + rowH / 2 + 4} fontSize="12" fontWeight={ci === 0 ? 700 : 400} fill="currentColor" textAnchor="middle">{tr(r[ci], 18)}</text>)}
          </g>
        );
      })}
      <rect x={x0} y={y0} width={tW} height={total * rowH} fill="none" stroke="#334155" strokeWidth="1.5" />
      {Array.from({ length: cols - 1 }).map((_, i) => <line key={i} x1={x0 + (i + 1) * colW} y1={y0} x2={x0 + (i + 1) * colW} y2={y0 + total * rowH} stroke="#94a3b8" strokeWidth="0.5" />)}
    </g>
  );
}

// ---- Cell division (mitosis / meiosis) -------------------------------------
function chromosomes(ph, cx, cy) {
  const X = (x, y, c, k) => <g key={k} stroke={c} strokeWidth="2.5" fill="none"><line x1={x - 6} y1={y - 8} x2={x + 6} y2={y + 8} /><line x1={x + 6} y1={y - 8} x2={x - 6} y2={y + 8} /></g>;
  if (/Metaphase/.test(ph)) return [X(cx, cy - 15, P[1], 0), X(cx, cy + 15, P[4], 1)];
  if (/Anaphase/.test(ph)) return [X(cx - 26, cy, P[1], 0), X(cx + 26, cy, P[1], 1), X(cx - 26, cy + 4, P[4], 2), X(cx + 26, cy + 4, P[4], 3)];
  if (/Telophase|II/.test(ph)) return [X(cx - 24, cy - 6, P[1], 0), X(cx + 24, cy + 6, P[4], 1)];
  return [X(cx - 16, cy - 12, P[1], 0), X(cx + 14, cy + 10, P[4], 1)];
}
function CellDivision({ s }) {
  const meiosis = s.process === "meiosis";
  const phases = meiosis ? ["Prophase I", "Metaphase I", "Anaphase I", "Telophase I", "Meiosis II"] : ["Prophase", "Metaphase", "Anaphase", "Telophase"];
  const n = phases.length, band = (W - 40) / n, r = Math.min(52, band / 2 - 8), y = H / 2;
  return (
    <g>
      {phases.map((ph, i) => {
        const cx = 20 + band * i + band / 2;
        return (
          <g key={i}>
            <circle cx={cx} cy={y} r={r} fill="#eff6ff" stroke="#3b82f6" strokeWidth="2" />
            {chromosomes(ph, cx, y)}
            <text x={cx} y={y + r + 20} fontSize="11" fontWeight="600" fill="currentColor" textAnchor="middle">{ph}</text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Human body (systems overview) -----------------------------------------
function HumanBody({ s }) {
  const cx = W / 2;
  const organs = Array.isArray(s.organs) && s.organs.length ? s.organs : [
    { t: "Brain", y: 88, c: "#ef4444" }, { t: "Lungs", y: 165, c: "#60a5fa" }, { t: "Heart", y: 180, c: "#dc2626" },
    { t: "Liver", y: 205, c: "#f59e0b" }, { t: "Stomach", y: 220, c: "#10b981" }, { t: "Intestines", y: 250, c: "#a855f7" },
  ];
  return (
    <g>
      <g fill="#dbeafe" stroke="#3b82f6" strokeWidth="2">
        <circle cx={cx} cy={90} r="34" />
        <rect x={cx - 45} y={128} width="90" height="150" rx="22" />
        <rect x={cx - 72} y={135} width="24" height="120" rx="12" /><rect x={cx + 48} y={135} width="24" height="120" rx="12" />
        <rect x={cx - 42} y={276} width="30" height="150" rx="14" /><rect x={cx + 12} y={276} width="30" height="150" rx="14" />
      </g>
      {organs.map((o, i) => {
        const right = i % 2 === 1, ox = cx + (o.t === "Lungs" ? 14 : o.t === "Heart" ? -12 : 0);
        return (
          <g key={i}>
            <circle cx={ox} cy={o.y} r="7" fill={o.c} stroke="#fff" strokeWidth="1.5" />
            <line x1={ox} y1={o.y} x2={right ? cx + 130 : cx - 130} y2={o.y} stroke="#94a3b8" strokeWidth="1" />
            <text x={right ? cx + 134 : cx - 134} y={o.y + 3} fontSize="11" fill="currentColor" textAnchor={right ? "start" : "end"}>{o.t}</text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Periodic table --------------------------------------------------------
const PT_ROWS = [
  ["H", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "He"],
  ["Li", "Be", null, null, null, null, null, null, null, null, null, null, "B", "C", "N", "O", "F", "Ne"],
  ["Na", "Mg", null, null, null, null, null, null, null, null, null, null, "Al", "Si", "P", "S", "Cl", "Ar"],
  ["K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"],
  ["Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe"],
  ["Cs", "Ba", "La", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn"],
  ["Fr", "Ra", "Ac", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"],
];
const PT_F = [
  ["Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"],
  ["Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"],
];
function PeriodicTable({ s }) {
  const hi = new Set((s.highlight || []).map((x) => String(x)));
  const cell = Math.min(38, (W - 40) / 18), x0 = (W - 18 * cell) / 2, y0 = 56;
  const draw = (sym, col, row, k) => {
    if (!sym) return null;
    const on = hi.has(sym), x = x0 + col * cell, y = y0 + row * cell;
    return (
      <g key={k}>
        <rect x={x} y={y} width={cell - 2} height={cell - 2} rx="2" fill={on ? P[1] : "#e2e8f0"} stroke="#94a3b8" strokeWidth="0.5" />
        <text x={x + (cell - 2) / 2} y={y + (cell - 2) / 2 + 3} fontSize={cell * 0.34} fontWeight={on ? 800 : 500} fill={on ? "#fff" : "#334155"} textAnchor="middle">{sym}</text>
      </g>
    );
  };
  return (
    <g>
      {PT_ROWS.map((r, ri) => r.map((sym, ci) => draw(sym, ci, ri, `m${ri}-${ci}`)))}
      {PT_F.map((r, ri) => r.map((sym, ci) => draw(sym, ci + 2, 7.6 + ri, `f${ri}-${ci}`)))}
    </g>
  );
}

// ---- Fishbone (Ishikawa) ---------------------------------------------------
function Fishbone({ s }) {
  const effect = s.effect || "Effect";
  const causes = Array.isArray(s.causes) && s.causes.length ? s.causes : [
    { category: "People", items: ["Training", "Staffing"] }, { category: "Process", items: ["Delays", "Steps"] },
    { category: "Equipment", items: ["Old tools"] }, { category: "Materials", items: ["Quality"] },
  ];
  const spineY = H / 2, x0 = 60, x1 = W - 170, half = Math.ceil(causes.length / 2);
  return (
    <g>
      <line x1={x0} y1={spineY} x2={x1} y2={spineY} stroke="#334155" strokeWidth="3" markerEnd="url(#il-arrow)" />
      <rect x={x1 + 6} y={spineY - 26} width="158" height="52" rx="8" fill="#1e293b" />
      <text x={x1 + 85} y={spineY + 5} fontSize="13" fontWeight="700" fill="#fff" textAnchor="middle">{tr(effect, 18)}</text>
      {causes.map((c, i) => {
        const top = i % 2 === 0, frac = (Math.floor(i / 2) + 1) / (half + 1);
        const bx = x0 + frac * (x1 - x0), ey = top ? spineY - 120 : spineY + 120, ex = bx - 70, color = P[i % P.length];
        return (
          <g key={i}>
            <line x1={bx} y1={spineY} x2={ex} y2={ey} stroke={color} strokeWidth="2" />
            <text x={ex} y={ey + (top ? -6 : 16)} fontSize="12" fontWeight="700" fill={color} textAnchor="middle">{c.category}</text>
            {(c.items || []).map((it, j) => <text key={j} x={ex + 30} y={ey + (top ? (j + 1) * 15 : -(j + 1) * 15)} fontSize="10" fill="currentColor">• {tr(it, 16)}</text>)}
          </g>
        );
      })}
    </g>
  );
}

// ---- Flashcards ------------------------------------------------------------
function Flashcards({ s }) {
  const cards = (Array.isArray(s.cards) && s.cards.length ? s.cards : [
    { front: "Capital of France?", back: "Paris" }, { front: "H₂O is?", back: "Water" }, { front: "2 + 2 = ?", back: "4" },
  ]).slice(0, 3);
  const cw = 200, ch = 130, gap = 30, total = cards.length * cw + (cards.length - 1) * gap, x0 = (W - total) / 2, y = H / 2 - ch / 2;
  return (
    <g>
      {cards.map((c, i) => {
        const x = x0 + i * (cw + gap);
        return (
          <g key={i}>
            <rect x={x} y={y} width={cw} height={ch} rx="12" fill="#eff6ff" stroke={P[0]} strokeWidth="2" />
            <text x={x + cw / 2} y={y + ch * 0.38} fontSize="13" fontWeight="700" fill="currentColor" textAnchor="middle">{tr(c.front, 22)}</text>
            <line x1={x + 16} y1={y + ch * 0.55} x2={x + cw - 16} y2={y + ch * 0.55} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
            <text x={x + cw / 2} y={y + ch * 0.74} fontSize="12" fill={P[2]} textAnchor="middle">{tr(c.back, 22)}</text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Reaction mechanism (stepwise species flow) ----------------------------
function Mechanism({ s }) {
  const species = Array.isArray(s.species) && s.species.length ? s.species : ["CH₃Br", "[Transition State]", "CH₃OH"];
  const conditions = Array.isArray(s.conditions) ? s.conditions : [];
  const notes = Array.isArray(s.notes) ? s.notes : [];
  const n = species.length, cy = H / 2, unit = (W - 40) / n;
  const boxW = Math.max(70, unit - 52), boxH = 66;
  const cxOf = (i) => 20 + i * unit + unit / 2;
  return (
    <g>
      {species.map((sp, i) => {
        const x = cxOf(i), intermediate = /^\[.*\]$/.test(String(sp).trim());
        return (
          <g key={i}>
            <rect x={x - boxW / 2} y={cy - boxH / 2} width={boxW} height={boxH} rx="10"
              fill={intermediate ? "#fef9c3" : "#eff6ff"} stroke={intermediate ? "#ca8a04" : "#3b82f6"}
              strokeWidth="2" strokeDasharray={intermediate ? "5 4" : undefined} />
            <text x={x} y={cy + 5} fontSize="13" fontWeight="700" fill="currentColor" textAnchor="middle">{tr(sp, Math.max(8, Math.floor(boxW / 8)))}</text>
            {i < n - 1 && (() => {
              const x1 = x + boxW / 2 + 4, x2 = cxOf(i + 1) - boxW / 2 - 4, mx = (x1 + x2) / 2;
              return (
                <g>
                  <line x1={x1} y1={cy} x2={x2} y2={cy} stroke="#334155" strokeWidth="2.5" markerEnd="url(#il-arrow)" />
                  {conditions[i] && <text x={mx} y={cy - 12} fontSize="12" fontWeight="600" fill={P[2]} textAnchor="middle">{tr(conditions[i], 16)}</text>}
                  {notes[i] && <text x={mx} y={cy + 22} fontSize="10" fill="#64748b" textAnchor="middle">{tr(notes[i], 18)}</text>}
                </g>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}

const KINDS = {
  wave: (p) => <Wave {...p} />, projectile: (p) => <Projectile {...p} />, circuit: (p) => <Circuit {...p} />,
  mechanism: (p) => <Mechanism {...p} />,
  ray: (p) => <Ray {...p} />, molecule: (p) => <Molecule {...p} />, reaction: (p) => <Reaction {...p} />,
  orbital: (p) => <Orbital {...p} />, dna: (p) => <Dna {...p} />, rna: (p) => <Dna {...p} single />,
  cell: (p) => <Cell {...p} />, efield: (p) => <EField {...p} />, bmagnet: (p) => <BMagnet {...p} />,
  field: (p) => <Field {...p} />, table: (p) => <TableFig {...p} />, celldivision: (p) => <CellDivision {...p} />,
  humanbody: (p) => <HumanBody {...p} />, periodictable: (p) => <PeriodicTable {...p} />, fishbone: (p) => <Fishbone {...p} />,
  flashcards: (p) => <Flashcards {...p} />,
};

const IllustrationRenderer = forwardRef(function IllustrationRenderer({ spec }, ref) {
  const holder = useRef(null);
  useImperativeHandle(ref, () => ({ engine: "svg", get node() { return holder.current; } }), []);
  const il = spec?.illustration || {};
  const Body = KINDS[il.kind] || KINDS.cell;
  return (
    <div ref={holder} className="flex h-full w-full items-center justify-center overflow-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full max-w-3xl text-slate-700 dark:text-slate-200" role="img" aria-label={spec?.title || "Illustration"}>
        <defs>
          <marker id="il-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>
        {spec?.title && <text x={W / 2} y="28" fontSize="15" fontWeight="700" fill="currentColor" textAnchor="middle">{spec.title}</text>}
        {Body({ s: il })}
      </svg>
    </div>
  );
});

export default IllustrationRenderer;
