import MathText from "../ui/MathText";

// A clean, theme-independent rendering of a question for posting to Facebook /
// Instagram as an image. It uses the SAME MathText (KaTeX) renderer the students
// see, so fractions, powers, roots etc. look exactly like the quiz board. Styles
// are inline (not Tailwind) so a screenshot is consistent regardless of the
// admin's light/dark theme.

const LET = ["a", "b", "c", "d", "e", "f"];
const ROM = ["I", "II", "III", "IV", "V", "VI"];

const S = {
  card: { width: 720, boxSizing: "border-box", background: "#ffffff", color: "#0f172a", fontFamily: "'Segoe UI', system-ui, -apple-system, Arial, sans-serif", padding: "28px 32px", lineHeight: 1.5 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, paddingBottom: 12, borderBottom: "2px solid #e2e8f0" },
  brand: { fontSize: 18, fontWeight: 800, color: "#4f46e5" },
  badge: { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  stem: { fontSize: 22, fontWeight: 700, marginBottom: 16 },
  colWrap: { display: "flex", gap: 12, marginBottom: 14 },
  col: { flex: 1, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 },
  colHead: { fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#4f46e5", marginBottom: 6 },
  row: { display: "flex", gap: 6, fontSize: 16, marginBottom: 4 },
  ans: { marginTop: 16, padding: "12px 14px", borderRadius: 12, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 16 },
  footer: { marginTop: 18, textAlign: "center", fontSize: 12, color: "#94a3b8" },
  tags: { marginTop: 14, fontSize: 15, color: "#4f46e5", fontWeight: 600 },
};

const optStyle = (correct) => ({
  display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, marginBottom: 10, fontSize: 18,
  background: correct ? "#ecfdf5" : "#f8fafc",
  border: `1px solid ${correct ? "#6ee7b7" : "#e2e8f0"}`,
  color: correct ? "#047857" : "#334155",
  fontWeight: correct ? 700 : 500,
});

export default function QuestionPostCard({ question, includeOptions = true, includeAnswer = false, siteName = "My Study Guide", hashtags = "" }) {
  const q = question || {};
  const type = q.type || "mcq";
  const options = Array.isArray(q.options) ? q.options : [];
  const colA = Array.isArray(q.columnA) ? q.columnA : [];
  const colB = Array.isArray(q.columnB) ? q.columnB : [];
  const rows = Array.isArray(q.tableRows) ? q.tableRows : [];
  const typeLabel = { numericalmcq: "Numerical MCQ", matching: "Matching", statement: "Statements", pair: "Pairs", pairselect: "Pair-select", assertion: "Assertion & Reason", table: "Table" }[type];

  return (
    <div style={S.card}>
      <div style={S.header}>
        <span style={S.brand}>{siteName}</span>
        <span style={S.badge}>{[q.difficulty, typeLabel].filter(Boolean).join(" · ")}</span>
      </div>

      {type === "assertion" && (q.assertion || q.reason) && (
        <div style={{ marginBottom: 14, fontSize: 18 }}>
          {q.assertion && <div style={{ marginBottom: 6 }}><b>Assertion (A): </b><MathText>{q.assertion}</MathText></div>}
          {q.reason && <div><b>Reason (R): </b><MathText>{q.reason}</MathText></div>}
        </div>
      )}

      {q.text && <div style={S.stem}><MathText>{q.text}</MathText></div>}

      {type === "statement" && colA.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {colA.map((s, i) => (<div key={i} style={S.row}><b>{i + 1}.</b> <MathText>{s}</MathText></div>))}
        </div>
      )}

      {["matching", "pair", "pairselect"].includes(type) && (colA.length > 0 || colB.length > 0) && (
        <div style={S.colWrap}>
          <div style={S.col}>
            <div style={S.colHead}>Column A</div>
            {colA.map((s, i) => (<div key={i} style={S.row}><b>{i + 1}.</b> <MathText>{s}</MathText></div>))}
          </div>
          <div style={S.col}>
            <div style={S.colHead}>Column B</div>
            {colB.map((s, i) => (<div key={i} style={S.row}><b>{ROM[i] || i + 1}.</b> <MathText>{s}</MathText></div>))}
          </div>
        </div>
      )}

      {type === "table" && rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 16 }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {(Array.isArray(r) ? r : [r]).map((c, ci) => (
                  <td key={ci} style={{ border: "1px solid #e2e8f0", padding: "6px 10px", fontWeight: ri === 0 ? 700 : 400, background: ri === 0 ? "#f1f5f9" : "#fff" }}>
                    <MathText>{String(c)}</MathText>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {includeOptions && options.length > 0 && (
        <div>
          {options.map((o, i) => {
            const correct = includeAnswer && i === q.correct;
            return (
              <div key={i} style={optStyle(correct)}>
                <span style={{ fontWeight: 800, minWidth: 22 }}>({LET[i] || i + 1})</span>
                <span><MathText>{o}</MathText></span>
              </div>
            );
          })}
        </div>
      )}

      {includeAnswer && q.correct != null && options[q.correct] != null && (
        <div style={S.ans}>
          <b>Answer: {(LET[q.correct] || String(q.correct + 1)).toUpperCase()}. </b>
          <MathText>{options[q.correct]}</MathText>
          {q.explanation && <div style={{ marginTop: 8 }}><b>Explanation: </b><MathText>{q.explanation}</MathText></div>}
        </div>
      )}

      {hashtags && <div style={S.tags}>{hashtags}</div>}
      <div style={S.footer}>{siteName}</div>
    </div>
  );
}
