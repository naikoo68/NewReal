// True KaTeX-style math via MathJax → SVG (vector <path> glyphs, fontCache
// "none"), so Cloudinary rasterises real fraction bars/symbols identical to the
// quiz board. Lazy + defensive: if the package isn't installed yet or a
// conversion fails, returns null and callers fall back to the native renderer —
// so it can never crash the server or break a deploy.

let _mjPromise;
async function getMathJax() {
  if (_mjPromise !== undefined) return _mjPromise;
  _mjPromise = (async () => {
    try {
      const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
        import("mathjax-full/js/mathjax.js"),
        import("mathjax-full/js/input/tex.js"),
        import("mathjax-full/js/output/svg.js"),
        import("mathjax-full/js/adaptors/liteAdaptor.js"),
        import("mathjax-full/js/handlers/html.js"),
        import("mathjax-full/js/input/tex/AllPackages.js"),
      ]);
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const doc = mathjax.document("", {
        InputJax: new TeX({ packages: AllPackages }),
        OutputJax: new SVG({ fontCache: "none" }),
      });
      return { doc, adaptor };
    } catch {
      return null;
    }
  })();
  return _mjPromise;
}

const TEX_ESC = (s) => String(s).replace(/([\\{}$&#%_^~])/g, "\\$1");

// Turn a mixed "text with $math$" string into ONE TeX expression: plain runs
// become \text{…}; parts between $…$ stay math. If there are no $…$ delimiters
// but the string looks like math (has a LaTeX command), treat it all as math.
function mixedToTex(str) {
  const s = String(str);
  if (!s.includes("$") && /\\[A-Za-z]/.test(s)) return s; // bare LaTeX
  const parts = s.split("$");
  let tex = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { if (parts[i]) tex += `\\text{${TEX_ESC(parts[i])}}`; }
    else if (parts[i].trim()) tex += ` ${parts[i]} `;
  }
  return tex.trim();
}

export const needsMath = (str) => /\$[^$]+\$/.test(String(str || "")) || /\\[A-Za-z]/.test(String(str || ""));

// Render a (possibly mixed) string to an SVG fragment. Returns
// { inner, viewBox, wEx, hEx } or null on any failure.
export async function stringToMathSvg(str) {
  const mj = await getMathJax();
  if (!mj) return null;
  try {
    const tex = mixedToTex(str);
    if (!tex) return null;
    const node = mj.doc.convert(tex, { display: false });
    const svg = mj.adaptor.innerHTML(node);
    const vb = svg.match(/viewBox="([^"]+)"/);
    if (!vb) return null;
    const w = svg.match(/width="([\d.]+)ex"/);
    const h = svg.match(/height="([\d.]+)ex"/);
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    return { inner, viewBox: vb[1], wEx: parseFloat(w?.[1] || "10"), hEx: parseFloat(h?.[1] || "2") };
  } catch {
    return null;
  }
}
