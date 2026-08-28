import { useState, useRef } from "react";
import {
  Palette, Type, ImagePlus, Save, RotateCcw, CheckCircle2, Eye, EyeOff,
  Share2, Phone, Plus, Trash2, Upload, X, Info, BarChart3, PanelTop, GripVertical, LayoutList, Megaphone, Star, Camera,
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import Avatar from "../../components/ui/Avatar";
import { fileToResizedDataUrl } from "../../lib/imageResize";

// Home-page sections (fixed set) that the admin can reorder / hide.
const HOME_ORDER = ["hero", "stats", "quickAccess", "features", "howItWorks", "testimonials", "cta"];
const HOME_SECTION_LABELS = {
  hero: "Hero (tagline & progress card)",
  stats: "Statistics",
  quickAccess: "Quick Access (Quiz / Test / Study)",
  features: "Features",
  howItWorks: "How it works",
  testimonials: "Testimonials",
  cta: "Call-to-action banner",
};

// Lightweight drag-to-reorder list that works with both mouse and touch
// (pointer + touch events) — no external dependency, works on phones.
function DragReorder({ items, onChange, renderRow }) {
  const listRef = useRef(null);
  const fromRef = useRef(null);
  const overRef = useRef(null);
  const [drag, setDrag] = useState({ from: null, over: null });

  const computeOver = (y) => {
    const rows = listRef.current?.querySelectorAll("[data-row]") || [];
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return rows.length - 1;
  };

  const start = (i) => (e) => {
    e.preventDefault();
    fromRef.current = i;
    overRef.current = i;
    setDrag({ from: i, over: i });
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const over = computeOver(y);
      overRef.current = over;
      setDrag((d) => ({ ...d, over }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      const from = fromRef.current;
      const over = overRef.current;
      if (from != null && over != null && from !== over) {
        const next = [...items];
        const [m] = next.splice(from, 1);
        next.splice(over, 0, m);
        onChange(next);
      }
      fromRef.current = null;
      overRef.current = null;
      setDrag({ from: null, over: null });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  return (
    <div ref={listRef} className="space-y-2">
      {items.map((item, i) => (
        <div
          key={item.key || i}
          data-row
          className={`flex items-center gap-3 rounded-xl border p-3 transition ${drag.from === i ? "opacity-50" : ""} ${
            drag.over === i && drag.from !== null && drag.from !== i ? "border-brand-500 ring-1 ring-brand-400" : "border-slate-200 dark:border-slate-700"
          }`}
        >
          <button type="button" onPointerDown={start(i)} title="Drag to reorder" className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing">
            <GripVertical className="h-5 w-5" />
          </button>
          {renderRow(item, i)}
        </div>
      ))}
    </div>
  );
}

// Live-count metrics an admin can bind a statistic row to.
const STAT_METRICS = [
  { key: "students", label: "Students (live)" },
  { key: "users", label: "All Users (live)" },
  { key: "quizzes", label: "Quizzes (live)" },
  { key: "tests", label: "Test Series (live)" },
  { key: "questions", label: "Questions (live)" },
  { key: "subjects", label: "Subjects (live)" },
  { key: "topics", label: "Topics (live)" },
  { key: "streams", label: "Streams (live)" },
  { key: "attempts", label: "Attempts (live)" },
];
import { FONT_OPTIONS } from "../../lib/theme";
import { SOCIAL_PLATFORMS } from "../../components/ui/SocialIcons";

const PRIMARY_PRESETS = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#db2777", "#e11d48"];
const ACCENT_PRESETS = ["#f97316", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444"];
const CONTACT_TYPES = ["email", "phone", "address"];

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
  socialLinks: [
    { platform: "facebook", url: "" },
    { platform: "instagram", url: "" },
    { platform: "whatsapp", url: "" },
    { platform: "youtube", url: "" },
  ],
  contacts: [
    { type: "email", value: "hello@mystudyguide.com" },
    { type: "phone", value: "+91 98765 43210" },
    { type: "address", value: "Knowledge Park, New Delhi, India" },
  ],
  aboutHeading: "Built by educators, loved by toppers",
  aboutIntro:
    "My Study Guide started with one belief — that smart, structured practice beats endless cramming. We combine curated question banks with real-time analytics to help you study exactly what matters.",
  aboutValues: [
    { title: "Our Mission", desc: "Make high-quality exam preparation accessible and affordable for every student." },
    { title: "Our Vision", desc: "Become the most trusted self-study companion powered by data-driven learning." },
    { title: "Our Promise", desc: "Honest content, transparent analytics and relentless focus on student outcomes." },
  ],
  statsAuto: true,
  clientAnnouncement: { enabled: false, title: "", message: "" },
  homeSections: HOME_ORDER.map((key) => ({ key, visible: true })),
  testimonials: [
    { name: "Aisha Khan", exam: "Cleared SSC CGL 2025", rating: 5, text: "The subject-wise quizzes and instant solutions made my revision so much faster." },
    { name: "Rahul Verma", exam: "NEET Aspirant", rating: 5, text: "Full-length mock tests feel just like the real exam — timers, palette and auto-submit." },
    { name: "Sneha Patil", exam: "State PSC 2025", rating: 5, text: "I love that I can practise for free and track my rank. It kept me motivated every day." },
  ],
  aboutStats: [
    { value: "1,20,000+", label: "Total Students" },
    { value: "8,500+", label: "Total Quizzes" },
    { value: "640+", label: "Total Test Series" },
  ],
};

// Merge saved home layout with the full known set (append missing, drop unknown).
function normalizeHomeSections(saved) {
  const list = Array.isArray(saved) ? saved.filter((s) => HOME_ORDER.includes(s.key)) : [];
  const keys = list.map((s) => s.key);
  return [...list, ...HOME_ORDER.filter((k) => !keys.includes(k)).map((k) => ({ key: k, visible: true }))];
}

export default function AdminCustomization() {
  const { settings, save } = useSettings();
  const [form, setForm] = useState({
    ...DEFAULTS,
    ...settings,
    socialLinks: settings.socialLinks?.length ? settings.socialLinks : DEFAULTS.socialLinks,
    contacts: settings.contacts?.length ? settings.contacts : DEFAULTS.contacts,
    aboutValues: settings.aboutValues?.length ? settings.aboutValues : DEFAULTS.aboutValues,
    aboutStats: settings.aboutStats?.length ? settings.aboutStats : DEFAULTS.aboutStats,
    testimonials: settings.testimonials?.length ? settings.testimonials : DEFAULTS.testimonials,
    clientAnnouncement: { ...DEFAULTS.clientAnnouncement, ...(settings.clientAnnouncement || {}) },
    homeSections: normalizeHomeSections(settings.homeSections),
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  // ---- Social links ----
  const addSocial = () => set("socialLinks", [...form.socialLinks, { platform: "website", url: "" }]);
  const updateSocial = (i, key, val) =>
    set("socialLinks", form.socialLinks.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  const removeSocial = (i) => set("socialLinks", form.socialLinks.filter((_, idx) => idx !== i));

  // ---- Contacts ----
  const addContact = () => set("contacts", [...form.contacts, { type: "email", value: "" }]);
  const updateContact = (i, key, val) =>
    set("contacts", form.contacts.map((c, idx) => (idx === i ? { ...c, [key]: val } : c)));
  const removeContact = (i) => set("contacts", form.contacts.filter((_, idx) => idx !== i));

  // ---- About: value cards ----
  const addValue = () => set("aboutValues", [...form.aboutValues, { title: "", desc: "" }]);
  const updateValue = (i, key, val) =>
    set("aboutValues", form.aboutValues.map((v, idx) => (idx === i ? { ...v, [key]: val } : v)));
  const removeValue = (i) => set("aboutValues", form.aboutValues.filter((_, idx) => idx !== i));

  // ---- Testimonials ----
  const addTestimonial = () => set("testimonials", [...form.testimonials, { name: "", exam: "", text: "", rating: 5 }]);
  const updateTestimonial = (i, key, val) =>
    set("testimonials", form.testimonials.map((t, idx) => (idx === i ? { ...t, [key]: val } : t)));
  const removeTestimonial = (i) => set("testimonials", form.testimonials.filter((_, idx) => idx !== i));
  const onTestimonialPhoto = async (i, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { updateTestimonial(i, "photo", await fileToResizedDataUrl(file, 200, 0.85)); } catch { /* ignore */ }
  };

  // ---- Home layout ----
  const toggleSection = (i) =>
    set("homeSections", form.homeSections.map((s, idx) => (idx === i ? { ...s, visible: s.visible === false ? true : false } : s)));

  // ---- About: stats ----
  const addStat = () => set("aboutStats", [...form.aboutStats, { value: "", label: "", metric: "students" }]);
  const updateStat = (i, key, val) =>
    set("aboutStats", form.aboutStats.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  const removeStat = (i) => set("aboutStats", form.aboutStats.filter((_, idx) => idx !== i));

  // ---- Logo file → base64 ----
  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please choose an image file."); return; }
    if (file.size > 800 * 1024) { setError("Logo must be under 800 KB. Try a smaller image."); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = () => set("logoUrl", reader.result);
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        socialLinks: form.socialLinks.filter((s) => s.url && s.url.trim() && s.url !== "#"),
        contacts: form.contacts.filter((c) => c.value && c.value.trim()),
        aboutValues: form.aboutValues.filter((v) => v.title?.trim() || v.desc?.trim()),
        aboutStats: form.aboutStats.filter((s) => s.value?.trim() || s.label?.trim()),
        testimonials: form.testimonials.filter((t) => t.text?.trim() || t.name?.trim()),
      };
      await save(payload);
      flash("Saved! Your changes are now live across the site.");
    } catch (err) {
      setError(err.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    setForm(DEFAULTS);
    setSaving(true);
    try {
      await save(DEFAULTS);
      flash("Reset to default theme.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const Swatch = ({ value, onPick, presets }) => (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => (
        <button type="button" key={c} onClick={() => onPick(c)} style={{ background: c }}
          className={`h-9 w-9 rounded-lg ring-offset-2 transition dark:ring-offset-slate-900 ${value === c ? "ring-2 ring-slate-900 dark:ring-white" : ""}`} />
      ))}
      <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 dark:border-slate-700" />
      <span className="text-xs font-mono text-slate-500">{value}</span>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Customization</h1>
          <p className="text-slate-500 dark:text-slate-400">Branding, colours, font, logo, social profiles and contact details. Changes apply everywhere.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={resetDefaults} className="btn-outline"><RotateCcw className="h-4 w-4" /> Reset</button>
          <button type="submit" disabled={saving} className="btn-primary"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Changes"}</button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Branding + Logo upload */}
        <div className="card p-6">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><ImagePlus className="h-5 w-5 text-brand-600" /> Branding</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Website Name</label>
              <input className="input" value={form.siteName} onChange={(e) => set("siteName", e.target.value)} placeholder="My Study Guide" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Tagline</label>
              <input className="input" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Logo (upload an image)</label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
                  {form.logoUrl ? <img src={form.logoUrl} alt="logo" className="h-full w-full object-cover" /> : (form.siteName || "M")[0]}
                </div>
                <label className="btn-outline cursor-pointer">
                  <Upload className="h-4 w-4" /> Upload Image
                  <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
                </label>
                {form.logoUrl && (
                  <button type="button" onClick={() => set("logoUrl", "")} className="btn-ghost text-rose-600">
                    <X className="h-4 w-4" /> Remove
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400">PNG/JPG/SVG under 800 KB. Leave empty to use the default icon.</p>
            </div>
          </div>
        </div>

        {/* Font */}
        <div className="card p-6">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><Type className="h-5 w-5 text-violet-500" /> Font</h3>
          <label className="mb-1.5 block text-sm font-medium">Font Family</label>
          <select className="input" value={form.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
            {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-lg dark:bg-slate-800/60" style={{ fontFamily: `'${form.fontFamily}', sans-serif` }}>
            The quick brown fox jumps over the lazy dog. 1234567890
          </p>
        </div>

        {/* Client welcome popup */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-1 flex items-center gap-2 font-bold"><Megaphone className="h-5 w-5 text-brand-600" /> Client welcome popup</h3>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            A popup shown to clients <span className="font-semibold">every time</span> they open their workspace. It always shows a welcome heading (your tagline); add an optional announcement below.
          </p>
          <label className="mb-4 flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={!!form.clientAnnouncement?.enabled}
              onChange={(e) => set("clientAnnouncement", { ...form.clientAnnouncement, enabled: e.target.checked })}
            />
            <span className="text-sm font-medium">Show an announcement inside the welcome popup</span>
          </label>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Announcement title</label>
              <input
                className="input"
                value={form.clientAnnouncement?.title || ""}
                onChange={(e) => set("clientAnnouncement", { ...form.clientAnnouncement, title: e.target.value })}
                placeholder="e.g. New: AI Generator is live!"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Announcement message</label>
              <textarea
                className="input min-h-[110px]"
                value={form.clientAnnouncement?.message || ""}
                onChange={(e) => set("clientAnnouncement", { ...form.clientAnnouncement, message: e.target.value })}
                placeholder="Write the message clients will see in the popup…"
              />
            </div>
            <p className="text-xs text-slate-400">The announcement appears only when enabled and has a title or message. Line breaks are preserved.</p>
          </div>
        </div>

        {/* Colours */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><Palette className="h-5 w-5 text-accent-500" /> Theme Colours</h3>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">Primary colour</label>
              <Swatch value={form.primaryColor} onPick={(c) => set("primaryColor", c)} presets={PRIMARY_PRESETS} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Accent colour</label>
              <Swatch value={form.accentColor} onPick={(c) => set("accentColor", c)} presets={ACCENT_PRESETS} />
            </div>
          </div>
          <div className="mt-6 rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500"><Eye className="h-4 w-4" /> Live preview</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.accentColor})` }}>
                {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-cover" /> : (form.siteName || "M")[0]}
              </span>
              <span className="text-lg font-extrabold">{form.siteName || "My Study Guide"}</span>
              <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: form.primaryColor }}>Primary button</button>
              <button type="button" className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: form.accentColor }}>Accent button</button>
            </div>
          </div>
        </div>

        {/* Navbar appearance */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><PanelTop className="h-5 w-5 text-brand-600" /> Navbar (Header)</h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Height: <span className="font-mono text-brand-600">{form.navHeight}px</span></label>
              <input type="range" min="48" max="120" step="2" value={form.navHeight} onChange={(e) => set("navHeight", Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Site name size: <span className="font-mono text-brand-600">{form.navBrandSize}px</span></label>
              <input type="range" min="14" max="34" step="1" value={form.navBrandSize} onChange={(e) => set("navBrandSize", Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Menu link size: <span className="font-mono text-brand-600">{form.navFontSize}px</span></label>
              <input type="range" min="11" max="22" step="1" value={form.navFontSize} onChange={(e) => set("navFontSize", Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Menu link weight</label>
              <select className="input" value={form.navFontWeight} onChange={(e) => set("navFontWeight", e.target.value)}>
                <option value="400">Normal</option>
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Menu font</label>
              <select className="input" value={form.navFontFamily} onChange={(e) => set("navFontFamily", e.target.value)}>
                <option value="">Default (site font)</option>
                {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Text style</label>
              <select className="input" value={form.navTextTransform} onChange={(e) => set("navTextTransform", e.target.value)}>
                <option value="none">Normal</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="capitalize">Capitalize</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Default page zoom: <span className="font-mono text-brand-600">{form.defaultZoom}%</span></label>
              <input type="range" min="50" max="200" step="5" value={form.defaultZoom} onChange={(e) => set("defaultZoom", Number(e.target.value))} className="w-full accent-brand-600" />
              <p className="mt-1 text-xs text-slate-400">Zoom new visitors start at (they can still change it themselves).</p>
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
            <p className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60"><Eye className="h-4 w-4" /> Live preview</p>
            <div
              className="flex items-center justify-between gap-4 bg-white px-5 dark:bg-slate-950"
              style={{ minHeight: `${form.navHeight}px`, fontFamily: `'${form.navFontFamily || form.fontFamily}', sans-serif` }}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.accentColor})` }}>
                  {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" /> : (form.siteName || "M")[0]}
                </span>
                <span className="font-extrabold tracking-tight" style={{ fontSize: `${form.navBrandSize}px` }}>{form.siteName || "My Study Guide"}</span>
              </div>
              <div className="hidden items-center gap-4 sm:flex">
                {["Home", "Quiz", "Test Series", "About"].map((t, i) => (
                  <span key={t} style={{ fontSize: `${form.navFontSize}px`, fontWeight: Number(form.navFontWeight), textTransform: form.navTextTransform, color: i === 0 ? form.primaryColor : undefined }} className={i === 0 ? "" : "text-slate-600 dark:text-slate-300"}>
                    {t}
                  </span>
                ))}
                <span className="rounded-lg px-3 py-1.5 text-white" style={{ background: form.primaryColor, fontSize: `${form.navFontSize}px`, fontWeight: Number(form.navFontWeight) }}>Login</span>
              </div>
            </div>
          </div>
        </div>

        {/* Home page layout */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-1 flex items-center gap-2 font-bold"><LayoutList className="h-5 w-5 text-brand-600" /> Home Page Layout</h3>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Drag the sections by the handle to reorder how the home page appears, and toggle any section on or off.</p>
          <DragReorder
            items={form.homeSections}
            onChange={(next) => set("homeSections", next)}
            renderRow={(s, i) => (
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="font-medium">{HOME_SECTION_LABELS[s.key] || s.key}</span>
                <button
                  type="button"
                  onClick={() => toggleSection(i)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    s.visible === false ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  }`}
                >
                  {s.visible === false ? <><EyeOff className="h-3.5 w-3.5" /> Hidden</> : <><Eye className="h-3.5 w-3.5" /> Visible</>}
                </button>
              </div>
            )}
          />
        </div>

        {/* Screenshot watermark */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><Info className="h-5 w-5 text-brand-600" /> Watermark &amp; Content Protection</h3>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">A tiled watermark is drawn over quiz &amp; test pages so screenshots carry your copyright mark.</p>
          <label className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <input type="checkbox" checked={form.restrictCopy} onChange={(e) => set("restrictCopy", e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>
              <span className="text-sm font-semibold">Restrict copying for students</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">Disables text selection, right-click and copy/cut for students &amp; guests (admins are unaffected).</span>
            </span>
          </label>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1.5 block text-sm font-medium">Watermark text</label>
              <input className="input" value={form.watermarkText} onChange={(e) => set("watermarkText", e.target.value)} placeholder={`${form.siteName || "My Study Guide"} ©`} />
              <p className="mt-1 text-xs text-slate-400">Blank = "{form.siteName || "My Study Guide"} ©". The year is added automatically.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Show watermark</label>
              <select className="input" value={form.watermarkEnabled ? "1" : "0"} onChange={(e) => set("watermarkEnabled", e.target.value === "1")}>
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Mode</label>
              <select className="input" value={form.watermarkMode} onChange={(e) => set("watermarkMode", e.target.value)}>
                <option value="always">Always on (works on all devices)</option>
                <option value="screenshot">Always on + stronger on desktop screenshot</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">The watermark is always present — phones can't notify the site of a screenshot, so it must stay on to be captured.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Opacity: <span className="font-mono text-brand-600">{form.watermarkOpacity}%</span></label>
              <input type="range" min="2" max="60" step="1" value={form.watermarkOpacity} onChange={(e) => set("watermarkOpacity", Number(e.target.value))} className="w-full accent-brand-600" />
              <p className="mt-1 text-xs text-slate-400">Raise this until it's visible on your theme (≈15–30% shows well on dark screens).</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Text size: <span className="font-mono text-brand-600">{form.watermarkSize}px</span></label>
              <input type="range" min="8" max="48" step="1" value={form.watermarkSize} onChange={(e) => set("watermarkSize", Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
          </div>
        </div>

        {/* Social profiles */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold"><Share2 className="h-5 w-5 text-brand-600" /> Social Profiles</h3>
            <button type="button" onClick={addSocial} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add</button>
          </div>
          <div className="space-y-3">
            {form.socialLinks.length === 0 && <p className="text-sm text-slate-400">No social profiles. Click “Add”.</p>}
            {form.socialLinks.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={s.platform} onChange={(e) => updateSocial(i, "platform", e.target.value)} className="input w-36 capitalize">
                  {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input value={s.url} onChange={(e) => updateSocial(i, "url", e.target.value)} className="input flex-1" placeholder="https://..." />
                <button type="button" onClick={() => removeSocial(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Contact details */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold"><Phone className="h-5 w-5 text-accent-500" /> Contact Details</h3>
            <button type="button" onClick={addContact} className="btn-outline py-2"><Plus className="h-4 w-4" /> Add</button>
          </div>
          <div className="space-y-3">
            {form.contacts.length === 0 && <p className="text-sm text-slate-400">No contact details. Click “Add”.</p>}
            {form.contacts.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={c.type} onChange={(e) => updateContact(i, "type", e.target.value)} className="input w-32 capitalize">
                  {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={c.value} onChange={(e) => updateContact(i, "value", e.target.value)} className="input flex-1" placeholder={c.type === "email" ? "you@example.com" : c.type === "phone" ? "+91 ..." : "Address"} />
                <button type="button" onClick={() => removeContact(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* About page content */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-bold"><Info className="h-5 w-5 text-brand-600" /> About Us Page</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Heading</label>
              <input className="input" value={form.aboutHeading} onChange={(e) => set("aboutHeading", e.target.value)} placeholder="Built by educators, loved by toppers" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Intro paragraph</label>
              <textarea rows={3} className="input resize-none" value={form.aboutIntro} onChange={(e) => set("aboutIntro", e.target.value)} />
            </div>

            {/* Value cards */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Value cards (Mission / Vision / Promise…)</label>
                <button type="button" onClick={addValue} className="btn-outline py-1.5"><Plus className="h-4 w-4" /> Add</button>
              </div>
              <div className="space-y-3">
                {form.aboutValues.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex-1 space-y-2">
                      <input className="input" value={v.title} onChange={(e) => updateValue(i, "title", e.target.value)} placeholder="Card title (e.g. Our Mission)" />
                      <textarea rows={2} className="input resize-none" value={v.desc} onChange={(e) => updateValue(i, "desc", e.target.value)} placeholder="Short description" />
                    </div>
                    <button type="button" onClick={() => removeValue(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm font-medium"><BarChart3 className="h-4 w-4" /> Statistics (shown on Home &amp; About)</label>
                <button type="button" onClick={addStat} className="btn-outline py-1.5"><Plus className="h-4 w-4" /> Add</button>
              </div>
              <label className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input type="checkbox" checked={form.statsAuto} onChange={(e) => set("statsAuto", e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <span className="text-sm font-semibold">Automatic (live) statistics</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">On: each row shows the real live count of the metric you pick (auto-updates). Off: use the manual values you enter.</span>
                </span>
              </label>
              <div className="mt-2 space-y-2">
                {form.aboutStats.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {form.statsAuto ? (
                      <select className="input w-44" value={s.metric || "students"} onChange={(e) => updateStat(i, "metric", e.target.value)}>
                        {STAT_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    ) : (
                      <input className="input w-40" value={s.value} onChange={(e) => updateStat(i, "value", e.target.value)} placeholder="Value (e.g. 1,20,000+)" />
                    )}
                    <input className="input flex-1" value={s.label} onChange={(e) => updateStat(i, "label", e.target.value)} placeholder="Label (e.g. Students)" />
                    <button type="button" onClick={() => removeStat(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              {form.statsAuto && <p className="mt-2 text-xs text-slate-400">Pick a metric per row and give it a label. Add as many as you like — every one updates automatically from the live database.</p>}
            </div>
          </div>
        </div>

        {/* Testimonials */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold"><Star className="h-5 w-5 text-amber-500" /> Testimonials (Home page)</h3>
            <button type="button" onClick={addTestimonial} className="btn-outline py-1.5"><Plus className="h-4 w-4" /> Add</button>
          </div>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Real student reviews build trust. Add a few with the exam they cleared. To hide the whole section, remove them all or toggle "Testimonials" off in the Home layout above.</p>
          <div className="space-y-3">
            {form.testimonials.map((t, i) => (
              <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-col items-center gap-1">
                  <label className="group relative cursor-pointer" title="Add photo">
                    <Avatar src={t.photo} name={t.name} size={48} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100">
                      <Camera className="h-4 w-4 text-white" />
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => onTestimonialPhoto(i, e)} />
                  </label>
                  {t.photo ? (
                    <button type="button" onClick={() => updateTestimonial(i, "photo", "")} className="text-[10px] text-rose-600 hover:underline">Remove</button>
                  ) : null}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className="input sm:flex-1" value={t.name} onChange={(e) => updateTestimonial(i, "name", e.target.value)} placeholder="Student name" />
                    <input className="input sm:flex-1" value={t.exam} onChange={(e) => updateTestimonial(i, "exam", e.target.value)} placeholder="Exam / role (e.g. Cleared SSC CGL 2025)" />
                    <select className="input sm:w-32" value={t.rating || 5} onChange={(e) => updateTestimonial(i, "rating", Number(e.target.value))}>
                      {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ★</option>)}
                    </select>
                  </div>
                  <textarea rows={2} className="input resize-none" value={t.text} onChange={(e) => updateTestimonial(i, "text", e.target.value)} placeholder="What the student said…" />
                </div>
                <button type="button" onClick={() => removeTestimonial(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-slate-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {toast}
        </div>
      )}
    </form>
  );
}
