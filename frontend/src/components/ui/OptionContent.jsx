import MathText from "./MathText";

// Split a pipe-delimited block (markdown-style table) into rows of trimmed
// cells, dropping the "| --- | --- |" separator rows some models emit.
function parsePipeRows(s) {
  return String(s || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes("|"))
    .map((l) => {
      // Markdown-style rows wrap every row in outer "|" delimiters ("| a | b |").
      // Drop ONLY those two delimiter artifacts so inner empty cells (e.g. an
      // empty Debit or Credit column) are preserved and columns stay aligned.
      const outer = l.startsWith("|") && l.endsWith("|");
      let parts = l.split("|");
      if (outer) parts = parts.slice(1, -1);
      return parts.map((c) => c.trim());
    })
    .filter((cells) => !cells.every((c) => c === "" || /^:?-{2,}:?$/.test(c)));
}

/**
 * Renders a single question OPTION.
 *
 * Accounting options are supplied as a pipe-delimited table in the standard
 * textbook layout, and we detect that shape to render a real, aligned table
 * (any "|" cell would otherwise show as raw pipes):
 *   - Journal Entry: five columns "Date | Particulars | LF | Amount(Dr.) |
 *     Amount(Cr.)" (older ones use "Account | Debit | Credit").
 *   - Ledger Posting: an eight-column T-account "Date | Particulars | J.F. |
 *     Amount | Date | Particulars | J.F. | Amount" (Debit side then Credit side).
 * Amount columns are right-aligned, credit lines ("To …") indented in
 * Particulars, and any "(Being …)" narration italicised. Any other option
 * (plain MCQ, matching sequence, etc.) renders as normal math-aware text.
 */
export default function OptionContent({ children }) {
  const s = typeof children === "string" ? children : "";
  const pipeLines = s.split(/\r?\n/).filter((l) => l.includes("|"));

  // Need at least two pipe rows to be a table (header + data, or two account
  // lines); otherwise treat "|" as ordinary text.
  if (pipeLines.length >= 2) {
    const rows = parsePipeRows(s);
    if (rows.length && rows.some((r) => r.length >= 2)) {
      const looksHeader = /account|particular|debit|credit|amount|dr\.?|cr\.?|date|\blf\b/i.test(rows[0].join(" "));
      const header = looksHeader ? rows[0] : ["Account", "Debit", "Credit"];
      const body = looksHeader ? rows.slice(1) : rows;
      const cols = Math.max(header.length, ...body.map((r) => r.length), 1);
      const idx = Array.from({ length: cols });

      // Per-column hints for a journal-style layout.
      const isAmountCol = idx.map((_, i) => /amount|debit|credit|\bdr\.?\b|\bcr\.?\b/i.test(header[i] || ""));
      const particularsCol = header.findIndex((h) => /particular/i.test(h || ""));

      return (
        <div className="max-w-full overflow-x-auto">
          <table className="min-w-[16rem] border-collapse text-xs">
            <thead>
              <tr>
                {idx.map((_, i) => (
                  <th
                    key={i}
                    className={`border border-slate-300 px-2 py-1 font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300 ${isAmountCol[i] ? "text-right" : "text-left"}`}
                  >
                    {header[i] || ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {idx.map((_, ci) => {
                    const cell = r[ci] || "";
                    const isParticulars = ci === particularsCol;
                    const isCredit = isParticulars && /^to\s/i.test(cell); // "To Capital A/c" → indent
                    const isNarration = isParticulars && /^\(/.test(cell); // "(Being …)" → italic/muted
                    return (
                      <td
                        key={ci}
                        className={`border border-slate-200 px-2 py-1 align-top dark:border-slate-700 ${
                          isAmountCol[ci] ? "whitespace-nowrap text-right tabular-nums" : "text-left"
                        } ${isCredit ? "pl-5" : ""} ${isNarration ? "italic text-slate-500 dark:text-slate-400" : ""}`}
                      >
                        <MathText>{cell}</MathText>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
  return <MathText>{children}</MathText>;
}
