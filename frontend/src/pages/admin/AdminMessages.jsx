import { useEffect, useState } from "react";
import { Mail, MailOpen, Trash2, Search, Reply } from "lucide-react";
import { messageService } from "../../services";
import { Loading, ErrorState, EmptyState } from "../../components/ui/AsyncState";

export default function AdminMessages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    messageService
      .list()
      .then((res) => setMessages(res.messages || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const open = async (m) => {
    setSelected(m);
    if (!m.read) {
      try {
        await messageService.toggleRead(m._id, true);
        setMessages((list) => list.map((x) => (x._id === m._id ? { ...x, read: true } : x)));
      } catch {
        /* non-critical */
      }
    }
  };

  const remove = async (m) => {
    if (!window.confirm(`Delete the message from ${m.name}?`)) return;
    try {
      await messageService.remove(m._id);
      setMessages((list) => list.filter((x) => x._id !== m._id));
      if (selected?._id === m._id) setSelected(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const filtered = messages.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      (m.subject || "").toLowerCase().includes(search.toLowerCase())
  );
  const unread = messages.filter((m) => !m.read).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">Messages</h1>
        <p className="text-slate-500 dark:text-slate-400">
          Enquiries submitted through the Contact page. {unread > 0 && <span className="font-semibold text-brand-600">{unread} unread</span>}
        </p>
      </div>

      {loading ? (
        <Loading label="Loading messages..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : messages.length === 0 ? (
        <EmptyState message="No messages yet. Enquiries from the Contact form will appear here." />
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages..." className="input pl-9" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
            {/* List */}
            <div className="space-y-2">
              {filtered.map((m) => (
                <button
                  key={m._id}
                  onClick={() => open(m)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                    selected?._id === m._id
                      ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/20"
                      : "border-slate-200 hover:border-brand-300 dark:border-slate-800 dark:hover:border-brand-700"
                  }`}
                >
                  <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${m.read ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"}`}>
                    {m.read ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate ${m.read ? "font-medium" : "font-bold"}`}>{m.name}</p>
                      {!m.read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" />}
                    </div>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">{m.subject || "(no subject)"}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(m.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Detail */}
            <div className="card p-6">
              {selected ? (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{selected.subject || "(no subject)"}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        From <span className="font-semibold">{selected.name}</span> · {selected.email}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(selected.createdAt).toLocaleString()}</p>
                    </div>
                    <button onClick={() => remove(selected)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed dark:bg-slate-800/60">
                    {selected.message}
                  </p>
                  <a href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject || "Your enquiry")}`} className="btn-primary mt-5">
                    <Reply className="h-4 w-4" /> Reply by Email
                  </a>
                </div>
              ) : (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-slate-400">
                  <Mail className="h-10 w-10" />
                  <p className="mt-3 text-sm">Select a message to read it.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
