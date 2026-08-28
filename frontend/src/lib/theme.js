// Generates a full 50–900 colour scale from a single base hex and applies it
// as CSS variables, so the whole Tailwind `brand`/`accent` palette becomes
// dynamic and admin-customisable. Also handles the site font.

const LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

// Build a scale where `anchor` shade === the chosen colour, lighter shades
// mix toward white and darker shades mix toward black.
function paletteVars(hex, anchor) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const ai = LEVELS.indexOf(anchor);
  const out = {};
  LEVELS.forEach((lvl, i) => {
    let c;
    if (i === ai) c = base;
    else if (i < ai) c = mix(base, WHITE, Math.min(0.95, (ai - i) * 0.16));
    else c = mix(base, BLACK, Math.min(0.9, (i - ai) * 0.15));
    out[lvl] = `${c.r} ${c.g} ${c.b}`;
  });
  return out;
}

function loadFont(family) {
  if (!family || family === "Inter") return; // Inter is already loaded
  const id = "dyn-font-" + family.replace(/\s+/g, "-");
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, "+")}:wght@300;400;500;600;700;800;900&display=swap`;
  document.head.appendChild(link);
}

export function applyTheme(settings = {}) {
  const root = document.documentElement;
  const {
    primaryColor, accentColor, fontFamily,
    navHeight, navBrandSize, navFontSize, navFontWeight, navFontFamily, navTextTransform,
  } = settings;

  const brand = primaryColor && paletteVars(primaryColor, 600);
  if (brand) Object.entries(brand).forEach(([k, v]) => root.style.setProperty(`--brand-${k}`, v));

  const accent = accentColor && paletteVars(accentColor, 500);
  if (accent) Object.entries(accent).forEach(([k, v]) => root.style.setProperty(`--accent-${k}`, v));

  if (fontFamily) {
    loadFont(fontFamily);
    root.style.setProperty("--app-font", `'${fontFamily}', ui-sans-serif, system-ui, sans-serif`);
  }

  // ---- Navbar appearance (admin-customisable) ----
  root.style.setProperty("--nav-height", `${Number(navHeight) || 64}px`);
  root.style.setProperty("--nav-brand-size", `${Number(navBrandSize) || 18}px`);
  root.style.setProperty("--nav-font-size", `${Number(navFontSize) || 14}px`);
  root.style.setProperty("--nav-font-weight", String(navFontWeight || 500));
  root.style.setProperty("--nav-text-transform", navTextTransform || "none");
  const navFam = navFontFamily || fontFamily;
  if (navFam) {
    loadFont(navFam);
    root.style.setProperty("--nav-font-family", `'${navFam}', ui-sans-serif, system-ui, sans-serif`);
  } else {
    root.style.setProperty("--nav-font-family", "var(--app-font, 'Inter', sans-serif)");
  }
}

export const FONT_OPTIONS = ["Inter", "Poppins", "Roboto", "Montserrat", "Lato", "Open Sans", "Nunito"];
