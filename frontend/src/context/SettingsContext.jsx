import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { settingsService } from "../services";
import { applyTheme } from "../lib/theme";
import { applyBranding } from "../lib/branding";

const SettingsContext = createContext();

// Built-in Google OAuth Web Client ID for "Back up / Restore to Google Drive".
// WHITE-LABEL BUYERS: replace the value below with your own Client ID from
// Google Cloud Console (or set VITE_GOOGLE_CLIENT_ID in your hosting env, which
// overrides this). Leave it as "" to disable the built-in default and manage the
// Client ID from Admin → Backup & Restore instead.
const DEFAULT_GOOGLE_CLIENT_ID = "127205537308-lic1g1e6lvk03ee4qe3ch75k9effenl0.apps.googleusercontent.com";
const ENV_GOOGLE_CLIENT_ID = String(
  import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID || ""
).trim();

// Merge server/cached settings over the defaults. The built-in Client ID (env
// var, else the constant above) always wins, so an old/wrong value left in the
// database can never break Google Drive sign-in.
function withDefaults(s = {}) {
  const merged = { ...DEFAULTS, ...s };
  if (ENV_GOOGLE_CLIENT_ID) merged.googleClientId = ENV_GOOGLE_CLIENT_ID;
  return merged;
}

const DEFAULTS = {
  siteName: "My Study Guide",
  tagline: "Prepare Smart, Achieve More.",
  logoUrl: "",
  primaryColor: "#2563eb",
  accentColor: "#f97316",
  fontFamily: "Inter",
  navHeight: 64,
  navBrandSize: 18,
  navFontSize: 14,
  navFontWeight: "500",
  navFontFamily: "",
  navTextTransform: "none",
  defaultZoom: 80,
  watermarkEnabled: true,
  watermarkText: "",
  watermarkOpacity: 10,
  watermarkSize: 14,
  watermarkMode: "always",
  restrictCopy: true,
  screenshotGuard: false,
  guardHoldMs: 1500,
  statsAuto: true,
  notifyOnNewContent: false,
  googleClientId: "",
  homeSections: [
    { key: "hero", visible: true },
    { key: "stats", visible: true },
    { key: "quickAccess", visible: true },
    { key: "features", visible: true },
    { key: "howItWorks", visible: true },
    { key: "testimonials", visible: true },
    { key: "cta", visible: true },
  ],
  testimonials: [],
  socialLinks: [],
  contacts: [],
  aboutHeading: "Built by educators, loved by toppers",
  aboutIntro:
    "My Study Guide started with one belief — that smart, structured practice beats endless cramming. We combine curated question banks with real-time analytics to help you study exactly what matters.",
  aboutValues: [
    { title: "Our Mission", desc: "Make high-quality exam preparation accessible and affordable for every student." },
    { title: "Our Vision", desc: "Become the most trusted self-study companion powered by data-driven learning." },
    { title: "Our Promise", desc: "Honest content, transparent analytics and relentless focus on student outcomes." },
  ],
  aboutStats: [
    { value: "1,20,000+", label: "Total Students" },
    { value: "8,500+", label: "Total Quizzes" },
    { value: "640+", label: "Total Test Series" },
  ],
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    const cached = localStorage.getItem("msg-settings");
    return withDefaults(cached ? JSON.parse(cached) : {});
  });

  const apply = useCallback((s) => {
    setSettings(s);
    localStorage.setItem("msg-settings", JSON.stringify(s));
    applyTheme(s);
    applyBranding(s);
  }, []);

  // Apply cached theme immediately, then refresh from the server.
  useEffect(() => {
    applyTheme(settings);
    applyBranding(settings);
    settingsService
      .get()
      .then((s) => apply(withDefaults(s)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin save
  const save = async (patch) => {
    const updated = await settingsService.update(patch);
    apply(withDefaults(updated));
    return updated;
  };

  return (
    <SettingsContext.Provider value={{ settings, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  return useContext(SettingsContext);
}
