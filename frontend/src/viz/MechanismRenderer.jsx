// Organic reaction-mechanism engine — renders real 2D molecular structures from
// SMILES (via OpenChemLib, lazy-loaded from CDN) laid out left-to-right with
// reaction / equilibrium arrows, reagent labels, intermediate brackets, formal
// charges, and optional curved "electron-pushing" arrows.
//
//   spec.chem = {
//     // EITHER a single mechanism:
//     title,
//     steps:   [{ smiles, label, bracket, charge }],           // charge: "+" | "-"
//     arrows:  [{ type:"forward"|"equilibrium", top, bottom }], // length steps-1
//     electrons: [{ step, from:[fx,fy], to:[fx,fy] }],          // optional curved arrows (0..1 within a step box)
//     // OR several mechanisms combined into one figure:
//     overallTitle,
//     sections: [{ title, steps, arrows, electrons }]
//   }
//
// If OpenChemLib fails to load or a SMILES can't be parsed, the affected species
// gracefully falls back to its text label, so the flow always renders.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const W = 760, P0 = "#059669";
const toHref = (svg) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
const tr = (t, n) => { t = String(t ?? ""); return t.length > n ? t.slice(0, Math.max(1, n - 1)) + "…" : t; };
const clamp01 = (v, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d; };

// Wrap a label into at most 2 lines that each fit `maxChars`, so long reagent
// text never bleeds into the neighbouring structure.
function wrapLabel(text, maxChars) {
  const t = String(text ?? "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const words = t.split(/\s+/);
  let l1 = "", i = 0;
  while (i < words.length && (l1 ? l1.length + 1 + words[i].length : words[i].length) <= maxChars) { l1 = l1 ? `${l1} ${words[i]}` : words[i]; i++; }
  if (!l1) return [tr(t, maxChars)];
  const rest = words.slice(i).join(" ");
  return rest ? [l1, tr(rest, maxChars)] : [l1];
}

function bracketPath(x, y, h, right) {
  const w = 9;
  return right ? `M${x - w} ${y} h${w} v${h} h${-w}` : `M${x + w} ${y} h${-w} v${h} h${w}`;
}

// One mechanism rendered inside a horizontal band [top, top+height].
function Section({ sec, top, height, imgMap }) {
  const steps = Array.isArray(sec.steps) && sec.steps.length ? sec.steps : [{ label: "—" }];
  const arrows = Array.isArray(sec.arrows) ? sec.arrows : [];
  const n = steps.length;
  const contentTop = top + (sec.title ? 24 : 4), contentH = height - (sec.title ? 24 : 4);
  const cy = contentTop + contentH * 0.5;
  const baseCell = 168, baseGap = 84;
  const need = n * baseCell + (n - 1) * baseGap, maxW = W - 40;
  const sc = need > maxW ? maxW / need : 1;
  const cellW = baseCell * sc, gap = baseGap * sc;
  const cellH = Math.min(contentH * 0.68, cellW * 1.05);
  const totalW = n * cellW + (n - 1) * gap, x0 = (W - totalW) / 2;
  const cellX = (i) => x0 + i * (cellW + gap);
  return (
    <g>
      {sec.title && <text x={24} y={top + 16} fontSize="13" fontWeight="700" fill="currentColor">{sec.title}</text>}
      {steps.map((st, i) => {
        const x = cellX(i), boxTop = cy - cellH / 2, im = st.smiles ? imgMap[st.smiles] : null;
        return (
          <g key={i}>
            <rect x={x} y={boxTop} width={cellW} height={cellH} rx="8" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
            {im ? <image href={im} x={x + 4} y={boxTop + 4} width={cellW - 8} height={cellH - 8} preserveAspectRatio="xMidYMid meet" />
              : <text x={x + cellW / 2} y={cy + 5} fontSize={Math.max(11, 15 * sc)} fontWeight="600" fill="#334155" textAnchor="middle">{st.label || st.smiles || "?"}</text>}
            {st.bracket && <path d={bracketPath(x - 6, boxTop - 4, cellH + 8, false)} fill="none" stroke="currentColor" strokeWidth="2" />}
            {st.bracket && <path d={bracketPath(x + cellW + 6, boxTop - 4, cellH + 8, true)} fill="none" stroke="currentColor" strokeWidth="2" />}
            {st.charge && (
              <g>
                <circle cx={x + cellW - 12} cy={boxTop + 12} r="9" fill="none" stroke={st.charge === "+" ? "#dc2626" : "#2563eb"} strokeWidth="1.5" />
                <text x={x + cellW - 12} y={boxTop + 16} fontSize="12" fontWeight="800" fill={st.charge === "+" ? "#dc2626" : "#2563eb"} textAnchor="middle">{st.charge}</text>
              </g>
            )}
            {st.label && im && <text x={x + cellW / 2} y={boxTop + cellH + 15} fontSize="11" fontWeight="600" fill="currentColor" textAnchor="middle">{st.label}</text>}
            {(sec.electrons || []).filter((e) => e.step === i).map((e, k) => {
              // coords are clamped to 0..1 within the box so a bad value can't
              // produce a giant off-box arc.
              const fx = x + clamp01(e.from?.[0], 0.3) * cellW, fy = boxTop + clamp01(e.from?.[1], 0.3) * cellH;
              const tx = x + clamp01(e.to?.[0], 0.7) * cellW, ty = boxTop + clamp01(e.to?.[1], 0.5) * cellH;
              const mx = (fx + tx) / 2, my = Math.max(boxTop + 6, Math.min(fy, ty) - 18);
              return <path key={k} d={`M${fx} ${fy} Q${mx} ${my} ${tx} ${ty}`} fill="none" stroke="#db2777" strokeWidth="1.6" markerEnd="url(#mech-eln)" />;
            })}
          </g>
        );
      })}
      {arrows.slice(0, n - 1).map((ar, i) => {
        const x1 = cellX(i) + cellW + 6, x2 = cellX(i + 1) - 6, mxx = (x1 + x2) / 2, equil = ar?.type === "equilibrium";
        // keep labels inside the arrow gap: wrap/truncate to the available width
        const maxC = Math.max(6, Math.floor((x2 - x1 + 24) / 5.4));
        const topLines = ar?.top ? wrapLabel(ar.top, maxC) : [];
        return (
          <g key={i}>
            {equil ? (
              <g stroke="currentColor" strokeWidth="1.8" fill="none">
                <line x1={x1} y1={cy - 4} x2={x2} y2={cy - 4} markerEnd="url(#mech-arrow)" />
                <line x1={x2} y1={cy + 4} x2={x1} y2={cy + 4} markerEnd="url(#mech-arrow)" />
              </g>
            ) : (
              <line x1={x1} y1={cy} x2={x2} y2={cy} stroke="currentColor" strokeWidth="2" markerEnd="url(#mech-arrow)" />
            )}
            {topLines.map((ln, li) => (
              <text key={li} x={mxx} y={cy - 14 - (topLines.length - 1 - li) * 11} fontSize="10" fontWeight="600" fill={P0} textAnchor="middle">{ln}</text>
            ))}
            {ar?.bottom && <text x={mxx} y={cy + 17} fontSize="9" fill="#64748b" textAnchor="middle">{tr(ar.bottom, maxC)}</text>}
          </g>
        );
      })}
      {Array.isArray(sec.byproducts) && sec.byproducts.length > 0 && (
        <text x={cellX(n - 1) + cellW / 2} y={cy - cellH / 2 - 8} fontSize="11" fill="#64748b" textAnchor="middle">+ {tr(sec.byproducts.join(" + "), 26)}</text>
      )}
    </g>
  );
}

const MechanismRenderer = forwardRef(function MechanismRenderer({ spec }, ref) {
  const holder = useRef(null);
  const chem = spec?.chem || {};
  const sections = Array.isArray(chem.sections) && chem.sections.length
    ? chem.sections
    : [{ title: chem.title || spec?.title, steps: chem.steps, arrows: chem.arrows, electrons: chem.electrons, byproducts: chem.byproducts }];
  const allSmiles = Array.from(new Set(sections.flatMap((s) => (Array.isArray(s.steps) ? s.steps : []).map((st) => st?.smiles).filter(Boolean))));
  const [imgMap, setImgMap] = useState({});

  useImperativeHandle(ref, () => ({ engine: "svg", get node() { return holder.current; } }), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ "https://esm.sh/openchemlib@8");
        const Molecule = mod.Molecule ?? mod.default?.Molecule ?? mod.default;
        if (!Molecule?.fromSmiles) return;
        const map = {};
        for (const smi of allSmiles) {
          try { map[smi] = toHref(Molecule.fromSmiles(smi).toSVG(220, 170, undefined, { suppressChiralText: true, autoCrop: true, autoCropMargin: 8, strokeWidth: 1.4 })); } catch { /* fallback to label */ }
        }
        if (alive) setImgMap(map);
      } catch { /* keep text fallback */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allSmiles)]);

  const multi = sections.length > 1;
  const overall = chem.overallTitle;
  const topOffset = overall ? 42 : 8;
  const secH = multi ? 178 : 496;
  const HH = topOffset + sections.length * secH;

  return (
    <div ref={holder} className="flex h-full w-full items-center justify-center overflow-auto">
      <svg viewBox={`0 0 ${W} ${HH}`} className="mx-auto block h-auto w-full max-w-3xl text-slate-700 dark:text-slate-200" role="img" aria-label={spec?.title || "Reaction mechanism"}>
        <defs>
          <marker id="mech-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="currentColor" /></marker>
          <marker id="mech-eln" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#db2777" /></marker>
        </defs>
        {overall && <text x={W / 2} y="26" fontSize="16" fontWeight="800" fill="currentColor" textAnchor="middle">{overall}</text>}
        {sections.map((sec, si) => <Section key={si} sec={sec} top={topOffset + si * secH} height={secH} imgMap={imgMap} />)}
      </svg>
    </div>
  );
});

export default MechanismRenderer;
