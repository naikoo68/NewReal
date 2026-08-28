import { useEffect, useRef, useState } from "react";
import { X, Loader2, FileText, Save, Trash2, BookOpen, Sparkles } from "lucide-react";
import { aiService, practiceService } from "../../services";
import { useAuth } from "../../context/AuthContext";

// Standalone "Import full syllabus" tool. Paste (or upload a PDF of) an entire
// syllabus; the AI parses it into Subject → Topics → Subtopics; you review/edit
// the tree, then Save creates the whole structure at once under a My-Quiz stream
// (a Subject, a Topic per section, and one quiz per topic with its subtopics
// saved as the quiz's aiTopic/aiSubtopics). You can then generate questions per
// topic now or any time later — the generator is pre-filled from those fields.
export default function AiSyllabusImport({ open, onClose }) {
  const { user } = useAuth();
  const isClient = user?.role === "client" && user?.aiAccess;
  const mode = isClient ? (user?.aiMode === "self" ? "self" : "inbuilt") : undefined;

  const [text, setText] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const stopParseRef = useRef(false); // Stop button during a rate-limit wait
  const [subject, setSubject] = useState("");
  const [topics, setTopics] = useState([]); // [{ title, subtopics:[...], keep }]
  const [streams, setStreams] = useState([]);
  const [streamId, setStreamId] = useState("");
  const [newStream, setNewStream] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setText(""); setParsing(false); setSubject(""); setTopics([]); setNewStream(""); setSaving(false); setProgress({ done: 0, total: 0 }); setMsg("");
    practiceService.adminStreams("quiz").then((s) => { const list = Array.isArray(s) ? s : []; setStreams(list); setStreamId(list[0]?._id || ""); }).catch(() => setStreams([]));
  }, [open]);

  if (!open) return null;

  const idOf = (r) => r?._id || r?.id || "";
  const keptTopics = topics.filter((t) => t.keep && t.title.trim());

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    if (file.type === "application/pdf" || name.endsWith(".pdf")) {
      setPdfBusy(true); setMsg("");
      try {
        const { extractPdfText } = await import("../../lib/pdf");
        const t = await extractPdfText(file);
        setText((t || "").trim());
      } catch {
        setMsg("Couldn't read that PDF here — paste the syllabus text instead.");
      } finally { setPdfBusy(false); }
    } else {
      const reader = new FileReader();
      reader.onload = () => setText(String(reader.result || ""));
      reader.readAsText(file);
    }
  };

  const parse = async () => {
    if (!text.trim()) { setMsg("Paste or upload the syllabus first."); return; }
    setParsing(true); setMsg(""); stopParseRef.current = false;
    const MAX_TRIES = 5; // on a per-minute rate limit, wait 60s and retry a few times
    try {
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        try {
          const r = await aiService.parseSyllabus({ source: text.trim(), mode });
          setSubject(r?.subject || "");
          setTopics((r?.topics || []).map((t) => ({ title: t.title || "", subtopics: Array.isArray(t.subtopics) ? t.subtopics : [], keep: true })));
          setMsg((r?.topics || []).length ? "Review the tree below, tidy it up, then Save." : "No topics detected — paste more of the syllabus and try again.");
          return;
        } catch (e) {
          const rateLimited = /rate.?limit|quota|429|per-minute|try again|exhaust/i.test(e?.message || "");
          if (!rateLimited || attempt >= MAX_TRIES || stopParseRef.current) { setMsg(e?.message || "Couldn't parse the syllabus."); return; }
          // Wait ~60s for the per-minute window to reset, then retry (cancellable).
          for (let k = 60; k > 0 && !stopParseRef.current; k--) {
            setMsg(`Rate-limited — waiting ${k}s, then retry ${attempt + 1}/${MAX_TRIES}… (Stop to cancel)`);
            await new Promise((res) => setTimeout(res, 1000));
          }
          if (stopParseRef.current) { setMsg("Stopped. If keys are out of DAILY quota, waiting won't help — use a key from another account or try after the daily reset."); return; }
        }
      }
    } finally { setParsing(false); }
  };

  const setTitle = (i, v) => setTopics((p) => p.map((t, idx) => (idx === i ? { ...t, title: v } : t)));
  const setSubs = (i, v) => setTopics((p) => p.map((t, idx) => (idx === i ? { ...t, subtopics: v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) } : t)));
  const toggleKeep = (i) => setTopics((p) => p.map((t, idx) => (idx === i ? { ...t, keep: !t.keep } : t)));
  const removeTopic = (i) => setTopics((p) => p.filter((_, idx) => idx !== i));

  const saveAll = async () => {
    if (!subject.trim()) { setMsg("Enter a subject name."); return; }
    const keep = keptTopics;
    if (!keep.length) { setMsg("Keep at least one topic to save."); return; }
    let streamID = streamId;
    setSaving(true); setMsg(""); setProgress({ done: 0, total: keep.length });
    try {
      if (!streamID && newStream.trim()) {
        const st = await practiceService.createStream({ name: newStream.trim(), kind: "quiz" });
        streamID = idOf(st);
      }
      if (!streamID) throw new Error("Pick a Stream, or type a new Stream name, to save the syllabus under.");
      const subj = await practiceService.createSubject({ name: subject.trim(), stream: streamID });
      const subjectID = idOf(subj);
      if (!subjectID) throw new Error("Could not create the subject.");
      let done = 0;
      for (const t of keep) {
        try {
          const tp = await practiceService.createTopic({ name: t.title.trim(), subject: subjectID });
          const topicID = idOf(tp);
          if (topicID) {
            const it = await practiceService.createItem({ name: t.title.trim(), practiceStream: streamID, practiceSubject: subjectID, practiceTopic: topicID, practiceKind: "quiz" });
            const itemID = idOf(it);
            if (itemID) { try { await practiceService.updateItem(itemID, { aiTopic: t.title.trim(), aiSubtopics: t.subtopics.join(", ") }); } catch { /* subtopics are best-effort */ } }
          }
        } catch { /* skip a failed topic, keep going */ }
        done += 1; setProgress({ done, total: keep.length });
      }
      setMsg(`✓ Saved “${subject.trim()}” with ${keep.length} topic(s) under My Quiz. Open any topic's quiz and click Generate — its topic and subtopics are pre-filled, so you can generate now or later.`);
      setTopics([]); setSubject("");
    } catch (e) {
      setMsg(e.message || "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl animate-scale-in card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold"><BookOpen className="h-5 w-5 text-brand-600" /> Import full syllabus</h3>
          <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>

        <p className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Paste your whole syllabus (or upload a PDF). The AI splits it into a <b>Subject → Topics → Subtopics</b> tree. Review it, then <b>Save</b> to create everything under a My-Quiz stream in one go — you can generate questions per topic now or later.
        </p>

        <div className="mb-2 flex flex-wrap gap-2">
          <label className="btn-outline cursor-pointer">
            <FileText className="h-4 w-4" /> {pdfBusy ? "Reading…" : "Choose PDF / text file"}
            <input type="file" accept=".pdf,.txt,text/plain,application/pdf" className="hidden" onChange={onFile} />
          </label>
          {text.trim() && <button type="button" onClick={() => setText("")} className="btn-outline"><X className="h-4 w-4" /> Clear</button>}
        </div>
        <textarea
          rows={6}
          className="input resize-y font-mono text-xs"
          placeholder="Paste the full syllabus here (subject, topics and their points)…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" onClick={parse} disabled={parsing || pdfBusy || !text.trim()} className="btn-primary mt-3 w-full">
          {parsing ? <><Loader2 className="h-4 w-4 animate-spin" /> Parsing syllabus…</> : <><Sparkles className="h-4 w-4" /> Parse into Subject → Topics → Subtopics</>}
        </button>
        {parsing && (
          <button type="button" onClick={() => { stopParseRef.current = true; }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-900/20">
            <X className="h-4 w-4" /> Stop
          </button>
        )}

        {topics.length > 0 && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-semibold">Subject
              <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject name" />
            </label>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <span>{keptTopics.length} topic(s) to save</span>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto p-3">
                {topics.map((t, i) => (
                  <div key={i} className={`rounded-lg border p-2 ${t.keep ? "border-slate-200 dark:border-slate-700" : "border-slate-100 opacity-50 dark:border-slate-800"}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={t.keep} onChange={() => toggleKeep(i)} className="h-4 w-4 flex-shrink-0 accent-brand-600" title="Include this topic" />
                      <input className="input flex-1 !py-1 text-sm font-medium" value={t.title} onChange={(e) => setTitle(i, e.target.value)} placeholder="Topic title" />
                      <button type="button" onClick={() => removeTopic(i)} title="Remove topic" className="flex-shrink-0 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <textarea
                      rows={2}
                      className="input mt-1.5 resize-y text-xs"
                      value={t.subtopics.join(", ")}
                      onChange={(e) => setSubs(i, e.target.value)}
                      placeholder="Subtopics (comma or new-line separated)"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Destination stream (top level of My Quiz). */}
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-sm font-semibold">Save under (My Quiz stream)</p>
              <select value={streamId} onChange={(e) => setStreamId(e.target.value)} className="input">
                <option value="">— New stream —</option>
                {streams.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              {!streamId && (
                <input className="input mt-2" value={newStream} onChange={(e) => setNewStream(e.target.value)} placeholder="New stream name (e.g. Nursing, JKSSB)" />
              )}
            </div>

            <button type="button" onClick={saveAll} disabled={saving || !subject.trim() || !keptTopics.length} className="btn-primary w-full">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving… {progress.done}/{progress.total}</>
                : <><Save className="h-4 w-4" /> Save subject &amp; {keptTopics.length} topic(s)</>}
            </button>
          </div>
        )}

        {msg && <p className="mt-3 whitespace-pre-line text-sm font-medium">{msg}</p>}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="btn-outline">Close</button>
        </div>
      </div>
    </div>
  );
}
