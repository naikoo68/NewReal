// Export helpers for the Visualization Studio. Pure browser APIs — no deps.
// Chart.js draws to a <canvas>, so PNG is native; SVG export is offered only for
// SVG-based engines (later plugins). JSON/CSV/Print work for any spec.

// Trigger a browser download of a Blob/URL.
function download(filename, url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
const safeName = (s) => String(s || "visualization").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "visualization";

// PNG — from a Chart.js instance (chartRef.current) or a raw <canvas>.
export function exportPNG(chartOrCanvas, title) {
  const canvas = chartOrCanvas?.canvas || (chartOrCanvas instanceof HTMLCanvasElement ? chartOrCanvas : null);
  if (!canvas) throw new Error("Nothing to export as PNG yet.");
  // Flatten onto a white background so transparent PNGs aren't invisible on white.
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  download(`${safeName(title)}.png`, out.toDataURL("image/png"));
}

// JSON — the full spec (re-importable).
export function exportJSON(spec) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }));
  download(`${safeName(spec?.title)}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV — labels + each series as a column (best-effort for category charts).
export function exportCSV(spec) {
  const labels = Array.isArray(spec?.labels) ? spec.labels : [];
  const series = Array.isArray(spec?.series) ? spec.series : [];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let rows = [];
  const looksXY = series.some((s) => Array.isArray(s.data) && s.data.some((d) => d && typeof d === "object"));
  if (looksXY) {
    rows.push(["series", "x", "y", "r"].map(esc).join(","));
    series.forEach((s) => (s.data || []).forEach((p) => rows.push([s.name, p?.x, p?.y, p?.r].map(esc).join(","))));
  } else {
    rows.push(["label", ...series.map((s) => s.name || "value")].map(esc).join(","));
    labels.forEach((lab, i) => rows.push([lab, ...series.map((s) => s.data?.[i])].map(esc).join(",")));
  }
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  download(`${safeName(spec?.title)}.csv`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- SVG-engine exports (Mermaid and other SVG renderers) ----------------
// The renderer's ref exposes { engine:"svg", node }, where `node` contains an
// <svg>. These save/serialize that SVG.
function svgFromNode(node) {
  const svg = node?.querySelector?.("svg");
  if (!svg) throw new Error("Nothing to export yet.");
  return svg;
}

// SVG — serialize the rendered diagram to a .svg file.
export function exportSVG(node, title) {
  const xml = new XMLSerializer().serializeToString(svgFromNode(node));
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  download(`${safeName(title)}.svg`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// PNG — rasterize the SVG diagram onto a white canvas (2× for crispness).
export async function exportPNGFromSVG(node, title) {
  const svg = svgFromNode(node);
  const xml = new XMLSerializer().serializeToString(svg);
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("Could not rasterize the diagram.")); img.src = src; });
  const w = svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width || 800;
  const h = svg.viewBox?.baseVal?.height || svg.getBoundingClientRect().height || 600;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * 2));
  canvas.height = Math.max(1, Math.round(h * 2));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, w, h);
  download(`${safeName(title)}.png`, canvas.toDataURL("image/png"));
}

// Print an SVG diagram.
export function printNode(node, title) {
  const xml = new XMLSerializer().serializeToString(svgFromNode(node));
  const w = window.open("", "_blank");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to print.");
  w.document.write(`<html><head><title>${safeName(title)}</title></head><body style="margin:0;padding:16px;display:flex;justify-content:center">${xml}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

// ---- Plotly-engine exports (uses Plotly's own image API) -----------------
// `handle` = { engine:"plotly", node, lib } exposed by PlotlyRenderer.
export function exportPlotly(handle, format, title) {
  if (!handle?.lib || !handle?.node) throw new Error("Chart isn't ready yet — give it a moment.");
  return handle.lib.downloadImage(handle.node, {
    format, // "png" | "svg"
    filename: safeName(title),
    width: handle.node.clientWidth || 900,
    height: handle.node.clientHeight || 500,
  });
}

export async function printPlotly(handle, title) {
  if (!handle?.lib || !handle?.node) throw new Error("Nothing to print yet.");
  const url = await handle.lib.toImage(handle.node, { format: "png", width: handle.node.clientWidth || 900, height: handle.node.clientHeight || 500 });
  const w = window.open("", "_blank");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to print.");
  w.document.write(`<html><head><title>${safeName(title)}</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${url}" style="max-width:100%"/></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

// ---- Cytoscape-engine exports (graphs/networks/trees) --------------------
// `handle` = { engine:"cytoscape", cy }. Cytoscape renders PNG via cy.png().
export function exportCytoscape(handle, title) {
  const cy = handle?.cy;
  if (!cy) throw new Error("Graph isn't ready yet — give it a moment.");
  download(`${safeName(title)}.png`, cy.png({ full: true, scale: 2, bg: "#ffffff" }));
}

export function printCytoscape(handle, title) {
  const cy = handle?.cy;
  if (!cy) throw new Error("Nothing to print yet.");
  const uri = cy.png({ full: true, scale: 2, bg: "#ffffff" });
  const w = window.open("", "_blank");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to print.");
  w.document.write(`<html><head><title>${safeName(title)}</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${uri}" style="max-width:100%"/></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

// Print — open the chart image in a print-ready window.
export function printChart(chartOrCanvas, title) {
  const canvas = chartOrCanvas?.canvas || (chartOrCanvas instanceof HTMLCanvasElement ? chartOrCanvas : null);
  if (!canvas) throw new Error("Nothing to print yet.");
  const img = canvas.toDataURL("image/png");
  const w = window.open("", "_blank");
  if (!w) throw new Error("Pop-up blocked — allow pop-ups to print.");
  w.document.write(`<html><head><title>${safeName(title)}</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${img}" style="max-width:100%"/></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}
