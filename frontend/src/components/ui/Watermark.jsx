import { useEffect, useState } from "react";
import { useSettings } from "../../context/SettingsContext";

// A tiled, diagonal watermark drawn over the viewport on quiz/test pages so any
// screenshot carries the site's copyright mark.
//
// IMPORTANT: browsers cannot detect a screenshot (especially on phones — the OS
// never notifies web pages), so the watermark is ALWAYS rendered when enabled.
// That is the only way the mark reliably appears in a screenshot on every device.
// In "screenshot" mode it also briefly intensifies when a desktop screenshot
// shortcut is detected — a bonus on top of the always-on base layer.
export default function Watermark() {
  const { settings } = useSettings();
  const enabled = settings?.watermarkEnabled !== false;
  const mode = settings?.watermarkMode || "always";
  const [boost, setBoost] = useState(false);

  useEffect(() => {
    if (!enabled || mode !== "screenshot") return;
    let timer;
    const reveal = () => {
      setBoost(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBoost(false), 2500);
    };
    const onKey = (e) => {
      const k = (e.key || "").toLowerCase();
      const combo = (e.metaKey || e.ctrlKey) && e.shiftKey && ["s", "3", "4", "5"].includes(k);
      if (k === "printscreen" || combo) reveal();
    };
    const onBlur = () => reveal();
    const onVis = () => { if (document.hidden) reveal(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, mode]);

  if (!enabled) return null;

  const base = Math.min(0.6, Math.max(0.02, (Number(settings?.watermarkOpacity) || 10) / 100));
  const opacity = boost ? Math.min(0.75, base * 3 + 0.15) : base;
  const size = Math.min(48, Math.max(8, Number(settings?.watermarkSize) || 14));
  const text = (settings?.watermarkText || "").trim() || `${settings?.siteName || "My Study Guide"} ©`;
  const year = new Date().getFullYear();
  const label = text.includes("©") ? `${text} ${year}` : `${text} © ${year}`;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[45] select-none overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 flex w-[240vw] max-w-none -translate-x-1/2 -translate-y-1/2 rotate-[-24deg] flex-wrap justify-center gap-x-16 gap-y-16 transition-opacity duration-150"
        style={{ opacity }}
      >
        {Array.from({ length: 220 }).map((_, i) => (
          <span
            key={i}
            className="whitespace-nowrap font-bold uppercase tracking-widest text-slate-500 dark:text-slate-300"
            style={{ fontSize: `${size}px` }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
