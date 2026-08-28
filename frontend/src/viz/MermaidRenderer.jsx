// Mermaid engine for the Visualization Engine — renders text-defined diagrams
// (flowcharts, mind maps, UML/class, sequence, state, ER, gantt, journey, …)
// from `spec.code`. Mermaid is loaded LAZILY (dynamic import) so it's only
// fetched when a diagram of this engine is actually shown — it never bloats the
// main bundle or affects existing pages.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useTheme } from "../context/ThemeContext";

// Mermaid is loaded from a CDN (ESM build) at runtime rather than bundled, so it
// adds nothing to package.json/the lockfile or the app bundle. esm.sh resolves
// Mermaid's own dependency tree into a single module.
const MERMAID_CDN = "https://esm.sh/mermaid@11";

// Repair the most common ways AI-authored Mermaid breaks the parser, so a
// diagram renders instead of dumping a raw "Parse error" at the student:
//  - Unicode/HTML arrows (→ ⟶ ➜ -&gt;) used instead of Mermaid's "-->" edge.
//  - "->" written as a flow edge (valid only in sequence diagrams) → "-->".
//  - stray surrounding code fences / labels.
// It's deliberately conservative: it only touches arrow glyphs and fences.
function sanitizeMermaidCode(raw) {
  let code = String(raw || "").trim();
  // Strip a wrapping ```mermaid ... ``` fence if the model included one.
  code = code.replace(/^```(?:mermaid)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const isSequence = /^\s*sequenceDiagram/m.test(code);
  // Normalise unicode/HTML arrows to Mermaid's flow arrow (except in sequence
  // diagrams, whose arrows are ->> / -->> and should not be rewritten).
  if (!isSequence) {
    code = code
      .replace(/&gt;/g, ">")
      .replace(/[\u2192\u27F6\u2794\u2799\u279C\u27A1\u2B95]/g, "-->") // → ⟶ ➔ ➙ ➜ ➡ ⮕
      .replace(/-{1,}\s*>/g, "-->")   // "->", "- >", "--->" → "-->"
      .replace(/={2,}\s*>/g, "==>")   // "==>" thick arrow kept
      .replace(/-->\s*-->/g, "-->");  // collapse any doubled arrows from the above
  }
  // Quote node labels that contain characters Mermaid can't parse when bare —
  // parentheses, slashes, colons, ampersands, commas — e.g. the very common
  // A[Access Point (AP)] or B[Client / STA] that otherwise throw a parse error.
  // Wrapping the label in double quotes (A["Access Point (AP)"]) is always safe
  // and rescues many AI-authored diagrams without regenerating them. Skips the
  // stateDiagram start/end marker [*] and already-quoted labels.
  if (!isSequence) {
    code = code.replace(/\[([^\]\n]*?)\]/g, (m, inner) => {
      const t = inner.trim();
      if (!t || t === "*") return m;                       // keep [*]
      if (t.startsWith('"') && t.endsWith('"')) return m;   // already quoted
      if (/[()/:;#&,]/.test(t)) return `["${t.replace(/"/g, "'")}"]`;
      return m;
    });
  }
  return code.trim();
}

const MermaidRenderer = forwardRef(function MermaidRenderer({ spec }, ref) {
  const holder = useRef(null);
  const [error, setError] = useState("");
  const { theme } = useTheme();

  // Expose an SVG-shaped handle so the Studio's exporters know how to save it.
  useImperativeHandle(ref, () => ({ engine: "svg", node: holder.current }), []);

  useEffect(() => {
    let cancelled = false;
    const original = String(spec?.code || "").trim();
    if (!original) { setError(""); if (holder.current) holder.current.innerHTML = ""; return; }
    // Try the sanitized code first (fixes common AI mistakes), but if it fails
    // fall back to the ORIGINAL code — sanitizing must NEVER turn a diagram that
    // used to render into one that doesn't. Only show the message if BOTH fail.
    const sanitized = sanitizeMermaidCode(original);
    const candidates = sanitized && sanitized !== original ? [sanitized, original] : [original];

    (async () => {
      try {
        // Load Mermaid lazily from a CDN (ESM) at runtime — this keeps it out of
        // package.json / the lockfile and the main bundle entirely, and it's only
        // fetched the first time a Mermaid diagram is rendered. The @vite-ignore
        // tells the bundler to leave this dynamic import as a native browser import.
        const mermaid = (await import(/* @vite-ignore */ MERMAID_CDN)).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "loose",
          fontFamily: "inherit",
          suppressErrorRendering: true, // never inject Mermaid's "bomb" error graphic
        });
        let svg = "";
        let lastErr = null;
        for (const code of candidates) {
          try {
            const id = "mmd-" + Math.random().toString(36).slice(2);
            ({ svg } = await mermaid.render(id, code));
            lastErr = null;
            break; // rendered successfully
          } catch (e) {
            lastErr = e;
          }
        }
        if (lastErr) throw lastErr;
        if (!cancelled && holder.current) {
          holder.current.innerHTML = svg;
          setError("");
        }
      } catch {
        // Clean up any stray node Mermaid may have appended to <body> on failure,
        // then show a neutral message — never the raw parser dump to a student.
        document.querySelectorAll('[id^="dmmd-"], [id^="mmd-"]').forEach((n) => {
          if (n && n.parentNode === document.body) n.remove();
        });
        if (!cancelled) {
          if (holder.current) holder.current.innerHTML = "";
          setError("This diagram couldn't be displayed.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [spec?.code, theme]);

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={holder}
        className="mermaid-holder flex flex-1 items-center justify-center overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      />
      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
});

export default MermaidRenderer;
