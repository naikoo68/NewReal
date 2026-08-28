import { GraduationCap } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

// Renders the site logo + name from admin-configurable settings.
export default function Brand({ light = false, textClass = "text-lg", nameStyle }) {
  const { settings } = useSettings();
  return (
    <span className="flex items-center gap-2">
      {settings.logoUrl ? (
        <img
          src={settings.logoUrl}
          alt={settings.siteName}
          className="h-9 w-9 rounded-xl object-cover"
        />
      ) : (
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-soft ${
            light ? "bg-white/15 text-white" : "bg-gradient-to-br from-brand-600 to-accent-500 text-white"
          }`}
        >
          <GraduationCap className="h-5 w-5" />
        </span>
      )}
      <span className={`font-extrabold tracking-tight ${textClass}`} style={nameStyle}>{settings.siteName}</span>
    </span>
  );
}
