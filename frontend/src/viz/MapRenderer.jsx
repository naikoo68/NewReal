// Map engine — renders maps, value-graduated markers (choropleth-style), and
// flow maps with Leaflet + OpenStreetMap tiles. Leaflet is plain-JS (renders
// into a <div>), so it's loaded LAZILY from a CDN (its CSS is injected once),
// keeping it out of package.json / the bundle. A spec carries
// `spec.map = { center:[lat,lng], zoom, markers[], lines[], geojson? }`.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

const LEAFLET_JS = "https://esm.sh/leaflet@1.9.4";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("leaflet-cdn-css")) return;
  const l = document.createElement("link");
  l.id = "leaflet-cdn-css";
  l.rel = "stylesheet";
  l.href = LEAFLET_CSS;
  document.head.appendChild(l);
}

// Simple sequential colour scale for choropleth-style value markers.
function colorFor(v) {
  const scale = ["#dbeafe", "#93c5fd", "#60a5fa", "#2563eb", "#1e3a8a"];
  return scale[Math.min(scale.length - 1, Math.max(0, Math.floor((Number(v) || 0) / 25)))];
}

const MapRenderer = forwardRef(function MapRenderer({ spec }, ref) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState("");

  useImperativeHandle(ref, () => ({
    engine: "leaflet",
    get node() { return holder.current; },
    get map() { return mapRef.current; },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let map = null; // the map THIS effect run owns (so cleanup can't kill a newer one)
    const m = spec?.map;
    if (!m) { setError(""); return; }
    ensureCss();
    (async () => {
      try {
        const L = (await import(/* @vite-ignore */ LEAFLET_JS)).default;
        if (cancelled || !holder.current) return;
        const container = holder.current;
        // Tear down any map still bound to this DOM node before re-initialising.
        // Leaflet stamps the node with `_leaflet_id`; if it lingers (StrictMode
        // double-mount or a rapid re-generate), L.map() throws
        // "Map container is already initialized". Clearing it makes init safe.
        try { mapRef.current?.remove?.(); } catch { /* ignore */ }
        if (container._leaflet_id != null) {
          container._leaflet_id = undefined;
          container.innerHTML = "";
        }
        const center = Array.isArray(m.center) && m.center.length === 2 ? m.center : [20.6, 78.9];
        map = L.map(container).setView(center, m.zoom || 4);
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);

        (m.lines || []).forEach((ln) => {
          if (Array.isArray(ln.from) && Array.isArray(ln.to)) L.polyline([ln.from, ln.to], { color: "#f97316", weight: 2, opacity: 0.8 }).addTo(map);
        });
        (m.markers || []).forEach((mk) => {
          const lat = Number(mk.lat), lng = Number(mk.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const hasVal = Number.isFinite(Number(mk.value));
          const marker = L.circleMarker([lat, lng], {
            radius: hasVal ? Math.max(6, Math.min(26, Number(mk.value) / (m.scale || 4))) : 8,
            color: "#1e40af",
            weight: 1,
            fillColor: hasVal ? colorFor(mk.value) : "#3b82f6",
            fillOpacity: 0.7,
          }).addTo(map);
          if (mk.label) marker.bindTooltip(String(mk.label));
        });
        if (m.geojson) {
          try { L.geoJSON(m.geojson, { style: (f) => ({ color: "#334155", weight: 1, fillColor: colorFor(f?.properties?.value), fillOpacity: 0.6 }) }).addTo(map); } catch { /* ignore bad geojson */ }
        }
        setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 120);
        if (!cancelled) setError("");
      } catch (e) {
        if (!cancelled) setError(e?.message || "Couldn't load the map.");
      }
    })();
    return () => {
      cancelled = true;
      // Only remove the map this run created; if a newer run already replaced
      // mapRef, don't tear down the live map.
      try { map?.remove?.(); } catch { /* ignore */ }
      if (mapRef.current === map) mapRef.current = null;
      const container = holder.current;
      if (container && container._leaflet_id != null) { container._leaflet_id = undefined; container.innerHTML = ""; }
    };
  }, [spec?.map]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={holder} className="h-full w-full rounded-lg" style={{ minHeight: 360 }} />
      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
});

export default MapRenderer;
