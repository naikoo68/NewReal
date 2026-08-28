// ---------------------------------------------------------------------------
// Template registry — data only (no JSX). A single <ResumeDocument> renderer
// reads one of these `style` presets, so adding a new template is just adding a
// preset object here (no new component needed). This is how we scale to 30+
// ATS-friendly templates without duplicating layout code.
// ---------------------------------------------------------------------------

// Selectable fonts (web-safe stacks so they render/print identically offline).
export const FONTS = [
  { id: "Inter", label: "Inter / Sans", css: "Inter, 'Segoe UI', Roboto, Arial, sans-serif" },
  { id: "Roboto", label: "Roboto", css: "Roboto, 'Segoe UI', Arial, sans-serif" },
  { id: "Georgia", label: "Georgia / Serif", css: "Georgia, 'Times New Roman', serif" },
  { id: "Garamond", label: "Garamond", css: "'EB Garamond', Garamond, Georgia, serif" },
  { id: "Times", label: "Times", css: "'Times New Roman', Times, serif" },
  { id: "Arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { id: "Calibri", label: "Calibri", css: "Calibri, 'Segoe UI', Arial, sans-serif" },
  { id: "Courier", label: "Courier / Mono", css: "'Courier New', Courier, monospace" },
];
export const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

// Style schema (all optional, sensible defaults in the renderer):
//   columns      1 | 2            — one column, or a sidebar layout
//   sidebar      "left" | "right" — which side the sidebar sits on (2-col)
//   headerAlign  "left" | "center"
//   titleStyle   "bar" | "underline" | "caps" | "plain"
//   accent       default accent hex (user can override in the toolbar)
//   serif        boolean           — default font is a serif stack
//   density      "cozy" | "compact"
//   uppercaseName boolean
//   showPhoto    boolean           — render the profile photo when provided
export const TEMPLATES = [
  { id: "classic",      name: "Classic",              style: { columns: 1, headerAlign: "left",   titleStyle: "underline", accent: "#1f2937", serif: true,  density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "boxed-pro",    name: "Professional Boxed",   style: { variant: "boxed", columns: 1, headerAlign: "left", titleStyle: "plain", accent: "#2563eb", serif: false, density: "cozy", uppercaseName: false, showPhoto: true } },
  { id: "modern",       name: "Modern",               style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#2563eb", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "professional", name: "Professional",         style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "caps", accent: "#0f766e", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "creative",     name: "Creative",             style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "bar",  accent: "#7c3aed", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "minimal",      name: "Minimal",              style: { columns: 1, headerAlign: "left",   titleStyle: "plain",     accent: "#111827", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "executive",    name: "Executive",            style: { columns: 1, headerAlign: "center", titleStyle: "caps",      accent: "#111827", serif: true,  density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "academic",     name: "Academic",             style: { columns: 1, headerAlign: "center", titleStyle: "underline", accent: "#334155", serif: true,  density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "simple",       name: "Simple",               style: { columns: 1, headerAlign: "left",   titleStyle: "plain",     accent: "#374151", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "elegant",      name: "Elegant",              style: { columns: 1, headerAlign: "center", titleStyle: "underline", accent: "#9d174d", serif: true,  density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "compact",      name: "Compact",              style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#0369a1", serif: false, density: "compact", uppercaseName: false, showPhoto: false } },
  { id: "sidebar-blue", name: "Sidebar Blue",         style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "bar",  accent: "#1d4ed8", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "sidebar-right",name: "Sidebar Right",        style: { columns: 2, sidebar: "right", headerAlign: "left", titleStyle: "caps", accent: "#b45309", serif: false, density: "cozy",    uppercaseName: false, showPhoto: true } },
  { id: "teal-modern",  name: "Teal Modern",          style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#0d9488", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "slate-serif",  name: "Slate Serif",          style: { columns: 1, headerAlign: "left",   titleStyle: "underline", accent: "#475569", serif: true,  density: "compact", uppercaseName: false, showPhoto: false } },
  { id: "onyx",         name: "Onyx",                 style: { columns: 1, headerAlign: "left",   titleStyle: "caps",      accent: "#000000", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "crimson",      name: "Crimson",              style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#dc2626", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "forest",       name: "Forest",               style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "caps", accent: "#15803d", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "indigo",       name: "Indigo",               style: { columns: 1, headerAlign: "left",   titleStyle: "underline", accent: "#4f46e5", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "graphite",     name: "Graphite",             style: { columns: 1, headerAlign: "left",   titleStyle: "plain",     accent: "#4b5563", serif: false, density: "compact", uppercaseName: false, showPhoto: false } },
  { id: "royal",        name: "Royal",                style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "bar",  accent: "#1e40af", serif: true,  density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "sunset",       name: "Sunset",               style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#ea580c", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "emerald",      name: "Emerald",              style: { columns: 2, sidebar: "right", headerAlign: "left", titleStyle: "caps", accent: "#059669", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "navy-exec",    name: "Navy Executive",       style: { columns: 1, headerAlign: "center", titleStyle: "caps",      accent: "#1e3a8a", serif: true,  density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "rose-elegant", name: "Rose Elegant",         style: { columns: 1, headerAlign: "center", titleStyle: "underline", accent: "#be185d", serif: true,  density: "cozy",    uppercaseName: true,  showPhoto: false } },
  { id: "mono-tech",    name: "Mono Tech",            style: { columns: 1, headerAlign: "left",   titleStyle: "plain",     accent: "#111827", serif: false, density: "compact", uppercaseName: false, showPhoto: false } },
  { id: "plum",         name: "Plum",                 style: { columns: 2, sidebar: "left",  headerAlign: "left", titleStyle: "bar",  accent: "#86198f", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "steel",        name: "Steel",                style: { columns: 1, headerAlign: "left",   titleStyle: "underline", accent: "#64748b", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
  { id: "amber-compact",name: "Amber Compact",        style: { columns: 1, headerAlign: "left",   titleStyle: "bar",       accent: "#d97706", serif: false, density: "compact", uppercaseName: false, showPhoto: false } },
  { id: "cobalt-side",  name: "Cobalt Sidebar",       style: { columns: 2, sidebar: "right", headerAlign: "left", titleStyle: "bar",  accent: "#1746a2", serif: false, density: "cozy",    uppercaseName: true,  showPhoto: true } },
  { id: "sage",         name: "Sage",                 style: { columns: 1, headerAlign: "left",   titleStyle: "plain",     accent: "#4d7c0f", serif: false, density: "cozy",    uppercaseName: false, showPhoto: false } },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
