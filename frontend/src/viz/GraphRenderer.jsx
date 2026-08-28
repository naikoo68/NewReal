// Graph/Network engine — renders network graphs, trees, org charts, decision
// trees and data-structure diagrams (linked list, stack, queue, heap, BST, trie)
// with Cytoscape.js. Cytoscape is plain-JS (renders into a <div>, like Plotly),
// so loading it LAZILY from a CDN avoids any React-version conflicts and keeps
// it out of package.json / the bundle. A spec carries `spec.graph = { nodes,
// edges, layout, directed }`.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "../context/ThemeContext";

const CYTOSCAPE_CDN = "https://esm.sh/cytoscape@3";

// Cytoscape layout name for a topology hint from the `network` shape.
function mapLayout(l) {
  switch (String(l || "").toLowerCase()) {
    case "star": return "concentric";
    case "mesh": case "ring": return "circle";
    case "bus": case "line": return "grid";
    case "tree": case "hierarchical": return "breadthfirst";
    case "grid": return "grid";
    default: return "cose";
  }
}

// Accept both the canonical `graph` shape and the friendlier `network` shape
// (nodes with id/type/x/y, connections with from/to). Returns { nodes, edges,
// layout, directed, preset } or null.
function toGraph(spec) {
  const g = spec?.graph;
  if (Array.isArray(g?.nodes) && g.nodes.length) return { nodes: g.nodes, edges: Array.isArray(g.edges) ? g.edges : [], layout: g.layout, directed: g.directed, preset: false };
  const net = spec?.network;
  if (Array.isArray(net?.nodes) && net.nodes.length) {
    const links = net.connections || net.edges || net.links || [];
    const hasXY = net.nodes.every((n) => Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y)));
    return {
      nodes: net.nodes.map((n) => ({ id: n.id ?? n.label, label: n.label ?? n.id, type: n.type, x: n.x, y: n.y })),
      edges: (Array.isArray(links) ? links : []).map((c) => ({ source: c.from ?? c.source, target: c.to ?? c.target, label: net.showLinkLabels === false ? "" : c.label })),
      layout: hasXY ? "preset" : mapLayout(net.layout),
      directed: net.directed === true,
      preset: hasXY,
    };
  }
  return null;
}

const TYPE_COLORS = { switch: "#0891b2", router: "#7c3aed", server: "#4338ca", firewall: "#dc2626", cloud: "#475569", internet: "#475569", modem: "#ca8a04", printer: "#0d9488" };

const GraphRenderer = forwardRef(function GraphRenderer({ spec }, ref) {
  const holder = useRef(null);
  const cyRef = useRef(null);
  const [error, setError] = useState("");
  const { theme } = useTheme();

  useImperativeHandle(ref, () => ({
    engine: "cytoscape",
    get node() { return holder.current; },
    get cy() { return cyRef.current; },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const g = toGraph(spec);
    const nodes = Array.isArray(g?.nodes) ? g.nodes : [];
    const edges = Array.isArray(g?.edges) ? g.edges : [];
    if (!nodes.length) { setError(""); return; }

    (async () => {
      try {
        const cytoscape = (await import(/* @vite-ignore */ CYTOSCAPE_CDN)).default;
        if (cancelled || !holder.current) return;
        try { cyRef.current?.destroy?.(); } catch { /* ignore */ }
        const dark = theme === "dark";
        const directed = g?.directed === true; // network topologies are undirected by default
        // Drop edges that point to a missing node so one bad link can't blank the whole diagram.
        const ids = new Set(nodes.map((n) => String(n.id ?? n.label)));
        const elements = [
          ...nodes.map((n) => {
            const el = { data: { id: String(n.id ?? n.label), label: String(n.label ?? n.id ?? ""), ntype: String(n.type || "").toLowerCase() } };
            if (g.preset && Number.isFinite(Number(n.x)) && Number.isFinite(Number(n.y))) el.position = { x: Number(n.x), y: Number(n.y) };
            return el;
          }),
          ...edges
            .filter((e) => ids.has(String(e.source)) && ids.has(String(e.target)))
            .map((e, i) => ({ data: { id: "e" + i, source: String(e.source), target: String(e.target), label: e.label ? String(e.label) : "" } })),
        ];
        cyRef.current = cytoscape({
          container: holder.current,
          elements,
          style: [
            { selector: "node", style: { label: "data(label)", "text-valign": "center", "text-halign": "center", "background-color": "#2563eb", color: "#ffffff", "font-size": 11, "width": "label", "height": "label", padding: "10px", shape: "round-rectangle", "text-wrap": "wrap", "text-max-width": 120 } },
            ...Object.entries(TYPE_COLORS).map(([t, c]) => ({ selector: `node[ntype = "${t}"]`, style: { "background-color": c } })),
            { selector: "edge", style: { width: 2, "line-color": dark ? "#64748b" : "#94a3b8", "target-arrow-color": dark ? "#64748b" : "#94a3b8", "target-arrow-shape": directed ? "triangle" : "none", "curve-style": "bezier", label: "data(label)", "font-size": 9, color: dark ? "#cbd5e1" : "#475569", "text-background-color": dark ? "#0f172a" : "#ffffff", "text-background-opacity": 1, "text-background-padding": 2 } },
          ],
          layout: g.preset
            ? { name: "preset", padding: 24, fit: true }
            : { name: g?.layout || "breadthfirst", directed, padding: 16, spacingFactor: 1.15, animate: false },
          minZoom: 0.2,
          maxZoom: 3,
        });
        cyRef.current.fit(undefined, 28);
        if (!cancelled) setError("");
      } catch (e) {
        if (!cancelled) setError(e?.message || "Couldn't render this graph — check the nodes/edges.");
      }
    })();

    return () => { cancelled = true; try { cyRef.current?.destroy?.(); } catch { /* ignore */ } };
  }, [JSON.stringify(spec?.graph), JSON.stringify(spec?.network), theme]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={holder} className="h-full min-h-[320px] w-full rounded-lg" />
      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
});

export default GraphRenderer;
