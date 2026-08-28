import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useSettings } from "./SettingsContext";

const ZoomContext = createContext();
const MIN = 0.5;
const MAX = 2;
const DEFAULT = 0.8; // fallback page zoom (80%) if no admin default is set
const KEY = "msg-zoom-v2";

const clamp = (v) => Math.min(MAX, Math.max(MIN, +(+v).toFixed(2)));

// Site-wide zoom. A visitor's own choice (stored in localStorage) always wins;
// otherwise the admin-configured default zoom (Settings) is applied. The chosen
// level scales the root font-size so the whole rem-based layout zooms — this
// also works correctly inside full-screen quiz/test screens and on iOS Safari.
export function ZoomProvider({ children }) {
  const { settings } = useSettings();

  // Did the visitor explicitly pick a zoom before? If so, respect it.
  const stored = parseFloat(localStorage.getItem(KEY));
  const hadStored = stored >= MIN && stored <= MAX;

  const [userSet, setUserSet] = useState(hadStored);
  const [zoom, setZoomState] = useState(hadStored ? stored : DEFAULT);

  // Apply the admin default once settings load, unless the visitor set their own.
  useEffect(() => {
    if (userSet) return;
    const pct = Number(settings?.defaultZoom);
    if (pct >= 50 && pct <= 200) setZoomState(clamp(pct / 100));
  }, [settings?.defaultZoom, userSet]);

  // Reflect the current zoom on the document.
  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round(zoom * 100)}%`;
  }, [zoom]);

  // Persist only when the visitor deliberately changes the zoom.
  const apply = useCallback((v) => {
    const c = clamp(v);
    setZoomState(c);
    setUserSet(true);
    localStorage.setItem(KEY, String(c));
    return c;
  }, []);

  const setZoom = useCallback((v) => apply(v), [apply]);
  const zoomIn = useCallback(() => apply(zoom + 0.1), [apply, zoom]);
  const zoomOut = useCallback(() => apply(zoom - 0.1), [apply, zoom]);

  // Reset clears the personal choice and returns to the admin default.
  const resetZoom = useCallback(() => {
    localStorage.removeItem(KEY);
    setUserSet(false);
    const pct = Number(settings?.defaultZoom);
    setZoomState(pct >= 50 && pct <= 200 ? clamp(pct / 100) : DEFAULT);
  }, [settings?.defaultZoom]);

  return (
    <ZoomContext.Provider value={{ zoom, zoomIn, zoomOut, setZoom, resetZoom, MIN, MAX }}>
      {children}
    </ZoomContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useZoom() {
  return useContext(ZoomContext);
}
