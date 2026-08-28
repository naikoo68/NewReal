import { useEffect } from "react";
import { X, Megaphone } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

// A welcome popup shown to a client every time they open their workspace.
// It always shows a welcome heading (the site tagline) and, when the admin has
// enabled it, an announcement (title + message). Closed via the X, the
// "Get started" button, the backdrop, or the Escape key.
export default function ClientWelcomeModal({ onClose }) {
  const { settings } = useSettings();
  const ann = settings.clientAnnouncement || {};
  const showAnnouncement = ann.enabled && (ann.title?.trim() || ann.message?.trim());
  const tagline = settings.tagline || "Prepare Smart, Achieve More.";

  // Close on Escape for accessibility.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop — click to close */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      {/* Card */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-2xl ring-1 ring-white/10"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt={settings.siteName} className="h-9 w-9 rounded-xl object-cover" />
          ) : null}
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">
            Welcome{settings.siteName ? ` to ${settings.siteName}` : ""}
          </p>
        </div>

        <h2 className="mt-3 text-3xl font-extrabold leading-tight">
          <span className="bg-gradient-to-r from-brand-400 via-brand-300 to-accent-400 bg-clip-text text-transparent">
            {tagline}
          </span>
        </h2>

        {showAnnouncement && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-brand-300">
              <Megaphone className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-wide">Announcement</span>
            </div>
            {ann.title?.trim() && <h3 className="mt-1.5 font-bold text-white">{ann.title}</h3>}
            {ann.message?.trim() && (
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-200">{ann.message}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700"
        >
          Get started
        </button>
      </div>
    </div>
  );
}
