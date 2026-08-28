// ---------------------------------------------------------------------------
// ResumeDocument — the ONE renderer every template uses. It reads the resume
// JSON + a `style` preset and paints an A4 sheet with inline styles (so PDF
// export via the browser keeps fonts, colours, spacing and page breaks, and the
// text stays selectable — no rasterizing). Add a new template by adding a preset
// in resumeTemplates.js; no changes needed here.
// ---------------------------------------------------------------------------
import { sectionLabel, tr, isRtl } from "./resumeData";

const SIDEBAR_KEYS = ["skills", "languages", "interests", "references"];
const MAIN_KEYS = ["summary", "experience", "education", "projects", "certifications"];

const dateRange = (a, b, current, present = "Present") => {
  const end = current ? present : (b || "");
  if (a && end) return `${a} \u2013 ${end}`;
  return a || end || "";
};

export default function ResumeDocument({ resume, style = {}, accent, fontFamily, fontScale = 1, lang = "en" }) {
  const s = { headerAlign: "left", titleStyle: "underline", density: "cozy", columns: 1, sidebar: "left", uppercaseName: false, showPhoto: false, ...style };
  const ac = accent || s.accent || "#2563eb";
  const font = fontFamily || "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
  const base = 10.3 * (fontScale || 1); // pt-ish; scaled by zoom-independent font scale
  const gap = s.density === "compact" ? 9 : 13;
  const p = resume.personal || {};
  const hidden = resume.layout?.hidden || {};
  const order = (resume.layout?.order && resume.layout.order.length ? resume.layout.order : MAIN_KEYS.concat(SIDEBAR_KEYS));
  const show = (k) => !hidden[k];
  const L = (k) => sectionLabel(k, lang);          // translated section heading
  const present = tr(lang, "present");             // "Present" in chosen language
  const rtl = isRtl(lang);

  // ---- shared bits -------------------------------------------------------
  const SectionTitle = ({ children }) => {
    const st = { color: ac, fontSize: base * 1.08, fontWeight: 700, margin: `0 0 ${gap * 0.4}px`, letterSpacing: s.titleStyle === "caps" ? "0.06em" : 0, textTransform: s.titleStyle === "caps" ? "uppercase" : "none" };
    if (s.titleStyle === "underline") return <h2 style={{ ...st, borderBottom: `2px solid ${ac}`, paddingBottom: 2 }}>{children}</h2>;
    if (s.titleStyle === "bar") return <h2 style={{ ...st, borderLeft: `4px solid ${ac}`, paddingLeft: 8 }}>{children}</h2>;
    return <h2 style={st}>{children}</h2>;
  };

  const bulletList = (items) => {
    const arr = (items || []).filter((b) => (b || "").trim());
    if (!arr.length) return null;
    return (
      <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>
        {arr.map((b, i) => <li key={i} style={{ marginBottom: 2, lineHeight: 1.35 }}>{b}</li>)}
      </ul>
    );
  };

  const renderSection = (key, { inSidebar = false } = {}) => {
    if (!show(key)) return null;
    switch (key) {
      case "summary":
        return resume.summary?.trim() ? (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("summary")}</SectionTitle>
            <p style={{ margin: 0, lineHeight: 1.4 }}>{resume.summary}</p>
          </section>
        ) : null;
      case "experience": {
        const list = (resume.experience || []).filter((e) => e.role || e.company);
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("experience")}</SectionTitle>
            {list.map((e) => (
              <div key={e.id} style={{ marginBottom: gap * 0.55 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: base * 1.02 }}>{e.role}{e.company ? `, ${e.company}` : ""}</strong>
                  <span style={{ color: "#555", whiteSpace: "nowrap" }}>{dateRange(e.start, e.end, e.current, present)}</span>
                </div>
                {e.location ? <div style={{ color: "#666", fontStyle: "italic" }}>{e.location}</div> : null}
                {bulletList(e.bullets)}
              </div>
            ))}
          </section>
        );
      }
      case "education": {
        const list = (resume.education || []).filter((e) => e.degree || e.school);
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("education")}</SectionTitle>
            {list.map((e) => (
              <div key={e.id} style={{ marginBottom: gap * 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{e.degree}</strong>
                  <span style={{ color: "#555", whiteSpace: "nowrap" }}>{dateRange(e.start, e.end)}</span>
                </div>
                <div style={{ color: "#444" }}>{[e.school, e.location].filter(Boolean).join(", ")}{e.score ? ` \u00b7 ${e.score}` : ""}</div>
                {e.details ? <div style={{ color: "#555" }}>{e.details}</div> : null}
              </div>
            ))}
          </section>
        );
      }
      case "skills": {
        const list = (resume.skills || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("skills")}</SectionTitle>
            {inSidebar ? (
              <ul style={{ margin: 0, paddingLeft: 16 }}>{list.map((x) => <li key={x.id} style={{ marginBottom: 2 }}>{x.name}{x.level ? ` \u2014 ${x.level}` : ""}</li>)}</ul>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {list.map((x) => <span key={x.id} style={{ background: `${ac}1a`, color: ac, borderRadius: 4, padding: "2px 8px", fontSize: base * 0.95 }}>{x.name}</span>)}
              </div>
            )}
          </section>
        );
      }
      case "projects": {
        const list = (resume.projects || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("projects")}</SectionTitle>
            {list.map((x) => (
              <div key={x.id} style={{ marginBottom: gap * 0.5 }}>
                <strong>{x.name}</strong>{x.link ? <span style={{ color: ac }}> \u00b7 {x.link}</span> : null}
                {x.description ? <div style={{ color: "#444" }}>{x.description}</div> : null}
                {bulletList(x.bullets)}
              </div>
            ))}
          </section>
        );
      }
      case "certifications": {
        const list = (resume.certifications || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("certifications")}</SectionTitle>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {list.map((x) => <li key={x.id} style={{ marginBottom: 2 }}>{x.name}{x.issuer ? `, ${x.issuer}` : ""}{x.date ? ` (${x.date})` : ""}</li>)}
            </ul>
          </section>
        );
      }
      case "languages": {
        const list = (resume.languages || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("languages")}</SectionTitle>
            <ul style={{ margin: 0, paddingLeft: 16 }}>{list.map((x) => <li key={x.id} style={{ marginBottom: 2 }}>{x.name}{x.level ? ` \u2014 ${x.level}` : ""}</li>)}</ul>
          </section>
        );
      }
      case "references": {
        const list = (resume.references || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("references")}</SectionTitle>
            {list.map((x) => (
              <div key={x.id} style={{ marginBottom: 4 }}>
                <strong>{x.name}</strong>{x.relation ? ` \u2014 ${x.relation}` : ""}
                {x.contact ? <div style={{ color: "#555" }}>{x.contact}</div> : null}
              </div>
            ))}
          </section>
        );
      }
      case "interests": {
        const list = (resume.interests || []).filter((x) => (x.name || "").trim());
        if (!list.length) return null;
        return (
          <section key={key} style={{ marginBottom: gap }}>
            <SectionTitle>{L("interests")}</SectionTitle>
            <div style={{ color: "#444" }}>{list.map((x) => x.name).join(" \u00b7 ")}</div>
          </section>
        );
      }
      default: return null;
    }
  };

  const contactLine = () => {
    const items = [p.email, p.phone, p.location, p.website, p.linkedin, p.github].filter(Boolean);
    if (!items.length) return null;
    return <div style={{ color: "#444", fontSize: base * 0.95, marginTop: 4, lineHeight: 1.5 }}>{items.join("  \u2022  ")}</div>;
  };

  const Header = ({ center }) => (
    <header style={{ textAlign: center ? "center" : "left", marginBottom: gap, borderBottom: `1px solid #e5e7eb`, paddingBottom: gap * 0.5 }}>
      <h1 style={{ margin: 0, fontSize: base * 2, color: "#111", letterSpacing: s.uppercaseName ? "0.04em" : 0, textTransform: s.uppercaseName ? "uppercase" : "none" }}>{p.fullName || tr(lang, "yourName")}</h1>
      {p.title ? <div style={{ color: ac, fontSize: base * 1.15, fontWeight: 600, marginTop: 2 }}>{p.title}</div> : null}
      {contactLine()}
    </header>
  );

  // ---- layouts -----------------------------------------------------------
  const sheet = {
    width: "210mm", minHeight: "297mm", background: "#fff", color: "#1f2937",
    fontFamily: font, fontSize: base, boxSizing: "border-box", margin: "0 auto",
    direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left",
    boxShadow: "0 1px 8px rgba(0,0,0,0.12)",
  };

  // ---- "Boxed" professional variant --------------------------------------
  // Bordered sections with tinted title bars, Education rendered as a table and
  // Skills/Certs/Languages as divider-separated rows, plus a rectangular photo
  // box in the header — the classic ATS CV layout.
  if (s.variant === "boxed") {
    const bd = "#c9d6e5";            // section / cell border
    const barBg = `${ac}14`;         // light title-bar tint
    const Box = ({ title, children }) => (
      <section style={{ border: `1px solid ${bd}`, borderRadius: 4, marginBottom: 10 }}>
        <div style={{ background: barBg, borderBottom: `1px solid ${bd}`, padding: "5px 10px", fontWeight: 700, fontSize: base * 1.15, color: "#111" }}>{title}</div>
        <div style={{ padding: 10 }}>{children}</div>
      </section>
    );
    const divRow = (children, i, n) => ({ padding: "5px 0", borderBottom: i < n - 1 ? "1px solid #e5e7eb" : "none" });

    const boxContent = (key) => {
      switch (key) {
        case "summary":
          return resume.summary?.trim() ? <p style={{ margin: 0, lineHeight: 1.45 }}>{resume.summary}</p> : null;
        case "experience": {
          const list = (resume.experience || []).filter((e) => e.role || e.company);
          if (!list.length) return null;
          return list.map((e, i) => (
            <div key={e.id} style={{ marginBottom: i < list.length - 1 ? 8 : 0 }}>
              <div style={{ fontWeight: 700 }}>{e.role || e.company}</div>
              {(e.start || e.end || e.current) ? <div style={{ color: "#555" }}>{dateRange(e.start, e.end, e.current, present)}</div> : null}
              {e.company && e.role ? <div>{e.company}</div> : null}
              {e.location ? <div style={{ color: "#555" }}>{e.location}</div> : null}
              {bulletList(e.bullets)}
            </div>
          ));
        }
        case "education": {
          const list = (resume.education || []).filter((e) => e.degree || e.school);
          if (!list.length) return null;
          const th = { border: `1px solid ${bd}`, padding: "5px 7px", textAlign: "left", background: barBg, fontWeight: 700 };
          const td = { border: `1px solid ${bd}`, padding: "5px 7px", verticalAlign: "top" };
          return (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: base }}>
              <thead>
                <tr><th style={th}>Course / Degree</th><th style={th}>School / University</th><th style={{ ...th, whiteSpace: "nowrap" }}>Grade / Score</th><th style={th}>Year</th></tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td style={td}>{e.degree}</td>
                    <td style={td}>{[e.school, e.location].filter(Boolean).join(", ")}</td>
                    <td style={td}>{e.score}</td>
                    <td style={td}>{e.end || e.start}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        case "skills": {
          const list = (resume.skills || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return list.map((x, i) => <div key={x.id} style={divRow(x, i, list.length)}>{x.name}{x.level ? ` \u2014 ${x.level}` : ""}</div>);
        }
        case "projects": {
          const list = (resume.projects || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return list.map((x, i) => (
            <div key={x.id} style={{ marginBottom: i < list.length - 1 ? 8 : 0 }}>
              <div style={{ fontWeight: 700 }}>{x.name}{x.link ? <span style={{ fontWeight: 400, color: ac }}> \u00b7 {x.link}</span> : null}</div>
              {x.description ? <div>{x.description}</div> : null}
              {bulletList(x.bullets)}
            </div>
          ));
        }
        case "certifications": {
          const list = (resume.certifications || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return list.map((x, i) => <div key={x.id} style={divRow(x, i, list.length)}>{x.name}{x.issuer ? `, ${x.issuer}` : ""}{x.date ? ` (${x.date})` : ""}</div>);
        }
        case "languages": {
          const list = (resume.languages || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return list.map((x, i) => <div key={x.id} style={divRow(x, i, list.length)}>{x.name}{x.level ? ` \u2014 ${x.level}` : ""}</div>);
        }
        case "references": {
          const list = (resume.references || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return list.map((x, i) => (
            <div key={x.id} style={{ marginBottom: i < list.length - 1 ? 6 : 0 }}>
              <strong>{x.name}</strong>{x.relation ? ` \u2014 ${x.relation}` : ""}
              {x.contact ? <div style={{ color: "#555" }}>{x.contact}</div> : null}
            </div>
          ));
        }
        case "interests": {
          const list = (resume.interests || []).filter((x) => (x.name || "").trim());
          if (!list.length) return null;
          return <div>{list.map((x) => x.name).join(" \u00b7 ")}</div>;
        }
        default: return null;
      }
    };

    const contactBits = [
      p.location,
      [p.phone, p.email].filter(Boolean).join(" | "),
      [p.website, p.linkedin, p.github].filter(Boolean).join(" | "),
    ].filter(Boolean);

    return (
      <div className="resume-sheet" style={{ ...sheet, padding: "12mm" }}>
        <section style={{ border: `1px solid ${bd}`, borderRadius: 4, padding: 12, marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: base * 1.9, fontWeight: 800, color: "#111", textTransform: s.uppercaseName ? "uppercase" : "none" }}>{p.fullName || tr(lang, "yourName")}</h1>
            {p.title ? <div style={{ color: ac, fontWeight: 600, marginTop: 2 }}>{p.title}</div> : null}
            <div style={{ marginTop: 6, color: "#374151", lineHeight: 1.55, fontSize: base * 0.97 }}>
              {contactBits.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
          {s.showPhoto && p.photo ? <img src={p.photo} alt="" style={{ width: 84, height: 104, objectFit: "cover", border: `1px solid ${bd}`, flexShrink: 0 }} /> : null}
        </section>
        {order.map((key) => {
          if (!show(key)) return null;
          const content = boxContent(key);
          if (!content || (Array.isArray(content) && content.length === 0)) return null;
          const title = key === "summary" ? "Objective" : L(key);
          return <Box key={key} title={title}>{content}</Box>;
        })}
      </div>
    );
  }

  if (s.columns === 2) {
    const sideW = "34%";
    const sideBg = `${ac}0f`;
    const sidebar = (
      <aside style={{ width: sideW, background: sideBg, padding: "16mm 8mm", boxSizing: "border-box" }}>
        {s.showPhoto && p.photo ? (
          <img src={p.photo} alt="" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", display: "block", margin: "0 auto 12px", border: `3px solid ${ac}` }} />
        ) : null}
        <div style={{ marginBottom: gap }}>
          <SectionTitle>{tr(lang, "contact")}</SectionTitle>
          <div style={{ lineHeight: 1.5, wordBreak: "break-word" }}>
            {[["Email", p.email], ["Phone", p.phone], ["Location", p.location], ["Web", p.website], ["LinkedIn", p.linkedin], ["GitHub", p.github]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 2 }}><span style={{ color: ac, fontWeight: 600 }}>{k}: </span>{v}</div>
            ))}
          </div>
        </div>
        {order.filter((k) => SIDEBAR_KEYS.includes(k)).map((k) => renderSection(k, { inSidebar: true }))}
      </aside>
    );
    const main = (
      <div style={{ flex: 1, padding: "16mm 12mm", boxSizing: "border-box" }}>
        <h1 style={{ margin: 0, fontSize: base * 2, color: "#111", textTransform: s.uppercaseName ? "uppercase" : "none" }}>{p.fullName || tr(lang, "yourName")}</h1>
        {p.title ? <div style={{ color: ac, fontSize: base * 1.2, fontWeight: 600, margin: "2px 0 12px" }}>{p.title}</div> : null}
        {order.filter((k) => MAIN_KEYS.includes(k)).map((k) => renderSection(k))}
      </div>
    );
    return (
      <div className="resume-sheet" style={sheet}>
        <div style={{ display: "flex", flexDirection: s.sidebar === "right" ? "row-reverse" : "row", minHeight: "297mm" }}>
          {sidebar}
          {main}
        </div>
      </div>
    );
  }

  // Single column
  return (
    <div className="resume-sheet" style={{ ...sheet, padding: "16mm 15mm" }}>
      <Header center={s.headerAlign === "center"} />
      {order.map((k) => renderSection(k))}
    </div>
  );
}
