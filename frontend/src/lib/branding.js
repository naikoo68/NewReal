// White-label branding applied to the document at runtime from Settings.
//
// The static tags in index.html / manifest.webmanifest ship with the original
// "My Study Guide" brand (needed for the first paint and non-JS SEO crawlers).
// Once the app boots and Settings load, this rewrites the visible brand — tab
// title, address-bar theme colour, favicon/app icon, social preview meta, and
// a freshly generated PWA manifest — so a white-label buyer's name/logo/colour
// take over everywhere without editing code.

function setMeta(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el && value != null && value !== "") el.setAttribute(attr, value);
}

let manifestBlobUrl = null;

export function applyBranding(s) {
  if (!s) return;
  const name = s.siteName || "My Study Guide";
  const tagline = s.tagline || "";
  const title = tagline ? `${name} — ${tagline}` : name;
  const color = s.primaryColor || "#2563eb";

  // Browser tab title
  document.title = title;

  // Address bar / PWA splash colour
  setMeta('meta[name="theme-color"]', "content", color);

  // Social preview + iOS home-screen title
  setMeta('meta[property="og:site_name"]', "content", name);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="apple-mobile-web-app-title"]', "content", name);
  setMeta('meta[name="author"]', "content", name);

  // Favicon + Apple touch icon follow the uploaded logo (when one is set)
  if (s.logoUrl) {
    setMeta('link[rel="icon"]', "href", s.logoUrl);
    setMeta('link[rel="apple-touch-icon"]', "href", s.logoUrl);
  }

  // Regenerate the PWA manifest so an installed app shows the buyer's brand.
  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (link) {
      const icons = s.logoUrl
        ? [
            { src: s.logoUrl, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: s.logoUrl, sizes: "512x512", type: "image/png", purpose: "any" },
          ]
        : [
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ];
      const manifest = {
        name: `${name} — My Practice`,
        short_name: name,
        description: tagline || "Build and practise your own quizzes, tests and previous papers.",
        id: "/#/client",
        start_url: "/#/client",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f172a",
        theme_color: color,
        categories: ["education", "productivity"],
        icons,
      };
      if (manifestBlobUrl) URL.revokeObjectURL(manifestBlobUrl);
      manifestBlobUrl = URL.createObjectURL(
        new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" })
      );
      link.setAttribute("href", manifestBlobUrl);
    }
  } catch {
    /* manifest rewrite is best-effort; never block the app */
  }
}
