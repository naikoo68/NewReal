// ---------------------------------------------------------------------------
// CoverLetterDocument — an A4 cover letter that shares the resume's theme
// (accent, font, name/contact header) so the two documents look like a set.
// Rendered with inline styles for the same print fidelity as ResumeDocument.
// ---------------------------------------------------------------------------
import { tr, isRtl } from "./resumeData";

export default function CoverLetterDocument({ resume, accent, fontFamily, fontScale = 1, lang = "en" }) {
  const ac = accent || resume.theme?.accent || "#2563eb";
  const font = fontFamily || "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
  const base = 10.6 * (fontScale || 1);
  const p = resume.personal || {};
  const cl = resume.coverLetter || {};
  const rtl = isRtl(lang);

  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const contactItems = [p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean);
  const paragraphs = String(cl.body || "").split(/\n{2,}|\n/).map((t) => t.trim()).filter(Boolean);
  const greetingName = cl.recipient?.trim() || "Hiring Manager";

  const sheet = {
    width: "210mm", minHeight: "297mm", background: "#fff", color: "#1f2937",
    fontFamily: font, fontSize: base, lineHeight: 1.5, boxSizing: "border-box",
    padding: "20mm 18mm", margin: "0 auto", direction: rtl ? "rtl" : "ltr",
    textAlign: rtl ? "right" : "left", boxShadow: "0 1px 8px rgba(0,0,0,0.12)",
  };

  return (
    <div className="resume-sheet" style={sheet}>
      {/* Sender header — mirrors the resume header for a consistent identity. */}
      <header style={{ borderBottom: `2px solid ${ac}`, paddingBottom: 10, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: base * 1.9, color: "#111" }}>{p.fullName || tr(lang, "yourName")}</h1>
        {p.title ? <div style={{ color: ac, fontSize: base * 1.1, fontWeight: 600, marginTop: 2 }}>{p.title}</div> : null}
        {contactItems.length ? <div style={{ color: "#555", fontSize: base * 0.92, marginTop: 4 }}>{contactItems.join("  \u2022  ")}</div> : null}
      </header>

      <div style={{ color: "#555", marginBottom: 16 }}>{tr(lang, "date")}: {today}</div>

      {(cl.recipient || cl.company) ? (
        <div style={{ marginBottom: 16, lineHeight: 1.4 }}>
          {cl.recipient ? <div style={{ fontWeight: 600 }}>{cl.recipient}</div> : null}
          {cl.company ? <div>{cl.company}</div> : null}
        </div>
      ) : null}

      <p style={{ margin: "0 0 12px" }}>{tr(lang, "dear")} {greetingName},</p>

      {paragraphs.length ? (
        paragraphs.map((para, i) => <p key={i} style={{ margin: "0 0 12px", textAlign: rtl ? "right" : "justify" }}>{para}</p>)
      ) : (
        <p style={{ margin: "0 0 12px", color: "#9ca3af", fontStyle: "italic" }}>
          Write your cover letter in the editor. Introduce yourself, explain why you are a strong fit for the role, highlight one or two concrete achievements, and close with a call to action.
        </p>
      )}

      <div style={{ marginTop: 24 }}>
        <div>{tr(lang, "sincerely")},</div>
        <div style={{ fontWeight: 700, marginTop: 18 }}>{p.fullName || tr(lang, "yourName")}</div>
      </div>
    </div>
  );
}
