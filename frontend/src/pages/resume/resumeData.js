// ---------------------------------------------------------------------------
// Resume Builder — data layer (structured JSON, storage, import/export, ATS).
// Everything the builder needs is a single plain-JSON `resume` object, so it's
// trivial to persist, export, import, and render from any template.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "mstg.resume.v1";

const uid = () => Math.random().toString(36).slice(2, 10);

// Factory helpers for each repeatable entry — used by "Add" buttons.
export const factories = {
  experience: () => ({ id: uid(), role: "", company: "", location: "", start: "", end: "", current: false, bullets: [""] }),
  education: () => ({ id: uid(), degree: "", school: "", location: "", start: "", end: "", score: "", details: "" }),
  skills: () => ({ id: uid(), name: "", level: "" }),
  projects: () => ({ id: uid(), name: "", link: "", description: "", bullets: [""] }),
  certifications: () => ({ id: uid(), name: "", issuer: "", date: "", link: "" }),
  languages: () => ({ id: uid(), name: "", level: "" }),
  references: () => ({ id: uid(), name: "", relation: "", contact: "" }),
  interests: () => ({ id: uid(), name: "" }),
};

// The order + labels of resume sections (drives nav, visibility, rendering).
export const SECTIONS = [
  { key: "summary", label: "Profile Summary" },
  { key: "experience", label: "Work Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
  { key: "projects", label: "Projects" },
  { key: "certifications", label: "Certifications" },
  { key: "languages", label: "Languages" },
  { key: "references", label: "References" },
  { key: "interests", label: "Interests" },
];

export function emptyResume() {
  return {
    meta: { name: "My Resume", updatedAt: Date.now() },
    // Look & feel — read by every template.
    theme: { templateId: "classic", accent: "#2563eb", font: "Inter", fontScale: 1, language: "en" },
    // Which sections show, and in what order (drag/reorder updates this).
    layout: { order: SECTIONS.map((s) => s.key), hidden: {} },
    personal: { fullName: "", title: "", email: "", phone: "", location: "", website: "", linkedin: "", github: "", photo: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
    references: [],
    interests: [],
    // Optional cover letter (separate document that shares the header/theme).
    coverLetter: { enabled: false, recipient: "", company: "", body: "" },
  };
}

// A filled-in sample so a first-time user sees a real resume immediately.
export function sampleResume() {
  const r = emptyResume();
  r.meta.name = "Sample Resume";
  r.personal = {
    fullName: "Aarav Sharma", title: "Full-Stack Developer",
    email: "aarav.sharma@example.com", phone: "+91 98765 43210",
    location: "Bengaluru, India", website: "aaravsharma.dev",
    linkedin: "linkedin.com/in/aaravsharma", github: "github.com/aaravsharma", photo: "",
  };
  r.summary = "Full-stack developer with 5+ years building scalable web apps in React and Node.js. Shipped products used by 100k+ users and cut page-load time by 40%. Strong on clean architecture, testing, and mentoring.";
  r.experience = [
    { id: uid(), role: "Senior Software Engineer", company: "TechNova", location: "Bengaluru", start: "2022", end: "", current: true,
      bullets: ["Led a team of 4 to rebuild the billing platform, increasing throughput by 3x.", "Reduced API latency 40% by introducing caching and query optimization.", "Mentored 3 junior engineers to mid-level."] },
    { id: uid(), role: "Software Engineer", company: "WebWorks", location: "Remote", start: "2019", end: "2022", current: false,
      bullets: ["Built a React design system adopted across 6 product teams.", "Automated CI/CD, cutting release time from 2 hours to 15 minutes."] },
  ];
  r.education = [{ id: uid(), degree: "B.Tech, Computer Science", school: "IIT Delhi", location: "New Delhi", start: "2015", end: "2019", score: "8.6 CGPA", details: "" }];
  r.skills = ["JavaScript", "React", "Node.js", "TypeScript", "PostgreSQL", "AWS", "Docker", "System Design"].map((name) => ({ id: uid(), name, level: "" }));
  r.projects = [{ id: uid(), name: "OpenBudget", link: "github.com/aaravsharma/openbudget", description: "Open-source personal finance tracker.", bullets: ["1.2k GitHub stars; 40+ contributors."] }];
  r.certifications = [{ id: uid(), name: "AWS Solutions Architect \u2013 Associate", issuer: "Amazon", date: "2023", link: "" }];
  r.languages = [{ id: uid(), name: "English", level: "Fluent" }, { id: uid(), name: "Hindi", level: "Native" }];
  r.interests = [{ id: uid(), name: "Open source" }, { id: uid(), name: "Chess" }, { id: uid(), name: "Trekking" }];
  return r;
}

// ---- Persistence (localStorage autosave / draft) --------------------------
export function loadResume() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Merge onto a fresh shape so older drafts stay valid as the model grows.
    return { ...emptyResume(), ...data, theme: { ...emptyResume().theme, ...(data.theme || {}) }, layout: { ...emptyResume().layout, ...(data.layout || {}) }, personal: { ...emptyResume().personal, ...(data.personal || {}) } };
  } catch { return null; }
}
export function saveResume(resume) {
  try {
    const toSave = { ...resume, meta: { ...(resume.meta || {}), updatedAt: Date.now() } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch { return false; }
}

// ---- Import / export as JSON ----------------------------------------------
export function exportJson(resume) {
  const blob = new Blob([JSON.stringify(resume, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(resume.meta?.name || "resume").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function importJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        resolve({ ...emptyResume(), ...data, theme: { ...emptyResume().theme, ...(data.theme || {}) }, layout: { ...emptyResume().layout, ...(data.layout || {}) }, personal: { ...emptyResume().personal, ...(data.personal || {}) } });
      } catch (e) { reject(new Error("That file isn't valid resume JSON.")); }
    };
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.readAsText(file);
  });
}

// ---- ATS score (heuristic, offline) ---------------------------------------
// A transparent 0-100 score with actionable tips — no network needed. Real
// keyword/grammar analysis (AI) is a planned enhancement; this gives an honest
// baseline that rewards the things ATS parsers and recruiters actually look for.
const ACTION_VERBS = ["led", "built", "shipped", "designed", "improved", "reduced", "increased", "launched", "created", "managed", "developed", "implemented", "optimized", "automated", "delivered", "drove", "owned", "mentored"];
export function atsScore(resume) {
  const tips = [];
  let score = 0;
  const p = resume.personal || {};
  // Contact completeness (20)
  if (p.fullName?.trim()) score += 4; else tips.push("Add your full name.");
  if (p.email?.trim()) score += 5; else tips.push("Add an email address — ATS needs it.");
  if (p.phone?.trim()) score += 4; else tips.push("Add a phone number.");
  if (p.title?.trim()) score += 3; else tips.push("Add a professional title (e.g. \u201cSoftware Engineer\u201d).");
  if (p.location?.trim()) score += 2; else tips.push("Add your city/location.");
  if (p.linkedin?.trim() || p.website?.trim() || p.github?.trim()) score += 2; else tips.push("Add a LinkedIn or portfolio link.");
  // Summary (15)
  const sw = (resume.summary || "").trim().split(/\s+/).filter(Boolean).length;
  if (sw >= 30 && sw <= 90) score += 15; else if (sw > 0) { score += 7; tips.push("Aim for a 30\u201390 word profile summary."); } else tips.push("Write a short profile summary.");
  // Experience (30)
  const exp = resume.experience || [];
  if (exp.length) {
    score += Math.min(10, exp.length * 5);
    const bullets = exp.flatMap((e) => (e.bullets || []).filter((b) => b.trim()));
    if (bullets.length >= 3) score += 8; else tips.push("Add at least 3 bullet points across your experience.");
    const withVerb = bullets.filter((b) => ACTION_VERBS.some((v) => b.toLowerCase().trim().startsWith(v))).length;
    if (bullets.length && withVerb / bullets.length >= 0.5) score += 6; else tips.push("Start bullets with action verbs (Led, Built, Reduced\u2026).");
    const quantified = bullets.filter((b) => /\d/.test(b)).length;
    if (bullets.length && quantified / bullets.length >= 0.4) score += 6; else tips.push("Quantify results with numbers (%, users, time saved).");
  } else tips.push("Add at least one work experience entry.");
  // Skills (15)
  const skills = (resume.skills || []).filter((s) => (s.name || "").trim());
  if (skills.length >= 8) score += 15; else if (skills.length) { score += 8; tips.push("List 8+ relevant skills (many ATS match on keywords)."); } else tips.push("Add a Skills section with role-relevant keywords.");
  // Education (10)
  if ((resume.education || []).some((e) => (e.degree || "").trim())) score += 10; else tips.push("Add your education.");
  // Hygiene (10)
  if (!p.photo) score += 5; else tips.push("Some ATS mis-parse photos \u2014 consider a photo-free template for online applications.");
  const total = Object.values(resume).length; // presence check
  if (total) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= 80 ? "Strong" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs work";
  return { score, band, tips: tips.slice(0, 8) };
}


// ---------------------------------------------------------------------------
// Normalisation — merge a loaded/imported object onto a fresh shape so drafts
// from older versions keep working as the model grows. (Single source of truth
// for the merge that loadResume / importJson / the doc store all rely on.)
// ---------------------------------------------------------------------------
export function normalizeResume(data) {
  const base = emptyResume();
  const d = data && typeof data === "object" ? data : {};
  return {
    ...base,
    ...d,
    meta: { ...base.meta, ...(d.meta || {}) },
    theme: { ...base.theme, ...(d.theme || {}) },
    layout: { ...base.layout, ...(d.layout || {}) },
    personal: { ...base.personal, ...(d.personal || {}) },
    coverLetter: { ...base.coverLetter, ...(d.coverLetter || {}) },
  };
}

// ---------------------------------------------------------------------------
// Multi-document store — lets users keep several resumes and duplicate them.
// Shape in localStorage: { docs: { [id]: resume }, currentId }. Migrates the
// old single-slot key (mstg.resume.v1) into the store on first use.
// ---------------------------------------------------------------------------
const DOCS_KEY = "mstg.resume.docs.v1";

function readDocsRaw() {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}
function writeDocs(store) {
  try { localStorage.setItem(DOCS_KEY, JSON.stringify(store)); return true; } catch { return false; }
}

// Returns a valid store, running one-time migration from the legacy key.
function ensureStore() {
  let store = readDocsRaw();
  if (store && store.docs && typeof store.docs === "object") return store;
  store = { docs: {}, currentId: null };
  // Migrate a legacy single resume, if present.
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      const r = normalizeResume(JSON.parse(legacy));
      const id = uid();
      r.meta.name = r.meta.name || "My Resume";
      store.docs[id] = r;
      store.currentId = id;
    }
  } catch { /* ignore */ }
  writeDocs(store);
  return store;
}

// [{ id, name, updatedAt }] most-recently-updated first.
export function listDocs() {
  const store = ensureStore();
  return Object.entries(store.docs)
    .map(([id, r]) => ({ id, name: r?.meta?.name || "Untitled", updatedAt: r?.meta?.updatedAt || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCurrentId() {
  return ensureStore().currentId;
}

export function loadDoc(id) {
  const store = ensureStore();
  const r = store.docs[id];
  return r ? normalizeResume(r) : null;
}

export function saveDoc(id, resume) {
  const store = ensureStore();
  store.docs[id] = { ...resume, meta: { ...(resume.meta || {}), updatedAt: Date.now() } };
  store.currentId = id;
  return writeDocs(store) ? store.docs[id].meta.updatedAt : 0;
}

// Create a new document from `resume` (defaults to a blank one) and select it.
export function createDoc(resume, name) {
  const store = ensureStore();
  const id = uid();
  const r = normalizeResume(resume || emptyResume());
  r.meta = { ...r.meta, name: name || r.meta?.name || "Untitled", updatedAt: Date.now() };
  store.docs[id] = r;
  store.currentId = id;
  writeDocs(store);
  return { id, resume: r };
}

// Deep-clone a resume into a brand-new document (Resume duplication).
export function duplicateDoc(resume, name) {
  const clone = JSON.parse(JSON.stringify(resume || emptyResume()));
  const base = (resume?.meta?.name || "Resume");
  return createDoc(clone, name || `${base} (copy)`);
}

// Remove a document; returns the id that should become current (or null).
export function deleteDoc(id) {
  const store = ensureStore();
  delete store.docs[id];
  if (store.currentId === id) {
    const remaining = Object.keys(store.docs);
    store.currentId = remaining[0] || null;
  }
  writeDocs(store);
  return store.currentId;
}

export function renameDoc(id, name) {
  const store = ensureStore();
  if (store.docs[id]) {
    store.docs[id].meta = { ...(store.docs[id].meta || {}), name: name || "Untitled", updatedAt: Date.now() };
    writeDocs(store);
  }
}

// ---------------------------------------------------------------------------
// i18n — section headings + a few document strings in several languages. This
// is what shows up on the printed resume/cover letter, so translating it is
// the highest-value form of "multi-language support". The form UI stays in
// English; the resume content is whatever the user types.
// ---------------------------------------------------------------------------
export const LANGS = [
  { id: "en", label: "English", rtl: false },
  { id: "es", label: "Espanol", rtl: false },
  { id: "fr", label: "Francais", rtl: false },
  { id: "de", label: "Deutsch", rtl: false },
  { id: "pt", label: "Portugues", rtl: false },
  { id: "hi", label: "Hindi", rtl: false },
  { id: "ar", label: "Arabic", rtl: true },
  { id: "zh", label: "Chinese", rtl: false },
];

export const I18N = {
  en: { profile: "Profile", experience: "Experience", education: "Education", skills: "Skills", projects: "Projects", certifications: "Certifications", languages: "Languages", references: "References", interests: "Interests", contact: "Contact", present: "Present", yourName: "Your Name", dear: "Dear", sincerely: "Sincerely", coverLetter: "Cover Letter", date: "Date" },
  es: { profile: "Perfil", experience: "Experiencia", education: "Educacion", skills: "Habilidades", projects: "Proyectos", certifications: "Certificaciones", languages: "Idiomas", references: "Referencias", interests: "Intereses", contact: "Contacto", present: "Actualidad", yourName: "Tu Nombre", dear: "Estimado/a", sincerely: "Atentamente", coverLetter: "Carta de presentacion", date: "Fecha" },
  fr: { profile: "Profil", experience: "Experience", education: "Formation", skills: "Competences", projects: "Projets", certifications: "Certifications", languages: "Langues", references: "References", interests: "Centres d'interet", contact: "Contact", present: "Present", yourName: "Votre Nom", dear: "Cher/Chere", sincerely: "Cordialement", coverLetter: "Lettre de motivation", date: "Date" },
  de: { profile: "Profil", experience: "Berufserfahrung", education: "Ausbildung", skills: "Kenntnisse", projects: "Projekte", certifications: "Zertifikate", languages: "Sprachen", references: "Referenzen", interests: "Interessen", contact: "Kontakt", present: "Heute", yourName: "Ihr Name", dear: "Sehr geehrte/r", sincerely: "Mit freundlichen Gruessen", coverLetter: "Anschreiben", date: "Datum" },
  pt: { profile: "Perfil", experience: "Experiencia", education: "Formacao", skills: "Competencias", projects: "Projetos", certifications: "Certificacoes", languages: "Idiomas", references: "Referencias", interests: "Interesses", contact: "Contato", present: "Atual", yourName: "Seu Nome", dear: "Prezado(a)", sincerely: "Atenciosamente", coverLetter: "Carta de apresentacao", date: "Data" },
  hi: { profile: "\u092a\u094d\u0930\u094b\u092b\u093c\u093e\u0907\u0932", experience: "\u0905\u0928\u0941\u092d\u0935", education: "\u0936\u093f\u0915\u094d\u0937\u093e", skills: "\u0915\u094c\u0936\u0932", projects: "\u092a\u0930\u093f\u092f\u094b\u091c\u0928\u093e\u090f\u0901", certifications: "\u092a\u094d\u0930\u092e\u093e\u0923\u092a\u0924\u094d\u0930", languages: "\u092d\u093e\u0937\u093e\u090f\u0901", references: "\u0938\u0902\u0926\u0930\u094d\u092d", interests: "\u0930\u0941\u091a\u093f\u092f\u093e\u0901", contact: "\u0938\u0902\u092a\u0930\u094d\u0915", present: "\u0935\u0930\u094d\u0924\u092e\u093e\u0928", yourName: "\u0906\u092a\u0915\u093e \u0928\u093e\u092e", dear: "\u092a\u094d\u0930\u093f\u092f", sincerely: "\u0938\u093e\u0926\u0930", coverLetter: "\u0915\u0935\u0930 \u0932\u0947\u091f\u0930", date: "\u0926\u093f\u0928\u093e\u0902\u0915" },
  ar: { profile: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062e\u0635\u064a", experience: "\u0627\u0644\u062e\u0628\u0631\u0629", education: "\u0627\u0644\u062a\u0639\u0644\u064a\u0645", skills: "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062a", projects: "\u0627\u0644\u0645\u0634\u0627\u0631\u064a\u0639", certifications: "\u0627\u0644\u0634\u0647\u0627\u062f\u0627\u062a", languages: "\u0627\u0644\u0644\u063a\u0627\u062a", references: "\u0627\u0644\u0645\u0631\u0627\u062c\u0639", interests: "\u0627\u0644\u0627\u0647\u062a\u0645\u0627\u0645\u0627\u062a", contact: "\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0627\u062a\u0635\u0627\u0644", present: "\u062d\u062a\u0649 \u0627\u0644\u0622\u0646", yourName: "\u0627\u0633\u0645\u0643", dear: "\u0639\u0632\u064a\u0632\u064a", sincerely: "\u0645\u0639 \u062e\u0627\u0644\u0635 \u0627\u0644\u062a\u0642\u062f\u064a\u0631", coverLetter: "\u062e\u0637\u0627\u0628 \u0627\u0644\u062a\u0642\u062f\u064a\u0645", date: "\u0627\u0644\u062a\u0627\u0631\u064a\u062e" },
  zh: { profile: "\u7b80\u4ecb", experience: "\u5de5\u4f5c\u7ecf\u5386", education: "\u6559\u80b2\u80cc\u666f", skills: "\u6280\u80fd", projects: "\u9879\u76ee", certifications: "\u8bc1\u4e66", languages: "\u8bed\u8a00", references: "\u63a8\u8350\u4eba", interests: "\u5174\u8da3\u7231\u597d", contact: "\u8054\u7cfb\u65b9\u5f0f", present: "\u81f3\u4eca", yourName: "\u60a8\u7684\u59d3\u540d", dear: "\u5c0a\u656c\u7684", sincerely: "\u6b64\u81f4", coverLetter: "\u6c42\u804c\u4fe1", date: "\u65e5\u671f" },
};

const KEY_ALIAS = { summary: "profile" };

export function tr(lang, key) {
  const L = I18N[lang] || I18N.en;
  const k = KEY_ALIAS[key] || key;
  return L[k] || I18N.en[k] || key;
}
export function sectionLabel(key, lang) { return tr(lang, key); }
export function isRtl(lang) { return (LANGS.find((l) => l.id === lang) || {}).rtl || false; }

// ---------------------------------------------------------------------------
// Job-description keyword matching (offline). Extract the most frequent
// meaningful words from a pasted job description and check which appear in the
// resume. Returns a match percentage plus matched/missing keyword lists so the
// user can tailor the resume to the role.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set("a an and are as at be by for from has have in into is it its of on or our that the their this to with will you your we they he she our are was were been being do does did not can could should would may might must able across also any all more most other some such than then them these those what which who whom why how when where role job work team teams company companies experience years year skills skill strong good great excellent ability abilities responsible responsibilities include including etc using use used within about over under per via new plus".split(/\s+/));

function resumeText(resume) {
  const parts = [];
  const p = resume.personal || {};
  parts.push(p.title || "");
  parts.push(resume.summary || "");
  (resume.experience || []).forEach((e) => { parts.push(e.role, e.company, ...(e.bullets || [])); });
  (resume.projects || []).forEach((x) => { parts.push(x.name, x.description, ...(x.bullets || [])); });
  (resume.education || []).forEach((e) => { parts.push(e.degree, e.school, e.details); });
  (resume.skills || []).forEach((x) => parts.push(x.name));
  (resume.certifications || []).forEach((x) => parts.push(x.name, x.issuer));
  (resume.interests || []).forEach((x) => parts.push(x.name));
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function keywordAnalysis(resume, jdText) {
  const jd = (jdText || "").toLowerCase();
  if (!jd.trim()) return { total: 0, matched: [], missing: [], pct: 0 };
  const freq = new Map();
  (jd.match(/[a-z][a-z+.#]{2,}/g) || []).forEach((w) => {
    const word = w.replace(/[.]+$/, "");
    if (word.length < 3 || STOPWORDS.has(word)) return;
    freq.set(word, (freq.get(word) || 0) + 1);
  });
  const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
  const text = resumeText(resume);
  const matched = [];
  const missing = [];
  keywords.forEach((k) => {
    const re = new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    (re.test(text) ? matched : missing).push(k);
  });
  const pct = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0;
  return { total: keywords.length, matched, missing, pct };
}

// ---------------------------------------------------------------------------
// Writing suggestions (offline). Fast, transparent checks that catch the most
// common resume-writing mistakes. This is the honest baseline for "grammar
// checking"; a true LLM grammar pass is a separate, later enhancement.
// ---------------------------------------------------------------------------
const WEAK_PHRASES = ["responsible for", "worked on", "helped with", "helped to", "assisted with", "duties included", "in charge of", "tasked with"];
const BUZZWORDS = ["synergy", "go-getter", "team player", "hardworking", "detail-oriented", "results-driven", "self-starter", "think outside the box", "hit the ground running"];

export function writingSuggestions(resume) {
  const out = [];
  const bullets = [];
  (resume.experience || []).forEach((e) => (e.bullets || []).forEach((b) => b && b.trim() && bullets.push(b.trim())));
  (resume.projects || []).forEach((x) => (x.bullets || []).forEach((b) => b && b.trim() && bullets.push(b.trim())));
  const summary = (resume.summary || "").trim();
  const all = summary ? bullets.concat(summary) : bullets;
  const lowerAll = all.map((t) => t.toLowerCase());

  if (lowerAll.some((t) => /\b(i|me|my)\b/.test(t)))
    out.push("Drop first-person pronouns (I, me, my) - resumes read better in implied first person.");

  const weak = WEAK_PHRASES.filter((w) => lowerAll.some((t) => t.includes(w)));
  if (weak.length) out.push('Replace weak phrases like "' + weak.slice(0, 2).join('", "') + '" with strong action verbs (Led, Built, Reduced).');

  const buzz = BUZZWORDS.filter((w) => lowerAll.some((t) => t.includes(w)));
  if (buzz.length) out.push('Cut clichés like "' + buzz.slice(0, 2).join('", "') + '" and show them with concrete results instead.');

  const longOnes = bullets.filter((b) => b.split(/\s+/).length > 30).length;
  if (longOnes) out.push(longOnes + " bullet point(s) are quite long - aim for one line (under ~30 words) each.");

  const firstWords = bullets.map((b) => b.split(/\s+/)[0]?.toLowerCase()).filter(Boolean);
  const counts = {};
  firstWords.forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
  const repeated = Object.entries(counts).find(([, n]) => n >= 3);
  if (repeated) out.push('Several bullets start with "' + repeated[0] + '" - vary your opening verbs to keep it engaging.');

  const noPeriod = bullets.filter((b) => b.length > 8 && !/[.!?]$/.test(b)).length;
  if (bullets.length && noPeriod === bullets.length) out.push("Consider ending bullet points with a period for consistency.");

  return out.slice(0, 8);
}
