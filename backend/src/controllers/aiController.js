// AI Question Generator — talks to any OpenAI-compatible provider
import AiKey from "../models/AiKey.js";
import Question from "../models/Question.js";
import Settings from "../models/Settings.js";
import { ownerFilter } from "../utils/ownership.js";
import { DEFAULT_CLIENT_PLANS } from "../utils/plans.js";
import { webResearch } from "../utils/webResearch.js";
import { splitIntoStems, contentOfBlock, questionLocation } from "./contentController.js";

// Works with any OpenAI-compatible provider (Gemini, TokenLab, OpenAI, Groq,
// DeepSeek, …). Keys come from TWO places, both used together:
//   1) Admin panel (stored in the DB) — add/enable/test keys from the UI.
//   2) Env-var slots (AI_API_KEY / AI_API_KEY_2..6 with matching AI_BASE_URL /
//      AI_MODEL) — for server-side config.
// Every model from every ENABLED key appears in the admin dropdown; each
// generation uses a key that owns the chosen model, falling back to the next
// key on a quota error. Keys live ONLY on the server.
const MAX_SLOTS = 6;
const DEFAULT_BASE = "https://api.tokenlab.sh/v1";

function envProviders() {
  const out = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const sfx = i === 1 ? "" : `_${i}`;
    const key = (process.env[`AI_API_KEY${sfx}`] || "").trim();
    if (!key) continue;
    const baseUrl = (process.env[`AI_BASE_URL${sfx}`] || DEFAULT_BASE).replace(/\/$/, "");
    const models = (process.env[`AI_MODEL${sfx}`] || "gpt-4o-mini").split(",").map((m) => m.trim()).filter(Boolean);
    out.push({ key, baseUrl, models: models.length ? models : ["gpt-4o-mini"] });
  }
  return out;
}

// A "scope" decides which key pool a request draws from:
//   { owner, includeEnv } — owner null = platform/built-in keys (admin), a user
//   id = that client's own keys. Env-var slots are only ever part of the
//   platform pool. The default scope is the platform pool (admin behaviour).
const SYSTEM_SCOPE = { owner: null, includeEnv: true, mode: "inbuilt", access: true };

// Decide the key scope for the requesting user. Non-clients (admin/student) and
// anonymous callers always use the platform pool. A client uses the pool that
// matches their chosen mode — but only within what the admin allows. A client
// with no AI access (or with both pools disabled) is denied.
function resolveScope(user, requestedMode) {
  if (!user || user.role !== "client") return { ...SYSTEM_SCOPE };
  if (!user.aiAccess) return { owner: null, includeEnv: false, access: false, denied: true };
  const allowInbuilt = user.aiAllowInbuilt !== false;
  const allowSelf = user.aiAllowSelf !== false;
  if (!allowInbuilt && !allowSelf) return { owner: null, includeEnv: false, access: false, denied: true };
  // A per-request choice (picked in the AI generator) wins over the saved
  // preference; otherwise fall back to the client's stored mode. Either way the
  // result is corrected to a pool the admin actually allows.
  const requested = requestedMode === "self" || requestedMode === "inbuilt" ? requestedMode : null;
  let mode = requested || (user.aiMode === "self" ? "self" : "inbuilt");
  if (mode === "self" && !allowSelf) mode = "inbuilt";
  if (mode === "inbuilt" && !allowInbuilt) mode = "self";
  return mode === "self"
    ? { owner: user._id, includeEnv: false, mode, access: true, allowInbuilt, allowSelf }
    : { owner: null, includeEnv: true, mode, access: true, allowInbuilt, allowSelf };
}

// Active providers for a scope = DB keys (enabled, matching owner) first, then
// env slots when the scope includes them (platform pool only).
async function providers(scope = SYSTEM_SCOPE) {
  const db = await AiKey.find({ enabled: true, owner: scope.owner ?? null }).sort("order createdAt").lean();
  const dbProviders = db
    .filter((k) => (k.key || "").trim())
    .map((k) => {
      const models = (k.models || "").split(",").map((m) => m.trim()).filter(Boolean);
      return {
        key: k.key.trim(),
        baseUrl: (k.baseUrl || DEFAULT_BASE).replace(/\/$/, ""),
        models: models.length ? models : ["gemini-2.5-flash"],
        label: (k.label || "").trim(),
      };
    });
  // DB keys first, then env slots (if in scope) — de-duplicated by key value so
  // the same key isn't used twice if it's both imported and still set in Render.
  const seen = new Set();
  const deduped = [];
  const pool = scope.includeEnv ? [...dbProviders, ...envProviders()] : dbProviders;
  for (const p of pool) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    deduped.push(p);
  }
  return deduped;
}

// Flat list of every available model with the key + base URL that serves it.
async function modelRegistry(scope = SYSTEM_SCOPE) {
  const reg = [];
  for (const p of await providers(scope)) {
    for (const m of p.models) {
      if (!reg.some((r) => r.model === m)) reg.push({ model: m, key: p.key, baseUrl: p.baseUrl });
    }
  }
  return reg;
}

// Resolve a requested model → { model, endpoints:[{key,baseUrl,model}] }.
// Endpoints now include EVERY enabled key so ALL keys act as quota fallbacks —
// not just the ones that advertise the selected model. Keys that DO support the
// selected model come FIRST (and use it); the remaining keys follow, each using
// a model it actually supports (its own first model). So when the selected-model
// keys run out of quota, generation/extraction rolls over to the other active
// keys (on their own model) instead of stopping while healthy keys sit idle.
// Each endpoint carries the exact model it should be called with.
async function resolveModel(requested, scope = SYSTEM_SCOPE) {
  const provs = await providers(scope);
  if (!provs.length) return null;
  const defModel = provs[0].models[0];
  const model = provs.some((p) => p.models.includes(requested)) ? requested : defModel;
  const supporting = []; // keys that serve the selected model (preferred, tried first)
  const others = [];     // every other enabled key, each on a model it supports
  for (const p of provs) {
    // Carry a display label so bulk jobs can surface live per-key activity
    // ("Keys working this run"), same as the question generator.
    const label = p.label || `••••${String(p.key).slice(-4)}`;
    if (p.models.includes(model)) supporting.push({ key: p.key, baseUrl: p.baseUrl, model, label });
    else others.push({ key: p.key, baseUrl: p.baseUrl, model: p.models[0] || model, label });
  }
  return { model, endpoints: [...supporting, ...others] };
}

// Try a request across the keys, moving to the next key on a quota/auth error
// (429/401/403). Each endpoint uses the model it supports (ep.model), so keys on
// a different model still work as fallbacks. Other errors aren't retried on
// another key.
async function callWithFallback({ endpoints, model, userPrompt, maxTokens, owner = null, systemPrompt, failOnEmpty = false, cooldown = null }) {
  let last = { ok: false, status: 0, detail: "No AI key is configured." };
  let sawQuota = false; // at least one key failed with a recoverable rate-limit
  let considered = 0;   // keys we actually tried (not skipped for cooldown)
  let skippedCooling = 0;
  for (const ep of endpoints || []) {
    // Per-key rate-limit cooldown: if THIS key was recently 429'd, skip it and
    // let another key answer. Only bulk jobs pass `cooldown`; single calls don't,
    // so their behaviour is unchanged. This is what lets every non-limited key
    // keep working instead of the whole job freezing on one key's limit.
    if (cooldown) {
      const until = cooldown.get(ep.key) || 0;
      if (until > Date.now()) { skippedCooling += 1; continue; }
    }
    considered += 1;
    const r = await callProvider({ key: ep.key, baseUrl: ep.baseUrl, model: ep.model || model, userPrompt, maxTokens, systemPrompt, failOnEmpty });
    if (r.ok) {
      // Record app-side usage on the matching DB key (env-only keys aren't in
      // the DB, so this is a no-op for them). Scoped by owner so a client key
      // and a platform key that share a value never cross-update. Fire-and-forget.
      AiKey.updateOne({ key: ep.key, owner: owner ?? null }, { $inc: { usedRequests: 1, usedTokens: r.tokens || 0 } }).catch(() => {});
      return r;
    }
    if (r.status === 429) {
      sawQuota = true;
      // Park THIS specific key until the provider says it's safe again
      // (Gemini returns e.g. "retryDelay":"27s"), so bulk jobs stop sending it
      // requests while it's limited but keep hammering every other key.
      if (cooldown) {
        const m = /"retryDelay"\s*:\s*"?(\d+)\s*s/i.exec(r.detail || "");
        const ms = m ? Math.min(Math.max(parseInt(m[1], 10) * 1000 + 1000, 5000), 60000) : 60000;
        cooldown.set(ep.key, Date.now() + ms);
      }
    }
    last = r;
    // 520 = a 200 with EMPTY content (safety filter / thinking-only reply). Like
    // a rate-limit, it's worth rolling over to the NEXT key/model rather than
    // giving up — another key on a stronger model may return real content.
    if (![429, 401, 403, 520].includes(r.status)) break;
  }
  // Every candidate key was in cooldown (none actually tried): report it as a
  // 429 so the bulk job briefly backs off and retries, rather than treating it
  // as a hard failure.
  if (considered === 0 && skippedCooling > 0) {
    return { ok: false, status: 429, detail: "All available keys are cooling down from rate limits." };
  }
  // Every key failed. If ANY failure was just a rate-limit (429, recoverable) but
  // the LAST key tried happened to be an unauthorized/disabled one (401/403),
  // report the error AS a 429 so bulk jobs BACK OFF and retry the remaining
  // questions instead of flagging the run "keys dead" and aborting after only a
  // few — a single disabled key must not kill a run that other keys can finish.
  if (!last.ok && sawQuota && [401, 403].includes(last.status)) {
    return { ...last, status: 429 };
  }
  return last;
}

const TYPES = ["mcq", "numericalmcq", "matching", "statement", "pair", "pairselect", "assertion", "table", "journal", "ledger", "rearrange", "diagram"];
const DIFFS = ["Easy", "Medium", "Hard"];

// --- Semantic-ish duplicate detection (so the generator stops returning the
// SAME fact reworded) -------------------------------------------------------
// Common words carry no topic meaning — ignore them when comparing questions.
const STOPWORDS = new Set(
  ("the a an of to in on at for and or but is are was were be been being do does did which what who whom whose when where why how " +
   "that this these those with without into from by as it its their his her they them following consider statement statements " +
   "correct incorrect true false not all none only both about above given below choose select mark identify option options " +
   "question answer among between will would can could should may might your you i we he she has have had than then there here")
    .split(/\s+/)
);

// The set of meaningful words in a question stem (lower-cased, length ≥ 4,
// stopwords removed) — used to measure topical overlap between two questions.
function contentTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/\$[^$]*\$/g, " ") // drop inline math so wording, not symbols, is compared
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

// Jaccard overlap of two token sets (0 = nothing shared, 1 = identical).
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Normalised text of a question's CORRECT option (a strong "same fact" signal
// for MCQ/table — a reworded duplicate keeps the same answer).
function correctAnswerNorm(q) {
  const opt = Array.isArray(q?.options) ? q.options[q?.correct] : "";
  return String(opt || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
// Structured types have generic options ("Both A and R…") so answer-matching
// there would wrongly merge distinct questions — only trust it for these
// (journal entries / ledger accounts have a distinct, meaningful correct answer like an mcq).
const ANSWER_DEDUP_TYPES = new Set(["mcq", "numericalmcq", "table", "journal", "ledger", "rearrange"]);

// Strip a leading list marker ("1.", "2)", "I.", "(iii)") from a column/statement
// item — the app auto-numbers Column A (1,2,3,4) and Column B (I,II,III,IV).
const stripListMarker = (x) =>
  String(x || "").replace(/^\s*[([]?\s*(?:\d{1,2}|[ivxlcIVXLC]{1,5})\s*[.)\]:\-]\s+/, "").trim();

// Recover numbered statements that a model dumped INTO the stem instead of the
// "columnA" array, e.g. "Consider the following statements:\n1. ...\n2. ..." or
// inline "... : (1) ... (2) ...". Returns { intro, statements } when it finds
// at least 2 numbered items, else null. Handles "1." "1)" "(1)" and
// "Statement 1:" markers, newline- or space-separated.
function extractNumbered(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const marker = /(?:^|[\n\s])(?:statement\s*)?\(?(\d{1,2})\)?\s*[.):-]\s+/gi;
  const hits = [];
  let m;
  while ((m = marker.exec(t))) hits.push({ start: m.index, contentStart: marker.lastIndex, num: parseInt(m[1], 10) });
  if (hits.length < 2) return null;
  // require the numbering to start at 1 and be broadly sequential (1,2,3…)
  if (hits[0].num !== 1) return null;
  const intro = t.slice(0, hits[0].start).trim();
  const statements = [];
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : t.length;
    const s = t.slice(hits[i].contentStart, end).trim();
    if (s) statements.push(s);
  }
  return statements.length >= 2 ? { intro, statements } : null;
}

// Like extractNumbered, but for sentences a model numbered with ROMAN numerals
// in the stem — "… : I. <one>. II. <two>. III. <three>. IV. <four>". Used to
// split a rearrange question's sentences out of the paragraph into columnA.
function extractRomanNumbered(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const ROM = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  const marker = /(?:^|[\n\s(])(viii|vii|vi|iv|iii|ii|v|i)\s*[.):\-]\s+/gi;
  const hits = [];
  let m;
  while ((m = marker.exec(t))) hits.push({ start: m.index, contentStart: marker.lastIndex, num: ROM[m[1].toLowerCase()] });
  if (hits.length < 2 || hits[0].num !== 1) return null;
  // Require a strictly sequential I, II, III, IV… run (guards against a stray
  // "I"/"V" inside a sentence being mistaken for a marker).
  for (let i = 1; i < hits.length; i++) if (hits[i].num !== hits[i - 1].num + 1) return null;
  const intro = t.slice(0, hits[0].start).trim();
  const statements = [];
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : t.length;
    const s = t.slice(hits[i].contentStart, end).trim();
    if (s) statements.push(s);
  }
  return statements.length >= 2 ? { intro, statements } : null;
}

// Split a combined "Left — Right" pair string into [left, right] on the first
// dash / arrow / colon separator (e.g. "Dal Lake — Srinagar").
function splitPairString(s) {
  const str = String(s || "").trim();
  const m = str.match(/^(.*?\S)\s*(?:—|–|→|=>|->|::|:|\s-\s|\t)\s*(\S.*)$/);
  return m ? [m[1].trim(), m[2].trim()] : [str, ""];
}

// Robustly derive Column A (left) + Column B (right) for matching / pair /
// pairselect questions from whatever shape the model returned. The prompt asks
// for "columnA"/"columnB" arrays, but models sometimes put the pairs under a
// different key ("pairs", "matches", …), as arrays of {left,right} objects,
// [a,b] tuples, or "A — B" strings. Recover them all so pairs never go missing.
function derivePairColumns(q) {
  const asS = (x) => (x == null ? "" : String(x));
  const has = (arr) => arr.some((x) => x.trim());
  let a = Array.isArray(q?.columnA) ? q.columnA.map(asS) : [];
  let b = Array.isArray(q?.columnB) ? q.columnB.map(asS) : [];
  if (has(a) && has(b)) return splitCombinedIfNeeded(a, b);

  // A combined pair list may live under any of these common alternate keys.
  const combined = [q?.pairs, q?.matches, q?.matchingPairs, q?.matchedPairs, q?.matching, q?.items, q?.list, q?.rows]
    .find((v) => Array.isArray(v) && v.length);
  if (combined) {
    const la = [], lb = [];
    for (const it of combined) {
      if (Array.isArray(it)) { la.push(asS(it[0])); lb.push(asS(it[1])); }
      else if (it && typeof it === "object") {
        const left = it.left ?? it.a ?? it.columnA ?? it.term ?? it.first ?? it.key ?? it.name ?? it.item ?? it.question;
        const right = it.right ?? it.b ?? it.columnB ?? it.definition ?? it.match ?? it.second ?? it.value ?? it.answer ?? it.pair;
        la.push(asS(left)); lb.push(asS(right));
      } else {
        const [l, r] = splitPairString(it);
        la.push(l); lb.push(r);
      }
    }
    if (has(la) && has(lb)) return { columnA: la, columnB: lb };
    if (has(la) && !has(a)) a = la;
  }
  return splitCombinedIfNeeded(a, b);
}

// If only ONE column came back but EVERY item looks like a combined
// "Left — Right" pair, split each into the two columns.
function splitCombinedIfNeeded(a, b) {
  if (a.some((x) => x.trim()) && !b.some((x) => x.trim()) && a.every((x) => splitPairString(x)[1])) {
    const la = [], lb = [];
    for (const it of a) { const [l, r] = splitPairString(it); la.push(l); lb.push(r); }
    return { columnA: la, columnB: lb };
  }
  return { columnA: a, columnB: b };
}

// GET /api/ai/status — lets the admin UI show/hide the "Generate with AI"
// button and populate the model dropdown.
export async function aiStatus(req, res) {
  const scope = resolveScope(req.user, req.query?.mode);
  if (scope.denied) {
    return res.json({ enabled: false, denied: true, mode: null, keys: 0, models: [], model: "" });
  }
  const reg = await modelRegistry(scope);
  const provs = await providers(scope);
  const limits = await effectiveAiLimits(req.user);
  const isClient = req.user?.role === "client";
  let used = 0;
  let remaining = null; // null = unlimited (admin)
  if (isClient && limits.perWindow !== Infinity) {
    used = aiRecentUsage(String(req.user._id), limits.windowMinutes * 60 * 1000);
    remaining = Math.max(0, limits.perWindow - used);
  }
  res.json({
    enabled: reg.length > 0,
    mode: scope.mode, // "inbuilt" | "self" — which pool this request used
    model: reg[0]?.model || "", // default / first configured model
    models: reg.map((r) => r.model), // every model across all keys (dropdown)
    keys: provs.length, // how many API keys are active in this scope
    // AI generation limits for this account — drives the generator's max input
    // and the quota display.
    maxPerBatch: limits.maxPerBatch,
    perWindow: limits.perWindow === Infinity ? null : limits.perWindow,
    windowMinutes: limits.windowMinutes,
    planName: limits.planName,
    used,
    remaining,
  });
}

// Keep every AI path (generate / outline / coverage) STRICTLY inside the named
// topic and out of sibling topics that are studied as their own chapters.
const TOPIC_SCOPE_RULE =
  "TOPIC SCOPE DISCIPLINE (critical): treat the given topic as a SPECIFIC, self-contained syllabus chapter and cover ONLY what genuinely belongs to it. Do NOT drift into ADJACENT / sibling topics that are studied as their OWN separate chapters. For example, if the topic is Physiography (relief, landforms, mountains, plateaus, plains, passes, glaciers, geology, tectonics) then EXCLUDE Drainage / River systems, Climate, Soils, Natural vegetation, Wildlife, Population and Economy — each of those is its own separate topic. Likewise Climate excludes physiography and rivers; Rivers / Drainage excludes climate and relief; and so on for any topic. If a concept overlaps two topics, treat it ONLY from the named topic's angle and never as the sibling topic's own content.";

const SYSTEM_PROMPT = `You are an exam-preparation question writer. You output ONLY valid JSON, no markdown, no commentary.
Return an object of the exact shape: {"questions": [ ... ]}.
Each question object uses these fields:
- "type": one of "mcq", "numericalmcq", "matching", "statement", "pair", "pairselect", "assertion", "table", "journal", "ledger", "rearrange", "diagram".
- "text": the question stem (may include LaTeX between $...$).
- "options": array of EXACTLY 4 answer strings.
- "correct": 0-based index (0-3) of the correct option in "options".
- "difficulty": one of "Easy", "Medium", "Hard".
- "explanation": a THOROUGH, self-contained explanation of the correct answer (3-6 sentences). Include EVERY relevant supporting fact a student needs — exact dates/years, historical background, definitions, full formulas WITH the actual calculation, laws/theorems/principles by name, cause-and-effect reasoning, and any key names, places or numbers. Never give a one-line answer or just restate the option; teach the concept as if to someone seeing it for the first time. FORMATTING: break the explanation into MULTIPLE short lines — put each sentence or distinct point on its OWN line (use a line break between points, and a blank line between grouped points); NEVER write it as one long paragraph. EXPLANATION SCOPE BY TYPE (IMPORTANT): for a plain "mcq", the explanation must teach ONLY the correct option in depth — do NOT mention, compare or justify the three incorrect options in it. For EVERY OTHER type (matching, statement, pair, pairselect, assertion, table, journal, ledger), the explanation MUST instead walk through each pairing / statement / sub-option / journal entry / ledger posting and the assertion–reason relationship — the correct ones AND the incorrect ones — in detail, exactly as the type-specific rules below require.
- FORMER / RENAMED NAMES (use SPARINGLY — not in every question): ONLY when a term, place, person, organisation, scheme or law genuinely has a HISTORY of a former/old name or an official rename do you mention that former name in brackets the FIRST time it appears — e.g. "Mumbai (formerly Bombay)", "ISRO (formerly INCOSPAR)", "Chennai (formerly Madras)". You MAY also give a widely-known abbreviation's full form once where it truly aids understanding (e.g. "Tuberculosis (TB)"). Do NOT add a name where none is historically warranted: NEVER translate ordinary academic/technical terms into Hindi/vernacular or invent local glosses (write "Mode", NOT "Mode ('bahulak')"; "Mean", NOT "Mean ('samantar madhya')"; "Median", NOT "Median ('madhyika')"), and do NOT force a synonym/alternative name into questions. Most questions need NO bracketed alternative name at all — add one only for a genuine rename/former name (or a truly essential abbreviation), and only where it is actually helpful.
- "optionExplanations": array of EXACTLY 4 strings, one per option, clearly explaining why each specific option is right or wrong — for the WRONG options name the exact misconception or fact that makes them incorrect. This applies to EVERY type INCLUDING plain "mcq": for an mcq each incorrect option MUST still get its own note here (these appear under each option), even though the "explanation" box itself stays focused only on the correct option. Add a former/renamed name of an option in brackets ONLY when one genuinely exists (see the FORMER / RENAMED NAMES rule) — do NOT add vernacular/Hindi glosses or forced synonyms — and leave the truly-correct option's entry an empty string "". EXCEPTION — for CALCULATION-based questions (see "numerical" below), leave ALL FOUR entries as empty strings "".
- "numerical": true ONLY when the question is answered by CALCULATION (arithmetic, applying a formula, or solving an equation to reach a value); otherwise false. When it is true, the step-by-step working in "explanation" IS the full justification — so set ALL FOUR "optionExplanations" to empty strings "" and do NOT write any per-option "why it is wrong" notes.
- "correct": distribute the correct answer's position EVENLY and RANDOMLY across the four options over the whole set — do NOT keep putting the answer at option A. Aim for a roughly equal spread of correct answers landing on positions 0, 1, 2 and 3.
Type-specific rules — each type needs specific extra fields AND a specific style of "options":
- "mcq": a normal (DESCRIPTIVE / conceptual) question with 4 plausible options; "correct" is the right one. It is answered from knowledge/reasoning, NOT by calculation. No extra fields.
- "numericalmcq": a CALCULATION-based multiple-choice question — the SAME 4-option shape as "mcq", but the answer is reached by arithmetic, applying a formula, or solving an equation, and ALL FOUR "options" are NUMERIC values (each wrapped in $...$, e.g. "$1250$", "$3.5\\ \\text{m/s}$"). Choose the relevant formula, substitute the given values, and compute; mark ONLY the option equal to your computed result. The three distractors must be PLAUSIBLE wrong values from classic mistakes (wrong formula, unit slip, sign error, off-by-a-factor, rounding) — never random or absurd numbers, and all four in the same unit and similar magnitude. In "explanation", show the FULL step-by-step working with each calculation step on its own line (state the formula, the substitution, then the result). Set "numerical": true and leave ALL FOUR "optionExplanations" as empty strings "". Use "numericalmcq" ONLY for genuinely computational questions; a fact/definition/reasoning question with a number in it is still a plain "mcq".
- "rearrange": a SENTENCE / PARAGRAPH REARRANGEMENT (jumbled-sentence ordering) question. REQUIRED — put the FOUR jumbled sentences in "columnA" as an array of EXACTLY 4 complete sentence strings. The app displays them each in its own numbered box as I, II, III, IV automatically, so do NOT prefix them with numbers/labels and do NOT put the sentences inside "text". "text" is ONLY the instruction line, e.g. "Rearrange the following sentences to form a meaningful paragraph:". The 4 "options" are FOUR candidate ORDERINGS written as Roman numerals joined by hyphens, matching the columnA order (columnA[0]=I, columnA[1]=II, columnA[2]=III, columnA[3]=IV) — e.g. "IV-II-I-III", "I-IV-III-II", "IV-I-II-III", "I-IV-II-III". EXACTLY ONE option is the correct logical order; the other three are plausible but wrong orders (do NOT make them obviously silly). In "explanation", state the correct sequence and WHY it flows — which sentence must OPEN the paragraph (usually the one that introduces the subject/sets the context; a sentence starting with a pronoun like "He/It/This/These" cannot open because its subject isn't introduced yet), how each sentence logically follows the previous one, and which sentence CONCLUDES it. The 4 "optionExplanations" each say why that ordering is right or wrong (e.g. "puts the conclusion (III) before the cause (II)", or "opens with a pronoun before the subject is named"); leave the correct option's entry an empty string "". Keep "numerical": false.
- "journal": an ACCOUNTING question on JOURNAL ENTRIES (double-entry bookkeeping — recording a transaction in the journal, NOT posting to a ledger account). Put the transaction/scenario and the exact task in "text" (e.g. "Journalise the following transaction: Purchased goods for cash worth 5,000." or "Rahul started business with cash 1,00,000. Which journal entry records this?"). The 4 "options" are FOUR candidate answers of the SAME accounting form — each a COMPLETE journal entry written as a PIPE-DELIMITED TABLE in the STANDARD TEXTBOOK JOURNAL FORMAT with EXACTLY these five columns: "Date | Particulars | LF | Amount(Dr.) | Amount(Cr.)". FORMAT EACH OPTION LIKE THIS — a header row exactly "Date | Particulars | LF | Amount(Dr.) | Amount(Cr.)", then ONE row per line of the entry, rows separated by a real newline "\\n": a DEBITED account → Particulars is "<Account> A/c Dr." with its amount in the "Amount(Dr.)" column and Date/LF/"Amount(Cr.)" EMPTY; a CREDITED account → Particulars is "To <Account> A/c" (prefixed with "To ") with its amount in the "Amount(Cr.)" column and Date/LF/"Amount(Dr.)" EMPTY; a final NARRATION row → Particulars is "(Being … )" describing the transaction with all other columns EMPTY. List ALL debit line(s) first, then all credit line(s), then the narration. Wrap EVERY row (header and each line) in outer "|" pipes and give EVERY row exactly five cells — put empty cells between pipes for Date, LF and the unused amount column. Do NOT add a "---" separator row. Example option value: "| Date | Particulars | LF | Amount(Dr.) | Amount(Cr.) |\\n| | Cash/Bank A/c Dr. | | 80,000 | |\\n| | Assets A/c Dr. | | 30,000 | |\\n| | To Capital A/c | | | 1,10,000 |\\n| | (Being business started with cash and assets) | | | |". EVERY option MUST use this SAME five-column table format so it renders as a proper journal, NOT a plain sentence. Exactly ONE option is correct; the three distractors are the PLAUSIBLE, classic mistakes — the debit and credit reversed, the wrong account used (e.g. Purchases vs Cash vs Capital), a real/nominal/personal misclassification, or a wrong amount. RULES OF DEBIT & CREDIT (apply correctly and state which you used): modern rules — an increase in an ASSET or EXPENSE/loss is a DEBIT, an increase in a LIABILITY, CAPITAL or INCOME/gain is a CREDIT; OR traditional rules — Personal a/c: debit the receiver, credit the giver; Real a/c: debit what comes in, credit what goes out; Nominal a/c: debit all expenses & losses, credit all incomes & gains. EVERY entry MUST BALANCE — total debit = total credit. Use correct standard account names ("Cash A/c", "Purchases A/c", "Sales A/c", "Capital A/c", "Bank A/c", "Salaries A/c", "Furniture A/c", "Drawings A/c", etc.). Write amounts as PLAIN numbers (e.g. 5,000 or 1,00,000) with NO "$" and NO currency symbol — "$...$" is ONLY for genuine math, never for money. In "explanation", name the account(s) debited and credited, classify each account (asset/liability/capital/income/expense OR personal/real/nominal), state the exact rule applied, and CONFIRM that the debit total equals the credit total; the 4 "optionExplanations" say why each wrong option is wrong (reversed entry, wrong account, wrong classification, or unbalanced). This is answered by reasoning, so keep "numerical": false.
- "ledger": an ACCOUNTING question on LEDGER POSTING — preparing/balancing a LEDGER ACCOUNT (a T-account) from given transactions or journal entries (double-entry bookkeeping). This is DIFFERENT from "journal": here the answer is a posted LEDGER ACCOUNT, NOT a journal entry. Put the transactions/journal entries and the exact task in "text" (e.g. "From the following transactions, prepare the Cash A/c and choose the correctly posted & balanced ledger account:" or "The given journal entries are posted to the ledger — which is the correct Cash A/c with its closing balance?"). The 4 "options" are FOUR candidate LEDGER ACCOUNTS of the SAME account, each written as a PIPE-DELIMITED T-ACCOUNT TABLE in the STANDARD TEXTBOOK LEDGER FORMAT with EXACTLY these EIGHT columns — the DEBIT (left) side then the CREDIT (right) side: "Date | Particulars | J.F. | Amount | Date | Particulars | J.F. | Amount". FORMAT EACH OPTION LIKE THIS — a header row exactly "Date | Particulars | J.F. | Amount | Date | Particulars | J.F. | Amount", then ONE row per posting line, rows separated by a real newline "\\n": a DEBIT-side posting → left "Particulars" is "To <Account> A/c" with its figure in the left "Amount" column (right-side cells EMPTY); a CREDIT-side posting → right "Particulars" is "By <Account> A/c" with its figure in the right "Amount" column (left-side cells EMPTY); the BALANCING FIGURE is "By Balance c/d" placed on the CREDIT side when the account has a debit balance (or "To Balance c/d" on the DEBIT side when it has a credit balance); a final TOTALS row shows the two EQUAL side totals (in the two "Amount" columns) with the Particulars cells empty. Debit-side and credit-side postings that fall on the SAME row share one line separated by pipes; leave the unused side's cells EMPTY. Wrap EVERY row in outer "|" pipes and give EVERY row EXACTLY eight cells (put empty cells between pipes for unused Date/J.F./Particulars/Amount cells). Do NOT add a "---" separator row. Example option value: "| Date | Particulars | J.F. | Amount | Date | Particulars | J.F. | Amount |\\n| | To Capital A/c | | 1,00,000 | | By Purchases A/c | | 20,000 |\\n| | | | | | By Balance c/d | | 80,000 |\\n| | | | 1,00,000 | | | | 1,00,000 |". EVERY option MUST use this SAME eight-column T-account format so it renders as a proper ledger — NOT a journal entry and NOT a plain sentence. Exactly ONE option is correct; the three distractors are the PLAUSIBLE, classic mistakes — a posting put on the WRONG side (debit vs credit swapped), "To" vs "By" misused, the wrong account posted, an account that does NOT balance, or a wrong closing "Balance c/d". RULES: post to the DEBIT (left, "To …") side when the account receives value / an asset or expense increases; post to the CREDIT (right, "By …") side when it gives value / a liability, capital or income increases; the two side totals MUST be EQUAL, and the closing "Balance c/d" is the difference entered on the SMALLER side so both sides total the same. Use correct standard account names ("Cash A/c", "Capital A/c", "Purchases A/c", "Sales A/c", "Bank A/c", etc.). Write amounts as PLAIN numbers (e.g. 5,000 or 1,00,000) with NO "$" and NO currency symbol. In "explanation", post each entry to the correct side naming the account and the side (Dr./Cr., To/By), state the rule applied, and CONFIRM the two side totals are equal and the closing balance is correct; the 4 "optionExplanations" say why each wrong option is wrong (wrong side, To/By misuse, wrong account, unbalanced, or wrong balance). This is answered by reasoning, so keep "numerical": false.
- "matching": include "columnA" (array) and "columnB" (array) — the two lists to match. The 4 "options" are FULL MAPPING SEQUENCES like "1-III, 2-I, 3-IV, 4-II" (Column A is auto-numbered 1,2,3,4; Column B is I,II,III,IV). Exactly one option is the correct complete mapping; the others are wrong mappings. In "explanation", justify EVERY correct pairing individually (e.g. "1-III because …; 2-I because …") with the fact/definition behind each match.
- "statement": REQUIRED — put the individual statements in "columnA" as an array of 2-4 complete statement SENTENCES (e.g. ["The carbon cycle involves photosynthesis and respiration.","Nitrogen fixation is performed only by plants."]). "columnA" must NEVER be empty. "text" is ONLY the intro line ending with a colon (e.g. "Consider the following statements regarding the nitrogen cycle:") — do NOT put the numbered statements inside "text", and do NOT rely on the explanation alone to describe them. The 4 "options" are COMBINATIONS like "1 only", "2 only", "1 and 2 only", "Neither 1 nor 2". In "explanation", evaluate EACH statement (1, 2, …) as true/false with the reason.
- "pair": include "columnA" (left items) and "columnB" (right items); item i is paired with item i. "text" is ONLY the intro line (e.g. "Consider the following pairs:") — the pairs themselves MUST be the arrays "columnA" and "columnB", each with 3-4 items and the SAME length. NEVER put the pair items inside "text", and NEVER use a different key such as "pairs"/"matches". The 4 "options" state HOW MANY pairs are correctly matched, e.g. "Only one pair", "Only two pairs", "Only three pairs", "All four pairs". In "explanation", go through EACH pair stating whether it is correctly matched and the fact behind it.
- "pairselect": include "columnA" and "columnB" (candidate pairs), each with 3-4 items of the SAME length; put them ONLY in these arrays (NOT inside "text", NOT under any other key). "text" is only the intro line. The 4 "options" state WHICH pairs are correct, e.g. "1 and 2 only", "2 and 3 only", "1, 3 and 4 only", "All of the above". In "explanation", go through EACH pair stating whether it is correct or wrong and why.
- "assertion": REQUIRED — you MUST include BOTH "assertion" (the full Assertion A statement) and "reason" (the full Reason R statement) as NON-EMPTY, complete standalone sentences. NEVER leave "assertion" or "reason" blank, and NEVER put the A/R statements only inside "explanation" or "text" — the actual statements MUST be in the "assertion" and "reason" fields ("text" may be empty). The 4 "options" MUST be exactly: "Both A and R are true and R is the correct explanation of A", "Both A and R are true but R is NOT the correct explanation of A", "A is true but R is false", "A is false but R is true". In "explanation", separately evaluate Assertion (A) — state true/false and WHY with supporting facts — then separately evaluate Reason (R) — true/false and WHY — and finally explain the RELATIONSHIP: whether R correctly explains A and why.
- "table": put the data table in "tableRows" (a 2D array; the first inner array is the header row) — NEVER write it as a markdown/pipe ("| a | b |") table inside "text". "text" is ONLY the question sentence. Wrap any math in a cell in $...$. 4 normal options that match a calculation done from the table.
- "diagram": a DIAGRAMMATIC question — the student answers by reading a DIAGRAM/CHART that the app renders from a structured spec (the "Visualization Studio" engine). REQUIRED — include a "viz" object (see "DIAGRAM SPEC (\\"viz\\")" below) that fully describes the figure as DATA, never prose or an image URL. "text" is ONLY the question sentence and MUST refer to the rendered figure (e.g. "Study the bar chart below. Which year recorded the highest exports?", "From the flowchart, which stage immediately follows fertilisation?"). Provide the usual 4 "options" and the 0-based "correct" index; the answer MUST be derivable purely from what the diagram shows. The 4 "optionExplanations" say, using values/relationships read off the diagram, why each option is right or wrong (leave the correct one ""). In "explanation", walk through HOW to read the diagram to reach the answer (which bar/slice/node/axis value to compare). Keep "numerical": false unless the answer needs an actual calculation from the plotted values. Choose a diagram type that genuinely aids the question — do NOT attach a decorative chart to a plain factual question (use "mcq" for those).
DIAGRAM SPEC ("viz") — the exact JSON grammar the Visualization Engine accepts (output the object VERBATIM in the question's "viz" field; every "viz" MUST have a "type"):
  • Charts (Chart.js) — "type" one of "bar","line","pie","doughnut","scatter","bubble","radar","polarArea": {"type":"bar","title":"Exports by Year","labels":["2019","2020","2021","2022"],"series":[{"name":"Exports","data":[120,90,150,170]}],"options":{"beginAtZero":true}}. For "scatter"/"bubble" each series uses "data":[{"x":1,"y":2},…] (bubble adds "r"). Use "labels" for the category axis and one or more "series" (each {"name","data":[…]}); numeric arrays must align with "labels".
  • Flow / process / tree / mindmap / ER / sequence / state / class / gantt / timeline diagrams — use Mermaid: {"type":"flowchart","title":"Water Cycle","code":"flowchart TD\\nA[Evaporation]-->B[Condensation]\\nB-->C[Precipitation]\\nC-->D[Collection]\\nD-->A"}. STRICT MERMAID SYNTAX (invalid code shows an error to the student, so follow EXACTLY):
    - Put valid Mermaid source in "code" with real newlines (\\n) and a FIRST line that names the diagram kind: "flowchart TD" (or LR), "stateDiagram-v2", "sequenceDiagram", "classDiagram", "erDiagram", "mindmap", "gantt", or "timeline".
    - EDGES: in flowcharts/graphs join nodes with "-->" ONLY (e.g. A-->B). NEVER use the Unicode arrow "\u2192", "->", "=>" or "\\rightarrow" inside "code" — the global rule about the "\u2192" character does NOT apply inside a Mermaid diagram. To put an arrow in a NODE'S LABEL, keep it inside the brackets, e.g. A["socket() \u2192 bind()"].
    - NODES: give each node a SHORT id of letters/digits only (no spaces, no punctuation, e.g. A, B, S1, Gen), and put the human text in brackets after it. ALWAYS WRAP THE LABEL IN DOUBLE QUOTES — A["Access Point (AP)"], B["Client / STA"], C["Ack: 200 OK"] — so parentheses, slashes, colons, commas and ampersands in the label never break the parser. Reuse the same id to reference the same node — do NOT concatenate ids (write "KeyGenInit-->KeyDerived", never "KeyGen-InitKeyGen-Init").
    - stateDiagram-v2: use "[*] --> StateName" for the start and transitions like "Init --> Derived: success"; state ids must be single tokens (no spaces/hyphens — use CamelCase like KeyGenInit).
    - sequenceDiagram: use "participant A" then messages like "A->>B: message".
    - Keep it to ~4\u20138 nodes and make sure every node/edge referenced is defined.
  • Networks / graphs (nodes & edges): {"type":"graph","title":"Food Web","graph":{"nodes":[{"id":"a","label":"Grass"},{"id":"b","label":"Rabbit"}],"edges":[{"source":"a","target":"b"}],"directed":true}}.
  CHOOSE THE DIAGRAM KIND THAT MATCHES THE SUBJECT — use the representation a textbook in THAT subject would use, NOT a generic flowchart of boxes for everything:
    - ECONOMICS supply & demand, cost/revenue curves, equilibrium, price\u2013quantity or any two-variable relationship → a Chart.js "line" chart (NEVER a flowchart of boxes). Put Quantity on the x-axis ("labels") and Price on the y-axis, with a DOWNWARD-sloping "Demand" series and an UPWARD-sloping "Supply" series that CROSS at the equilibrium. Example: {"type":"line","title":"Market Equilibrium (Price vs Quantity)","labels":["0","20","40","60","80","100"],"series":[{"name":"Demand","data":[100,80,60,40,20,0]},{"name":"Supply","data":[0,20,40,60,80,100]}],"options":{"beginAtZero":true}} — the lines cross at Quantity 50 / Price 50 (the equilibrium). Model a shift by moving one series (e.g. Supply left/up) so the new crossing point changes.
    - Trends over time, growth/decay, comparisons of values, distributions/proportions → charts: "line" (trend), "bar" (compare), "pie"/"doughnut" (share of a whole), "scatter" (correlation).
    - Processes, algorithms, lifecycles, workflows, protocol exchanges, hierarchies, classifications, state machines → Mermaid ("flowchart"/"stateDiagram-v2"/"sequenceDiagram"/"classDiagram"/"erDiagram"/"mindmap").
    - Relationships/connections between entities (food webs, computer/social networks, topologies) → a "graph".
    NEVER represent a quantitative curve (like supply & demand) as flowchart boxes, and never force an unrelated subject's diagram style onto a question — pick the kind that genuinely fits the concept being tested.
  KEEP IT SELF-CONSISTENT: the correct answer and every distractor must be readable from the spec you provide (e.g. if you ask which year is highest, the "data" must make exactly one year the clear maximum). The diagram MUST depict the EXACT subject/system named in the question — never a generic, decorative or unrelated figure (e.g. a question about the "socket interface lifecycle" must show socket()/bind()/listen()/accept() nodes, NOT the parts of a cable). Keep labels short, values simple and the figure uncluttered (aim for 3–8 data points / nodes). Do NOT put a currency "$" in any viz value, and do NOT reference the diagram only in words without providing the matching "viz".
Do NOT prefix columnA / columnB / statement items with numbers or roman numerals (no "1.", "I.") — the app numbers Column A (1,2,3,4), Column B (I,II,III,IV) and statements (1,2,3) automatically.
OPTIONAL DIAGRAM ("graph"): ONLY when a question genuinely needs a diagram to be answered or understood — e.g. an ECONOMICS supply/demand curve, a shift, an equilibrium, a cost curve, or any simple straight-line/curve relationship — include a "graph" object. The app DRAWS it as a labelled chart, so provide DATA, not prose. Shape: {"xLabel":"Quantity","yLabel":"Price","lines":[{"label":"Demand","points":[[0,100],[100,0]]},{"label":"Supply","points":[[0,0],[100,100]]}],"points":[{"label":"E (equilibrium)","x":50,"y":50}]}. Rules for "graph": use a consistent numeric scale for all points; each line needs a short "label" and at least two [x,y] points (use 3-6 points for a curve); put key intersections/equilibria in "points" with a short label; keep values simple (0-100 is ideal). If the question also refers to the diagram in words, keep "text" as the question itself (e.g. "In the diagram, the equilibrium price is:"). OMIT "graph" entirely for questions that don't need a visual (most questions) — never add a decorative or irrelevant graph.
VARIETY IS MANDATORY: within the set, every question must test a DIFFERENT fact / sub-topic and a DIFFERENT angle (definition, cause, effect, date or number, example, comparison, application, exception, sequence). NEVER ask about the same fact, entity or correct answer more than once, and NEVER reword or rephrase another question — a different sentence with the same meaning counts as a duplicate and is forbidden. Spread the questions across the full breadth of the topic rather than clustering on the few most obvious facts.
SAME-CATEGORY OPTIONS (CRITICAL FOR PLAUSIBILITY): all four "options" MUST belong to the SAME real-world category, type and format as the correct answer, so every wrong option is a genuine, closely-related distractor — never off-topic or an obvious give-away. If the answer is a plant/tree, ALL four options are real plant/tree names; if a person, all are people of the same field/era; if a river, all are rivers; if a place, all are comparable places; if a date/year, all are plausible nearby dates; and likewise for chemicals, diseases, units, languages, books, laws, awards, animals, festivals, etc. Match the grammatical form, language, length and level of specificity across the four options, and prefer real, well-known members of that category that a knowledgeable student could genuinely confuse with the answer. NEVER mix unrelated kinds (for example, for "the Kashmiri name of the Chinar TREE", every option must be a tree name — do NOT put a flower, a bird or an unrelated word among them).
CALCULATIONS & SELF-VERIFICATION (do this for EVERY question before you finalise it):
- NUMERICAL / QUANTITATIVE questions: pick the correct FORMULA for the concept, substitute the actual values, and COMPUTE the answer step by step. Mark as "correct" ONLY the option that EXACTLY equals your computed result; make the other three plausible but genuinely wrong (each reflecting a specific common mistake). In "explanation" show the full working — formula, then substitution, then each intermediate result, then the final value — each step on its OWN line. NEVER mark an answer your own calculation does not produce, and make sure the explanation's steps end at the marked option. Set "numerical": true for these questions and leave ALL FOUR "optionExplanations" as empty strings "" (the working in the explanation is enough).
- MATCHING / PAIR / STATEMENT questions: verify each pairing/statement individually and make "correct" reflect the TRUE count/combination (and provide an option that matches it).
- Re-check every calculation and fact; the marked "correct" option and the "optionExplanations" must be mutually consistent.
MATH RENDERING (so numericals display correctly): wrap EVERY mathematical element in $...$ (inline LaTeX) — in the "text", the "options" AND the "explanation". This includes each numeric ANSWER OPTION that is a number/quantity/expression (e.g. options "$12.5$", "$\\frac{3}{4}$", "$2^{10}$", "$25\\%$", "$\\sqrt{2}$", "$3:4$"), every fraction, power, root, ratio, percentage and equation, and each step of a calculation. A plain number that is only ordinary prose (a year, a page count) need not be wrapped, but any numeric option or math expression MUST be. Use $...$ only (never \\( \\) or \\[ \\]) and never write bare LaTeX commands outside dollar signs. NEVER wrap ordinary words, names, proper nouns, transliterated/Sanskrit/vernacular terms or whole phrases in $...$ (write Natya, abhinaya, Abhinaya Darpana — NOT $Natya$, $abhinaya$, $AbhinayaDarpana$); $...$ is EXCLUSIVELY for numbers, numeric values, units, scientific/chemical symbols, variables and formulas. For a simple arrow between items (a route/sequence such as "Lakhanpur → Samba → Udhampur → Banihal"), use the plain Unicode arrow character → directly — do NOT write \\rightarrow or \\to.
CURRENCY: NEVER use the "$" character for money/amounts anywhere ("text", "options", "explanation", "optionExplanations") — "$" is reserved ONLY for wrapping inline math, and a stray "$" (e.g. "$300") corrupts the rendering of the whole field. Write money as a plain number with the currency word, e.g. "300 dollars" or "900 rupees" or just "300".
LAWS / BILLS / ACTS / AMENDMENTS & DATES (accuracy is critical): base any question about a law, bill, act, amendment, ordinance, scheme, treaty, appointment, report or event ONLY on the REAL, verifiable item with its CORRECT details — never invent a hypothetical, fictional or unconfirmed one. When such an item is identified by a year, CONSIDER AND USE ITS EXACT DATE (day, month and year of introduction / passage / enactment / coming into force, as applicable) — do NOT rely on the year alone; state the precise date in the question and/or explanation where relevant. If the exact date or specific provisions of a very recent item are not reliably known to you, do NOT fabricate a date, a strength/number or a provision — instead ask about the established, verifiable facts (or omit that question). Never present an assumed year without the confirmed exact date as if it were fact.
${TOPIC_SCOPE_RULE}
COMPLETE SYLLABUS COVERAGE (top priority for CHOOSING what to ask):
You are an expert educational assessment designer and subject specialist. Before writing, mentally build a SYLLABUS MAP of the topic exactly as covered in NCERT, standard university textbooks and competitive examinations (and current affairs where relevant), listing its major concepts, subtopics and micro-topics across EVERY applicable category: introduction, definitions, terminology, components, classification, principles, causes, processes, mechanisms, types, characteristics, distribution, factors, effects, importance, advantages, disadvantages, applications, examples, exceptions, comparisons, frequently-confused concepts, numericals/formulas and maps/diagrams (where applicable), plus current affairs, recent research and government policies. Also cover, wherever they apply, the historical, geographical, scientific, economic, environmental, political, technological and current dimensions, and the regional, national and international aspects.
Then DISTRIBUTE the questions PROPORTIONALLY across ALL those sections so the batch MAXIMISES breadth — never exhaust one chapter or cluster on the few most obvious facts. Ensure every important concept, definition and term is tested at least ONCE before any concept is repeated. Cover BOTH the static and the dynamic portions of the syllabus, include all important terminology, and keep strict factual accuracy to the above standards.
NEVER test the same fact/concept twice with different wording — a reworded question on an already-covered concept is a FORBIDDEN duplicate.
BATCH CONTINUATION: treat any "already exist" list provided as concepts ALREADY COVERED. Continue from UNCOVERED concepts first; do NOT repeat or revise a covered concept unless explicitly asked. Only once the syllabus breadth is fully covered should you move on to advanced conceptual, analytical, interdisciplinary and current-affairs questions.
Never include image URLs. Keep questions factually correct and self-contained.`;

// Parse a model reply into an array of short strings — tolerant of code fences,
// a surrounding JSON array, or a plain bulleted/numbered list.
function parseStringArray(text) {
  if (!text) return [];
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const m = t.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean);
    } catch { /* fall through to line parsing */ }
  }
  return t
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").replace(/^["'\s]+|["',\s]+$/g, "").trim())
    .filter((l) => l.length >= 3)
    .slice(0, 40);
}

// Decompose a topic/syllabus into DISTINCT subtopics so a large batch can be
// spread across the whole breadth instead of repeating a few obvious facts.
// Best-effort: returns [] on any failure, in which case generation proceeds
// without explicit subtopic assignment (the prompt still asks for variety).
async function outlineSubtopics({ endpoints, model, topic, notes, source, want }) {
  const n = Math.min(40, Math.max(12, want || 12));
  const parts = [
    `Act as a subject specialist building a COMPLETE SYLLABUS MAP for exam-preparation question writing.`,
    `List ${n} DISTINCT, specific subtopics/syllabus points that TOGETHER comprehensively cover the topic below, exactly as covered in NCERT, standard university textbooks and competitive examinations (and current affairs where relevant).`,
    `Topic: ${topic}.`,
  ];
  if (source) parts.push(`Draw the subtopics from this source material:\n${String(source).slice(0, 4000)}`);
  if (notes) parts.push(`Respect these user instructions: ${notes}`);
  parts.push(
    `Span EVERY applicable category so the whole syllabus is represented: definitions & terminology, components, classification, principles, causes, processes & mechanisms, types, characteristics, distribution, factors, effects, importance, advantages/disadvantages, applications, examples, exceptions, comparisons, frequently-confused concepts, numericals/formulas and maps/diagrams (where applicable), plus current affairs, recent research and government policies. Also include, where they apply, the historical, geographical, scientific, economic, environmental, political, technological and current dimensions and the regional, national and international aspects.`
  );
  parts.push(
    `Deliberately include the less-obvious areas, not just the few headline facts. Each item must be a short phrase (3-10 words), specific enough to write several unique questions about, and must NOT overlap in meaning with another item.`
  );
  parts.push(TOPIC_SCOPE_RULE);
  parts.push(`Return ONLY a JSON array of strings, e.g. ["subtopic one","subtopic two"]. No commentary, no markdown.`);
  const userPrompt = parts.join("\n");
  for (const ep of endpoints || []) {
    const r = await callProvider({
      key: ep.key,
      baseUrl: ep.baseUrl,
      model: ep.model || model,
      userPrompt,
      maxTokens: 1200,
      temperature: 0.8,
      systemPrompt: "You output ONLY a JSON array of short strings — no markdown, no commentary.",
    });
    if (!r.ok) continue; // try the next key; on total failure we return []
    const arr = parseStringArray(r.content);
    // De-duplicate case-insensitively and keep them reasonably short.
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      const k = s.toLowerCase().replace(/\s+/g, " ").trim();
      if (k.length < 3 || seen.has(k)) continue;
      seen.add(k);
      out.push(s.replace(/\s+/g, " ").trim());
    }
    if (out.length >= 6) return out;
  }
  return [];
}

function buildUserPrompt({ topic, count, difficulty, types, notes, plan, avoid, source, focus, numerical = false, reshape = false }) {
  const lines = [];
  if (source) {
    lines.push(reshape
      ? `The SOURCE MATERIAL at the end is a set of EXISTING exam questions. RECAST / RESHAPE the FACTS in them into the requested question TYPES — e.g. bundle several related facts into a "consider the following statements" question, turn a single fact into an assertion–reason, or build a matching / pair question from related facts. REUSE the underlying knowledge but produce the NEW format requested: do NOT simply copy an MCQ unchanged, and do NOT alter the underlying facts. Spread across the material so different facts are used.`
      : `Create the questions BASED ON the source material given at the end. Draw the facts and content from that material (you may use closely-related general knowledge to complete a question, but stay on the material's topics).`);
  }
  lines.push(`Topic / syllabus: ${topic}.`);
  lines.push(TOPIC_SCOPE_RULE);

  if (Array.isArray(focus) && focus.length) {
    // Each chunk is assigned DIFFERENT subtopics so the overall batch spans the
    // whole syllabus instead of every parallel worker clustering on the same
    // few obvious facts. The model must stay within these subtopics.
    lines.push(
      `FOCUS SUBTOPICS FOR THIS BATCH — write your questions ONLY on the following specific subtopics of the topic (distribute the questions across them, at least one each where possible). Do NOT drift onto other subtopics, and do NOT default to the single most obvious/headline fact of the topic:\n${focus.map((s) => `- ${s}`).join("\n")}`
    );
  }

  if (Array.isArray(plan) && plan.length) {
    // Explicit per-bucket distribution (type × difficulty). List each bucket so
    // the model produces exactly the requested mix.
    const total = plan.reduce((s, b) => s + b.count, 0);
    lines.push(`Generate EXACTLY ${total} exam-prep questions, distributed precisely as follows:`);
    plan.forEach((b) => {
      lines.push(`- ${b.count} "${b.difficulty}" question(s) of type "${b.type}".`);
    });
    lines.push(`Each question's "type" and "difficulty" fields MUST match the bucket it belongs to.`);
  } else {
    const allowed = (types && types.length ? types : ["mcq"]).join(", ");
    lines.push(`Generate ${count} exam-prep questions.`);
    lines.push(`Allowed question types: ${allowed}. Prefer "mcq" unless another type fits better.`);
    lines.push(
      difficulty && DIFFS.includes(difficulty)
        ? `All questions must be "${difficulty}" difficulty.`
        : `Mix the difficulty across Easy, Medium and Hard.`
    );
  }

  // Numerical/calculation questions are OPT-IN. When the caller ticks the box,
  // EVERY question must be numerical/calculation-based (overriding the type
  // mix). Otherwise keep the whole set purely conceptual/factual.
  lines.push(
    numerical
      ? `NUMERICAL MODE — EVERY question MUST be a NUMERICAL / CALCULATION question that the student answers by computing a value (applying a formula, arithmetic, or solving an equation). Use the type "numericalmcq" for ALL questions: all four "options" are NUMERIC values (each wrapped in $...$) in the same unit and similar magnitude, with exactly ONE equal to your computed result and three plausible wrong values from classic mistakes. Set "numerical": true and leave ALL FOUR "optionExplanations" as empty strings ""; put the FULL step-by-step working (formula → substitution → each step → final value, each on its own line) in "explanation". This OVERRIDES the allowed/listed types above — do NOT produce ANY purely conceptual, factual, theoretical, matching, assertion, statement or definition question; if a listed type is not calculation-based, replace it with a "numericalmcq". Choose sub-topics of the syllabus that genuinely involve calculation.`
      : `Do NOT create NUMERICAL / CALCULATION questions: no problems that require arithmetic, solving equations, applying a formula to compute a value, or any quantitative working-out. Keep EVERY question conceptual/factual/theoretical (definitions, facts, causes/effects, reasoning, matching) — not quantitative. (Genuine dates/years/quantities that are simply RECALLED facts are fine; questions that require the student to CALCULATE are not.)`
  );

  if (notes) {
    lines.push(
      `======================\nMANDATORY USER INSTRUCTIONS (HIGHEST PRIORITY)\nThe following instructions come directly from the user and OVERRIDE any conflicting guidance above. Follow them EXACTLY and COMPLETELY for every single question. If they specify a language, style, focus, sub-topics to include or avoid, difficulty emphasis, format, or anything else, obey them without exception:\n${notes}\n======================`
    );
  }
  lines.push(
    `For every question write a rich, complete "explanation" that includes all relevant facts (dates, years, historical context, definitions, formulas with calculations, named laws/principles) — not a single line. Only when a term/place/person/organisation/law genuinely has a former/old (renamed) name, add that former name in brackets the first time it appears (e.g. "Mumbai (formerly Bombay)"); do NOT translate ordinary terms into Hindi/vernacular or force alternative names — most questions need none. Write the explanation across several short lines — each point on its own line, not one paragraph. Vary which option (A/B/C/D) is correct across the set.`
  );
  lines.push(
    `VARIETY IS CRITICAL: make every question test a DISTINCT fact/sub-topic and a different angle (definition, cause, effect, date/number, example, comparison, application, exception). Do NOT ask about the same fact or the same correct answer twice, and do NOT reword/rephrase another question — a different sentence with the same meaning is a duplicate. Cover the full breadth of the topic, not just the most obvious facts.`
  );
  if (Array.isArray(avoid) && avoid.length) {
    // Use the MOST RECENT stems (they accumulate oldest-first), so repeated
    // "Generate more" batches keep avoiding the questions just generated.
    const list = avoid.slice(-80).map((s, i) => `${i + 1}) ${String(s).slice(0, 120)}`).join("\n");
    lines.push(
      `COVERAGE TRACKER — the concepts below are ALREADY COVERED by existing questions. Do NOT repeat, restate, paraphrase, or ask the SAME FACT/answer as any of them even if worded differently. CONTINUE from the UNCOVERED parts of the syllabus first; only once the topic's breadth is fully covered should you move on to advanced conceptual, analytical, interdisciplinary or current-affairs questions. Do NOT revise a covered concept unless explicitly asked. Already covered:\n${list}`
    );
  }
  if (source) {
    lines.push(`SOURCE MATERIAL (base the questions on this):\n${source}`);
  }
  // Reinforce the user's instructions right before the model answers (recency)
  // so they are followed reliably.
  if (notes) lines.push(`REMINDER — apply the MANDATORY USER INSTRUCTIONS above to EVERY question: ${notes}`);
  lines.push(`Before finalising EACH question, VERIFY it: for a numerical question solve it with the correct formula step by step and mark ONLY the option equal to your computed result (show that working, each step on its own line, in the explanation); for matching/pair/statement questions check each item individually and make the answer reflect the true count/combination. The marked correct option must match your own working — never leave a wrong calculation or a mismatched answer.`);
  lines.push(`Return ONLY the JSON object {"questions":[...]}.`);
  return lines.join("\n");
}

// Pull the assistant's text out of an OpenAI-compatible response. Handles the
// normal string form AND Claude-style "content blocks" (an array of
// { type:"text", text:"..." }) that some proxies pass through unnormalized.
function extractContent(data) {
  const msg = data?.choices?.[0]?.message;
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  // Some reasoning models expose the answer under a different key.
  if (typeof msg?.reasoning_content === "string") return msg.reasoning_content;
  return "";
}

// Last-resort recovery: if the JSON is truncated (e.g. the model ran out of
// tokens mid-array), scan for every complete, brace-balanced {...} object and
// parse them individually. This keeps whatever questions did finish.
function salvageObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const o = JSON.parse(text.slice(start, i + 1));
          if (o && typeof o === "object" && (o.text || o.options)) out.push(o);
        } catch {
          /* skip malformed fragment */
        }
        start = -1;
      }
    }
  }
  return out;
}

// Robustly pull a questions array out of the model's text output.
function parseQuestions(content) {
  let t = String(content || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  let obj;
  try {
    obj = JSON.parse(t);
  } catch {
    // Repair single-backslash LaTeX + raw control chars, then retry a straight
    // parse before falling back to slicing the outermost object/array.
    const repaired = repairJson(t);
    try { obj = JSON.parse(repaired); } catch { /* keep trying below */ }
    if (!obj) {
      const tryParse = (src, s, e) => {
        if (s === -1 || e === -1 || e <= s) return null;
        try { return JSON.parse(src.slice(s, e + 1)); } catch { return null; }
      };
      obj =
        tryParse(t, t.indexOf("{"), t.lastIndexOf("}")) ||
        tryParse(t, t.indexOf("["), t.lastIndexOf("]")) ||
        tryParse(repaired, repaired.indexOf("{"), repaired.lastIndexOf("}")) ||
        tryParse(repaired, repaired.indexOf("["), repaired.lastIndexOf("]"));
    }
  }
  if (!obj) return deepReviveLatex(salvageObjects(repairJson(t))); // last resort: recover from truncated JSON
  obj = deepReviveLatex(obj); // fix \rightarrow/\times/\frac corrupted into control chars
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.questions)) return obj.questions;
  return [];
}

// Coerce a model-supplied graph/diagram into a safe, renderable shape, or
// undefined if there's nothing usable. Accepts lines as { points:[[x,y]…] } or
// [{x,y}…], and annotation points (e.g. an equilibrium) under points/annotations.
function normalizeGraph(g) {
  if (!g || typeof g !== "object" || Array.isArray(g)) return undefined;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const asStr = (x) => (x == null ? "" : String(x));
  const rawLines = Array.isArray(g.lines) ? g.lines : Array.isArray(g.series) ? g.series : [];
  const lines = [];
  for (const l of rawLines) {
    const pts = Array.isArray(l?.points) ? l.points : [];
    const points = pts
      .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : p && typeof p === "object" ? [num(p.x), num(p.y)] : null))
      .filter((p) => p && p[0] != null && p[1] != null);
    if (points.length >= 2) {
      lines.push({
        label: asStr(l?.label).slice(0, 40),
        ...(typeof l?.color === "string" && /^#|^rgb|^[a-z]+$/i.test(l.color) ? { color: l.color } : {}),
        points,
      });
    }
  }
  if (!lines.length) return undefined; // a graph must have at least one real line
  const rawPts = Array.isArray(g.points) ? g.points : Array.isArray(g.annotations) ? g.annotations : [];
  const points = rawPts
    .map((p) => ({ label: asStr(p?.label).slice(0, 24), x: num(p?.x), y: num(p?.y) }))
    .filter((p) => p.x != null && p.y != null);
  return {
    ...(asStr(g.title).trim() ? { title: asStr(g.title).trim().slice(0, 80) } : {}),
    ...(asStr(g.xLabel || g.xlabel || g.xAxis).trim() ? { xLabel: asStr(g.xLabel || g.xlabel || g.xAxis).trim().slice(0, 40) } : {}),
    ...(asStr(g.yLabel || g.ylabel || g.yAxis).trim() ? { yLabel: asStr(g.yLabel || g.ylabel || g.yAxis).trim().slice(0, 40) } : {}),
    ...(num(g.xMax) != null ? { xMax: num(g.xMax) } : {}),
    ...(num(g.yMax) != null ? { yMax: num(g.yMax) } : {}),
    lines: lines.slice(0, 5),
    points: points.slice(0, 8),
  };
}

// Coerce a model-supplied Visualization-Studio spec (for a "diagram" question)
// into a safe, renderable object, or undefined if there's nothing usable. The
// spec shape varies per engine (Chart.js / Mermaid / Plotly / graph), so we
// keep it permissive: it must be a plain object with a non-empty string "type",
// and carry at least one recognised payload (series/labels, Mermaid code, a
// plotly block, or a graph/network). We JSON round-trip and size-cap it to drop
// functions/oversized blobs before it's stored as Mixed.
function normalizeViz(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const type = String(v.type || "").trim();
  if (!type) return undefined;
  const hasPayload =
    (Array.isArray(v.series) && v.series.length) ||
    (Array.isArray(v.labels) && v.labels.length) ||
    (typeof v.code === "string" && v.code.trim()) ||
    (v.plotly && typeof v.plotly === "object") ||
    (v.graph && typeof v.graph === "object") ||
    (v.network && typeof v.network === "object") ||
    (v.framework && typeof v.framework === "object") ||
    (v.map && typeof v.map === "object") ||
    (v.science && typeof v.science === "object") ||
    (v.illustration && typeof v.illustration === "object") ||
    (v.chem && typeof v.chem === "object");
  if (!hasPayload) return undefined;
  let clean;
  try {
    clean = JSON.parse(JSON.stringify(v)); // strip functions / non-serialisable bits
  } catch {
    return undefined;
  }
  clean.type = type.slice(0, 40);
  if (clean.title != null) clean.title = String(clean.title).slice(0, 120);
  // Guard against an oversized spec bloating the document.
  try {
    if (JSON.stringify(clean).length > 20000) return undefined;
  } catch {
    return undefined;
  }
  return clean;
}

// The "$...$" delimiters render inline math, so they are for numbers, values,
// units, symbols and formulas ONLY. Models often wrap ordinary words or proper
// nouns too (e.g. "$Natya$", "$AbhinayaDarpana$", "$abhinaya$"), which then show
// in italic math font mid-sentence. Unwrap any $...$ whose contents are a PLAIN
// word/phrase — two-or-more letters, letters and spaces only, with no digit,
// backslash or math symbol — so genuine math ("$H_2O$", "$\\frac{d}{t}$", a
// single-letter variable "$x$", "$25\\%$") is left untouched.
function unwrapWordMath(s) {
  return String(s == null ? "" : s).replace(/\$([^$]+)\$/g, (m, inner) => {
    const t = inner.trim();
    return /^[A-Za-z][A-Za-z ]*[A-Za-z]$/.test(t) ? t : m;
  });
}

// Assertion–Reason questions MUST carry both the Assertion (A) and the Reason
// (R) as their own statements. Models sometimes leave "reason" (or both) blank
// and either pack "Assertion: … Reason: …" into a single field or dump them into
// the stem, putting the real content only in "explanation". Such a question
// renders as a broken A/R and later fails CSV re-import ("assertion needs an
// Assertion, a Reason and 4 options"). Recover A and R from a packed field or
// the stem so a complete pair is stored; whatever is still missing is dropped by
// normalize() rather than saved broken.
// The four fixed options every Assertion–Reason question must use, in order.
// Used to CONVERT any assertion question to the dedicated format on Regenerate.
const ASSERTION_OPTIONS = [
  "Both A and R are true and R is the correct explanation of A",
  "Both A and R are true but R is NOT the correct explanation of A",
  "A is true but R is false",
  "A is false but R is true",
];

function recoverAssertionReason(assertion, reason, text) {
  let a = String(assertion == null ? "" : assertion).trim();
  let r = String(reason == null ? "" : reason).trim();
  const splitOnReason = (s) => {
    const str = String(s || "");
    const m = str.match(/\bReason\b\s*(?:\([Rr]\))?\s*[:\-]/);
    if (m && m.index > 0) return [str.slice(0, m.index).trim(), str.slice(m.index + m[0].length).trim()];
    return null;
  };
  // Both packed into the assertion field ("Assertion (A): … Reason (R): …").
  if (a && !r) { const p = splitOnReason(a); if (p) { a = p[0]; r = p[1]; } }
  // Both dumped into the stem instead of the dedicated keys.
  if ((!a || !r) && /\bReason\b\s*(?:\([Rr]\))?\s*[:\-]/.test(text || "")) {
    const p = splitOnReason(text);
    if (p) { if (!a) a = p[0]; if (!r) r = p[1]; }
  }
  // Strip any leading "Assertion (A):" / "Reason (R):" label.
  a = a.replace(/^\s*Assertion\b\s*(?:\([Aa]\))?\s*[:\-]\s*/, "").trim();
  r = r.replace(/^\s*Reason\b\s*(?:\([Rr]\))?\s*[:\-]\s*/, "").trim();
  return { assertion: a, reason: r };
}

// Remove any Assertion (A) / Reason (R) statements the model embedded in an
// assertion question's STEM — they belong only in the dedicated assertion/reason
// fields (and their own boxes), so a copy in the stem renders the A/R twice.
// Keeps just the intro line before the first "Assertion" label.
function stripAssertionFromStem(text) {
  const s = String(text || "");
  const idx = s.search(/\bAssertion\b\s*(?:\([Aa]\))?\s*[:\-]/);
  return idx === -1 ? s.trim() : s.slice(0, idx).trim();
}

// Coerce anything the model returned into a valid Question document shape.
function normalize(list) {
  const clampIdx = (n) => Math.min(3, Math.max(0, parseInt(n, 10) || 0));
  const asStr = (x) => (x == null ? "" : String(x));
  const arrStr = (a) => (Array.isArray(a) ? a.map(asStr) : []);

  return (Array.isArray(list) ? list : [])
    .map((q) => {
      const type = TYPES.includes(q?.type) ? q.type : "mcq";

      let options = arrStr(q?.options);
      while (options.length < 4) options.push("");
      options = options.slice(0, 4);

      const correct = clampIdx(q?.correct);

      let oe = arrStr(q?.optionExplanations);
      while (oe.length < 4) oe.push("");
      oe = oe.slice(0, 4);
      oe[correct] = ""; // correct option needs no "why it's wrong" note

      const out = {
        type,
        text: asStr(q?.text).trim(),
        options,
        correct,
        difficulty: DIFFS.includes(q?.difficulty) ? q.difficulty : "Medium",
        explanation: asStr(q?.explanation).trim(),
        optionExplanations: oe,
        status: "published",
        // Source question number (from a numbered paper), used only to de-duplicate
        // during extraction so the count matches the source exactly. Not persisted.
        n: Number.isFinite(Number(q?.n)) ? Number(q.n) : null,
      };

      if (type === "matching" || type === "pair" || type === "pairselect") {
        // Recover the two columns from columnA/columnB OR any alternate shape
        // the model used (pairs/matches arrays, {left,right} objects, "A — B"
        // strings) so the pair list never renders empty. Then strip any leading
        // "1.", "2)", "I.", "(iii)" markers — the app auto-numbers the columns.
        const { columnA, columnB } = derivePairColumns(q);
        out.columnA = columnA.map(stripListMarker);
        out.columnB = columnB.map(stripListMarker);
      }
      if (type === "statement") {
        // Statements live in columnA. Models sometimes send them under a
        // different key ("statements"/"statementList"/"points") or, worse, dump
        // them into the stem text — recover all of those so the list never
        // renders empty.
        let stmts = arrStr(q?.columnA);
        if (!stmts.length && Array.isArray(q?.statements)) stmts = arrStr(q.statements);
        if (!stmts.length && Array.isArray(q?.statementList)) stmts = arrStr(q.statementList);
        if (!stmts.length && Array.isArray(q?.points)) stmts = arrStr(q.points);
        if (stmts.filter((s) => s.trim()).length < 2) {
          const ex = extractNumbered(q?.text);
          if (ex) { stmts = ex.statements; if (ex.intro) out.text = ex.intro; }
        }
        out.columnA = stmts.map(stripListMarker).filter((s) => s.trim() !== "");
        out.columnB = [];
        if (!out.text) out.text = "Consider the following statements:";
      }
      if (type === "rearrange") {
        // The four jumbled sentences live in columnA (each shown in its own
        // numbered box). Recover from alternate keys or a numbered stem so the
        // list never renders empty.
        let sents = arrStr(q?.columnA);
        if (!sents.length && Array.isArray(q?.sentences)) sents = arrStr(q.sentences);
        if (sents.filter((s) => s.trim()).length < 2) {
          const ex = extractNumbered(q?.text) || extractRomanNumbered(q?.text);
          if (ex) { sents = ex.statements; if (ex.intro) out.text = ex.intro; }
        }
        out.columnA = sents.map(stripListMarker).filter((s) => s.trim() !== "");
        out.columnB = [];
        if (!out.text) out.text = "Rearrange the following sentences to form a meaningful paragraph:";
      }
      if (type === "assertion") {
        const ar = recoverAssertionReason(q?.assertion, q?.reason, q?.text);
        out.assertion = ar.assertion;
        out.reason = ar.reason;
        // The A/R now live in their own fields — remove any copy left in the
        // stem so they don't render twice (keep only the intro line).
        if (out.assertion && out.reason) out.text = stripAssertionFromStem(out.text);
        if (!out.text) out.text = "Consider the following Assertion (A) and Reason (R):";
      }
      if (type === "table") {
        out.tableRows = Array.isArray(q?.tableRows)
          ? q.tableRows.map((row) => arrStr(row))
          : [];
      }
      // Optional diagram/graph (any type may carry one, e.g. an economics
      // supply-demand curve). Kept only when it has at least one valid line.
      const graph = normalizeGraph(q?.graph);
      if (graph) out.graph = graph;

      // Optional Visualization-Studio diagram spec for "diagram" questions
      // (charts / flowcharts / graphs). Kept only when it's a valid spec.
      const viz = normalizeViz(q?.viz);
      if (viz) out.viz = viz;

      // Strip stray $...$ the model put around plain words (math is for numbers/
      // formulas only), across every user-visible text field.
      out.text = unwrapWordMath(out.text);
      out.options = out.options.map(unwrapWordMath);
      out.explanation = unwrapWordMath(out.explanation);
      out.optionExplanations = out.optionExplanations.map(unwrapWordMath);
      if (out.assertion != null) out.assertion = unwrapWordMath(out.assertion);
      if (out.reason != null) out.reason = unwrapWordMath(out.reason);
      if (Array.isArray(out.columnA)) out.columnA = out.columnA.map(unwrapWordMath);
      if (Array.isArray(out.columnB)) out.columnB = out.columnB.map(unwrapWordMath);
      if (Array.isArray(out.tableRows)) out.tableRows = out.tableRows.map((r) => (Array.isArray(r) ? r.map(unwrapWordMath) : r));
      // Calculation-based questions don't need per-option "why wrong" notes —
      // the step-by-step working in the explanation covers it. Drop them when
      // the model flags the question as numerical (calculation-based).
      if (q?.numerical === true || q?.numerical === "true" || type === "numericalmcq") out.optionExplanations = ["", "", "", ""];
      return out;
    })
    // Drop empty questions, and drop assertion questions still missing their
    // Assertion or Reason (they render broken and fail CSV re-import) rather
    // than saving them incomplete.
    .filter((q) => q.text && (q.type !== "assertion" || (q.assertion && q.reason)));
}

// Spread the correct answer evenly + randomly across A/B/C/D so it isn't always
// option A. Models strongly bias the answer to the first option; this fixes it
// deterministically after the fact. Only free-form option types are shuffled —
// structured types (assertion, matching, statement, pair, pairselect) keep their
// fixed option order, since there the option TEXT carries the meaning.
const SHUFFLE_TYPES = new Set(["mcq", "numericalmcq", "table", "journal"]);
function balanceCorrectOptions(list) {
  const targetIdx = [];
  for (let i = 0; i < list.length; i++) if (SHUFFLE_TYPES.has(list[i].type)) targetIdx.push(i);

  // Build a balanced sequence of destination positions (0,1,2,3,0,1,2,3,…) and
  // Fisher–Yates shuffle it → even distribution AND random order.
  const dests = targetIdx.map((_, n) => n % 4);
  for (let i = dests.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dests[i], dests[j]] = [dests[j], dests[i]];
  }

  targetIdx.forEach((qi, n) => {
    const q = list[qi];
    const from = q.correct;
    const to = dests[n];
    if (from === to || !Array.isArray(q.options) || q.options.length < 4) return;
    // Move the correct option (and its matching explanation) to the target slot.
    const opts = q.options.slice();
    const oe = Array.isArray(q.optionExplanations) ? q.optionExplanations.slice() : ["", "", "", ""];
    [opts[from], opts[to]] = [opts[to], opts[from]];
    [oe[from], oe[to]] = [oe[to], oe[from]];
    q.options = opts;
    q.optionExplanations = oe;
    q.correct = to;
  });
  return list;
}

// Reorder the finished batch so the SAME question type never sits back-to-back
// when avoidable (no run of consecutive MCQs, then all matching, etc.). Each
// type's questions are shuffled and the types are interleaved, so the order is
// fresh and varied on EVERY run. (Adjacency is only unavoidable when a single
// type makes up more than half the batch.)
function reorderNoConsecutiveTypes(list) {
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const groups = new Map();
  for (const q of list) {
    const t = q.type || "mcq";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(q);
  }
  for (const arr of groups.values()) shuffle(arr); // fresh random order within each type

  const out = [];
  let lastType = null;
  while (out.length < list.length) {
    const buckets = [...groups.entries()].filter(([, arr]) => arr.length > 0);
    let eligible = buckets.filter(([t]) => t !== lastType);
    if (!eligible.length) eligible = buckets; // only the same type remains — unavoidable
    // Prefer the type with the most left (keeps spacing feasible); break ties
    // randomly so the sequence differs every time.
    const maxLeft = Math.max(...eligible.map(([, arr]) => arr.length));
    const top = eligible.filter(([, arr]) => arr.length === maxLeft);
    const [type, arr] = top[Math.floor(Math.random() * top.length)];
    out.push(arr.pop());
    lastType = type;
  }
  return out;
}

const MAX_TOTAL = 500; // absolute hard ceiling / fallback (admin can set a lower/higher per-batch cap in Settings)
const CHUNK_SIZE = 12; // questions generated per provider call — smaller so the richer, detailed explanations don't truncate the JSON reply

// ---- Per-account AI generation limits (admin global cap + client plans) ----
// Rolling-window usage kept IN MEMORY (single Render instance): userId → recent
// { at, count } events, pruned on read. A restart resets windows — acceptable
// for a soft business quota.
const aiUsageByUser = new Map();
function aiRecentUsage(key, windowMs) {
  const now = Date.now();
  const arr = (aiUsageByUser.get(key) || []).filter((e) => now - e.at < windowMs);
  aiUsageByUser.set(key, arr);
  return arr.reduce((s, e) => s + (e.count || 0), 0);
}
function aiRecordUsage(key, count) {
  const arr = aiUsageByUser.get(key) || [];
  arr.push({ at: Date.now(), count });
  aiUsageByUser.set(key, arr);
}

// Effective limits for a requester. Admins use the global per-batch cap with no
// rate limit. A client's limits come from the subscription plan they PURCHASED
// (user.subscriptionPlan) — capped by the global ceiling — falling back to the
// cheapest paid plan, then the first plan.
async function effectiveAiLimits(user) {
  let s = null;
  try { s = await Settings.findOne({ key: "site" }).select("aiMaxPerBatch clientPlans").lean(); } catch { /* ignore */ }
  const globalMax = Math.max(1, s?.aiMaxPerBatch || MAX_TOTAL);
  if (!user || user.role !== "client") {
    return { maxPerBatch: globalMax, perWindow: Infinity, windowMinutes: 5, planName: "Admin" };
  }
  const plans = Array.isArray(s?.clientPlans) && s.clientPlans.length ? s.clientPlans : DEFAULT_CLIENT_PLANS;
  const plan = plans.find((p) => p.key === user.subscriptionPlan) || plans.find((p) => !p.trial) || plans[0] || null;
  const maxPerBatch = Math.min(globalMax, Math.max(1, plan?.maxPerBatch || globalMax));
  const perWindow = Math.max(1, plan?.perWindow || globalMax);
  const windowMinutes = Math.max(1, plan?.windowMinutes || 5);
  return { maxPerBatch, perWindow, windowMinutes, planName: plan?.label || plan?.key || "" };
}

// Pull a suggested retry wait (ms) out of a 429 response — either the
// Retry-After header or Gemini's RetryInfo "retryDelay":"27s" body field.
function retryWaitMs(headers, body) {
  const ra = parseInt(headers?.get?.("retry-after") || "", 10);
  if (ra > 0) return Math.min(ra * 1000, 20000);
  const m = /"retryDelay"\s*:\s*"?(\d+)s/i.exec(body || "");
  if (m) return Math.min(parseInt(m[1], 10) * 1000, 20000);
  return 0;
}

// Turn a provider 429 body into ACTIONABLE guidance. Free tiers enforce two
// separate limits: a per-MINUTE rate (clears in seconds) and a per-DAY quota
// (only resets the next day). Crucially, several keys from the SAME Google/
// provider account or project usually SHARE one quota — so adding more keys
// from the same account adds NO capacity. This is the most common reason
// "I added another key but it still says quota" happens.
function quota429Message(detail = "") {
  const d = String(detail || "");
  const perDay = /per[\s_-]*day|dailylimit|daily limit|GenerateRequests?PerDay|quota.*(exceeded|exhausted).*(day|daily)|FreeTier|free[\s_-]*tier.*(day|daily)/i.test(d);
  const shared =
    " Note: multiple keys from the SAME Google/provider account share ONE quota, so adding more keys from that account won't help — add a key from a DIFFERENT account/project (or enable billing).";
  if (perDay) {
    return (
      "Every API key is out of its DAILY free quota (429). This resets tomorrow — waiting a few minutes won't help." +
      shared +
      " You can also import questions from a web page instead, which uses far fewer requests."
    );
  }
  return (
    "All API keys hit their per-minute rate limit (429). This usually clears within a minute — wait a moment, use a smaller batch, then try again." +
    shared
  );
}

// One provider call with transient-error retries. Returns { ok, status, content, detail }.
async function callProvider({ key, baseUrl, model, userPrompt, maxTokens, systemPrompt = SYSTEM_PROMPT, temperature = 0.6, timeoutMs = 90000, failOnEmpty = false }) {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  // Gemini burns budget on hidden "thinking" which truncates JSON — turn it off
  // (sent only for Gemini; OpenAI/Claude reject this field).
  if (/gemini/i.test(model)) payload.reasoning_effort = "none";

  // 429 is NOT retried here — it returns immediately so the caller can switch to
  // the next configured key. Only "busy" server errors are retried on this key.
  const TRANSIENT = [500, 502, 503, 504];
  const WAITS = [1500, 3000, 6000, 9000];
  const TIMEOUT_MS = timeoutMs; // hard cap per call so a hung provider can't stall the whole job (short for key probes)
  for (let attempt = 0; ; attempt++) {
    let resp;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      resp = await fetch(`${(baseUrl || "https://api.tokenlab.sh/v1").replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Network error or a timeout (abort). Retry a few times on this key, then
      // give up so the worker moves on to another chunk/key instead of hanging.
      if (attempt < WAITS.length) { await new Promise((r) => setTimeout(r, WAITS[attempt])); continue; }
      return { ok: false, status: 0, detail: err?.name === "AbortError" ? "Request timed out." : (err?.message || "Network error.") };
    }
    clearTimeout(timer);
    if (resp.ok) {
      // Read the body as TEXT first, then parse — so a non-JSON 200 (e.g. a
      // firewall/WAF or gateway HTML page like "<!doctype html>…", which some
      // proxies return) becomes a clean provider error instead of throwing an
      // unhandled "Unexpected token '<'" that would break the whole job.
      const raw = await resp.text().catch(() => "");
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return {
          ok: false,
          status: 502,
          detail: `Provider returned a non-JSON response (looks like an HTML/error page). This usually means the Base URL is wrong or the key's gateway is blocking the request. ${raw.slice(0, 120)}`,
        };
      }
      const content = extractContent(data);
      // A 200 with NO usable text — Gemini does this on a safety block or when a
      // "thinking" model spends its whole budget reasoning and emits no answer.
      // For JSON tasks (failOnEmpty) report it as a soft, retriable error (520)
      // so callWithFallback rolls over to the next key/model instead of treating
      // an empty reply as success. Key-test / model-detect keep the old behavior.
      if (failOnEmpty && !String(content || "").trim()) {
        return { ok: false, status: 520, empty: true, detail: "The model returned an empty response (possible safety filter, or a thinking-only/weak model)." };
      }
      return { ok: true, content, tokens: data?.usage?.total_tokens || 0 };
    }
    const detail = await resp.text().catch(() => "");
    // Some Gemini model versions reject the `reasoning_effort` field with a 400.
    // Retry once WITHOUT it so a valid key isn't wrongly marked as "not working".
    if (resp.status === 400 && payload.reasoning_effort) {
      delete payload.reasoning_effort;
      continue;
    }
    const canRetry = TRANSIENT.includes(resp.status) && attempt < WAITS.length;
    if (!canRetry) return { ok: false, status: resp.status, detail };
    // For 429 (quota/rate) honour the server's suggested delay; else backoff.
    const wait = resp.status === 429 ? retryWaitMs(resp.headers, detail) || WAITS[attempt] : WAITS[attempt];
    await new Promise((r) => setTimeout(r, wait));
  }
}

// Take the NEXT single bucket (one type + difficulty) off the front of a bucket
// plan, up to `size` questions. Keeping each chunk to ONE bucket lets the worker
// reliably stamp the requested difficulty and reject off-type replies, so the
// grid's exact type × difficulty distribution is honoured (models otherwise
// mislabel difficulty/type and quietly skew the mix).
function takeChunk(planArr, size) {
  const b = planArr[0];
  if (!b) return [];
  const take = Math.min(b.count, size);
  return take > 0 ? [{ type: b.type, difficulty: b.difficulty, count: take }] : [];
}

// Given the target plan and what we've collected so far, return the buckets
// still short (so the next chunk targets the gaps). Honours the distribution.
function remainingPlan(planArr, collected) {
  const have = {};
  for (const q of collected) {
    const k = `${q.type}|${q.difficulty}`;
    have[k] = (have[k] || 0) + 1;
  }
  return planArr
    .map((b) => {
      const k = `${b.type}|${b.difficulty}`;
      const used = Math.min(have[k] || 0, b.count);
      have[k] = (have[k] || 0) - used;
      return { ...b, count: b.count - used };
    })
    .filter((b) => b.count > 0);
}

/* ------------------------- Background generation jobs -------------------------
   Big batches (up to 100 questions) are produced across many small provider
   calls. Doing that inside one HTTP request risks proxy timeouts, so instead we
   run the work in the background and let the client poll for progress.
   NOTE: jobs are kept in memory — fine for a single backend instance. They are
   automatically cleaned up after 20 minutes via a periodic interval. */
const genJobs = new Map(); // id -> { status, questions, requested, error, model, updatedAt }

function newJobId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Guard a fire-and-forget background job: the job funcs have their own try/catch,
// but if their promise ever rejects OUTSIDE that (an unexpected error), mark the
// job errored so the client stops polling — and log it — instead of leaving a
// stuck "pending" job and (pre-safety-net) crashing the process.
function guardJob(id, p) {
  Promise.resolve(p).catch((e) => {
    const j = genJobs.get(id);
    if (j) { j.status = "error"; j.error = e?.message || "The job failed unexpectedly."; j.updatedAt = Date.now(); }
    console.error("[aiJob] background job failed:", e?.stack || e);
  });
}
function cleanupJobs() {
  const cutoff = Date.now() - 20 * 60 * 1000; // 20 min
  for (const [id, j] of genJobs) if (j.updatedAt < cutoff) genJobs.delete(id);
}

// Periodically clean up expired jobs every 5 minutes to prevent unbounded
// memory growth (previously cleanup only ran when a new job was started).
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(cleanupJobs, CLEANUP_INTERVAL_MS).unref();

// Buckets still short — accounting for BOTH what's collected AND what parallel
// workers currently have reserved (in-flight), so two keys never target the
// same gap at the same time.
function planGaps(planArr, collected, reserved) {
  const have = {};
  for (const q of collected) { const k = `${q.type}|${q.difficulty}`; have[k] = (have[k] || 0) + 1; }
  for (const k in reserved) have[k] = (have[k] || 0) + (reserved[k] || 0);
  return planArr
    .map((b) => {
      const k = `${b.type}|${b.difficulty}`;
      const used = Math.min(have[k] || 0, b.count);
      have[k] = (have[k] || 0) - used;
      return { ...b, count: b.count - used };
    })
    .filter((b) => b.count > 0);
}

async function runGenerationJob(id, ctx) {
  const { workers, fallbackWorkers = [], model, topic, notes, plan, count, difficulty, types, target, avoid, owner = null, source = "", userSubtopics = [], numerical = false, reshape = false } = ctx;
  const job = genJobs.get(id);
  const deadline = Date.now() + 8 * 60 * 1000; // overall time budget
  if (!job.keyStats) job.keyStats = {}; // live per-key activity for THIS run

  // Spread the work across ALL keys at once. With many keys and a modest target
  // (e.g. 40 questions across 20 keys) each key produces a SMALL batch (~2) so
  // every key runs simultaneously, instead of a few keys doing big 12-question
  // chunks while the rest sit idle. Smaller batches also finish faster and mean
  // one slow/failing key can't stall the whole run.
  const workerCount = Math.max(1, (workers?.length || 0) + (fallbackWorkers?.length || 0));
  const chunkSize = Math.max(1, Math.min(CHUNK_SIZE, Math.ceil(target / workerCount)));

  // Signature of a question (normalised stem) used to guarantee NO duplicates —
  // neither within this batch nor against questions from an earlier batch
  // (the caller passes their stems in `avoid`). This is the reliable no-repeat
  // guarantee; the prompt instruction just reduces wasted regeneration.
  // The content a duplicate check should key off. For ASSERTION questions the
  // meaning is in `assertion`/`reason` — their `text` is usually blank or the
  // generic "Consider the following Assertion (A) and Reason (R):" stem, so
  // keying on `text` alone made EVERY assertion question share one signature and
  // all but the first were dropped as "duplicates" (the reason a 50-A/R request
  // only ever yielded 1). Column-based types likewise carry their content in
  // columnA/columnB. Fall back to plain text for mcq/table and avoid-list strings.
  const dedupText = (q) => {
    if (typeof q === "string") return q;
    if (!q) return "";
    const parts = [q.text];
    if (q.type === "assertion") parts.push(q.assertion, q.reason);
    if (Array.isArray(q.columnA)) parts.push(...q.columnA);
    if (Array.isArray(q.columnB)) parts.push(...q.columnB);
    if (Array.isArray(q.tableRows)) parts.push(...q.tableRows.flat(Infinity));
    return parts.filter(Boolean).join(" ");
  };
  const qSig = (q) => dedupText(q).toLowerCase().replace(/\s+/g, " ").trim();
  const seen = new Set((avoid || []).map(qSig).filter(Boolean));
  // Content signatures for semantic-ish de-duplication: catch the SAME fact
  // reworded (not just identical text). Seeded with the already-existing
  // questions so re-runs don't repeat them either.
  const sigList = [];
  for (const s of avoid || []) {
    const tk = contentTokens(s);
    if (tk.size) sigList.push({ tk, ans: "" });
  }
  // Is this question a reworded duplicate of one we already have?
  const isSemanticDup = (q) => {
    const tk = contentTokens(dedupText(q));
    if (!tk.size) return false;
    const ans = ANSWER_DEDUP_TYPES.has(q?.type) ? correctAnswerNorm(q) : "";
    for (const e of sigList) {
      const j = jaccard(tk, e.tk);
      if (j >= 0.85) return true; // near-identical wording
      if (j >= 0.5 && ans && ans === e.ans) return true; // same fact + same answer, reworded
    }
    sigList.push({ tk, ans });
    return false;
  };
  const MAX_QUOTA_WAITS = 6; // per key: how many per-minute 429s we ride out before retiring it
  const MAX_EMPTY = 4; // per key: empty (safety/thinking-only) replies we retry before retiring the key
  const MAX_ATTEMPTS = Math.ceil(target / chunkSize) + 12 + workerCount * (MAX_QUOTA_WAITS + MAX_EMPTY); // global safety cap
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const collected = [];
  const reserved = {};   // bucket -> reserved count (plan mode)
  let reservedCount = 0; // reserved total (count mode)
  let attempts = 0;
  let lastError = null;

  const save = (patch) => Object.assign(job, patch, { updatedAt: Date.now() });

  // Break the topic into DISTINCT subtopics up front so a big batch spans the
  // whole syllabus instead of clustering on a few obvious facts. Best-effort and
  // time-boxed — if it fails we simply generate without explicit assignment.
  let subtopics = [];
  let subCursor = 0;
  if (Array.isArray(userSubtopics) && userSubtopics.length) {
    // The user listed exactly what to cover — respect it and skip the extra
    // API call. Questions get spread across these subtopics.
    subtopics = userSubtopics;
  } else if (topic && target >= 6 && Date.now() < deadline) {
    try {
      subtopics = await outlineSubtopics({
        endpoints: workers && workers.length ? workers : fallbackWorkers,
        model,
        topic,
        notes,
        source,
        want: target,
      });
    } catch { subtopics = []; }
  }
  // Assign the next few subtopics (rotating) to each chunk so different chunks
  // cover different ground; wraps once every subtopic has been used at least once.
  const nextFocus = (nQ) => {
    if (!subtopics.length) return undefined;
    // Roughly one subtopic per question in the chunk → maximum spread. Wraps
    // around when the chunk needs more than the remaining unused subtopics.
    const span = Math.max(1, Math.min(nQ, subtopics.length));
    const picks = [];
    for (let i = 0; i < span; i++) { picks.push(subtopics[subCursor % subtopics.length]); subCursor += 1; }
    return picks;
  };
  // The caller's existing questions PLUS everything produced so far in THIS run
  // (recomputed per chunk), so parallel workers and later chunks stop repeating
  // what has already been generated. This is the main in-run duplicate killer.
  const avoidNow = () => [...(avoid || []), ...collected.map((q) => q.text).filter(Boolean)];

  // Reserve the next chunk of work so parallel key-workers don't duplicate it.
  const reserveChunk = () => {
    if (plan) {
      const rem = planGaps(plan, collected, reserved);
      if (!rem.length) return null;
      const chunk = takeChunk(rem, chunkSize);
      for (const b of chunk) reserved[`${b.type}|${b.difficulty}`] = (reserved[`${b.type}|${b.difficulty}`] || 0) + b.count;
      const n = chunk.reduce((s, b) => s + b.count, 0);
      return { chunk, n, focus: nextFocus(n) };
    }
    const remaining = target - collected.length - reservedCount;
    if (remaining <= 0) return null;
    const n = Math.min(chunkSize, remaining);
    reservedCount += n;
    return { n, focus: nextFocus(n) };
  };
  const release = (res) => {
    if (plan) for (const b of res.chunk) { const k = `${b.type}|${b.difficulty}`; reserved[k] = Math.max(0, (reserved[k] || 0) - b.count); }
    else reservedCount = Math.max(0, reservedCount - res.n);
  };

  // ONE worker PER API KEY → every key generates SIMULTANEOUSLY. Each worker
  // sticks to its own key; when that key hits its per-minute limit (429) it
  // waits it out while the OTHER keys keep producing. This both speeds up big
  // batches and spreads the rate-limit load across all keys at once.
  const worker = async (ep) => {
    let quotaWaits = 0;
    let emptyReplies = 0;
    while (collected.length < target && attempts < MAX_ATTEMPTS && Date.now() < deadline && !job.cancelled) {
      const res = reserveChunk();
      if (!res) break; // nothing left to generate
      const prompt = plan
        ? buildUserPrompt({ topic, notes, plan: res.chunk, avoid: avoidNow(), source, focus: res.focus, numerical, reshape })
        : buildUserPrompt({ topic, notes, count: res.n, difficulty, types, avoid: avoidNow(), source, focus: res.focus, numerical, reshape });
      const maxTokens = Math.min(16000, 1800 + res.n * 1000);
      attempts += 1;
      // Live per-key activity for this run (surfaced via jobStatus.keyStats).
      const _kl = ep.label || "Key";
      const _ks = job.keyStats[_kl] || (job.keyStats[_kl] = { requests: 0, ok: 0, limited: 0, error: 0, questions: 0 });
      _ks.requests += 1; save({}); // reflect the in-flight request immediately
      // Higher temperature for generation → more varied questions (extraction
      // stays at the low default so it copies the source faithfully).
      const r = await callProvider({ key: ep.key, baseUrl: ep.baseUrl, model: ep.model || model, userPrompt: prompt, maxTokens, temperature: 0.85, failOnEmpty: true });
      release(res); // free the reservation — any shortfall gets re-targeted next round
      if (r.ok) {
        _ks.ok += 1;
        AiKey.updateOne({ key: ep.key, owner: ep.owner ?? owner ?? null }, { $inc: { usedRequests: 1, usedTokens: r.tokens || 0 } }).catch(() => {});
        const beforeLen = collected.length;
        // In plan mode each chunk is ONE bucket (type + difficulty). Accept only
        // questions of the requested TYPE (reject the model's off-type replies so
        // they don't wrongly fill the bucket), STAMP the requested difficulty
        // (models mislabel it constantly), and stop at the bucket's count — so
        // the grid's per-type/per-difficulty distribution is actually enforced,
        // not just the grand total.
        const bkt = plan ? res.chunk[0] : null;
        let takenThisChunk = 0;
        for (const q of normalize(parseQuestions(r.content))) {
          if (collected.length >= target) break;
          if (bkt) {
            if (takenThisChunk >= res.n) break; // bucket already satisfied by this reply
            if (q.type !== bkt.type) continue; // wrong type — don't count it toward this bucket
          }
          const sig = qSig(q);
          if (!sig || seen.has(sig)) continue; // skip blanks + exact duplicates
          if (isSemanticDup(q)) continue; // skip the SAME fact reworded (semantic duplicate)
          if (bkt) q.difficulty = bkt.difficulty; // enforce the requested difficulty
          seen.add(sig);
          collected.push(q);
          takenThisChunk += 1;
        }
        _ks.questions += collected.length - beforeLen;
        save({ questions: collected.slice() });
        continue;
      }
      _ks[(r.status === 429 || /quota|rate.?limit|exhausted|resource has been exhausted/i.test(r.detail || "")) ? "limited" : "error"] += 1;
      save({});
      lastError = r;
      if (r.status === 520 && r.empty) {
        // A 200 with no usable text — a Gemini safety block, or a "thinking-only"/
        // weak model (especially the default lite model) that spends its whole
        // budget reasoning and emits nothing. Previously these came back as ok:true
        // with 0 questions and silently burned the attempt budget, so a batch would
        // stop after the few non-empty replies. Retry a bounded number of times on
        // this key; if it KEEPS returning empty, retire the key so the other keys /
        // the fallback pool take over instead of stalling the whole batch.
        if (emptyReplies >= MAX_EMPTY) break;
        emptyReplies += 1;
        continue;
      }
      if ([401, 403].includes(r.status)) break; // key dead/unauthorized — retire
      if (r.status === 404) {
        // The model isn't valid for this key. Auto-find a valid one (once),
        // switch to it, remember it on the key, and retry — so a wrong model id
        // (common with OpenRouter) self-heals instead of failing the whole run.
        if (!ep._repaired) {
          ep._repaired = true;
          const picked = pickPreferredModel(await fetchModels(ep.key, ep.baseUrl));
          if (picked && picked !== ep.model) {
            ep.model = picked;
            AiKey.updateOne({ key: ep.key }, { models: picked }).catch(() => {});
            continue; // retry this chunk with the valid model
          }
        }
        break; // couldn't find a valid model for this key — retire it
      }
      if (r.status === 429) {
        // This key hit its per-minute limit. Wait it out; the other key-workers
        // keep generating in parallel meanwhile.
        if (quotaWaits >= MAX_QUOTA_WAITS) break;
        const waitMs = Math.min(retryWaitMs(null, r.detail) || 30000, 60000);
        if (Date.now() + waitMs >= deadline) break;
        quotaWaits += 1;
        await sleep(waitMs);
      }
      // transient/other errors: loop and try another chunk on this key
    }
  };

  try {
    // Launch every configured key at once — each on a model it supports.
    await Promise.all((workers || []).map((ep) => worker(ep)));

    // Automatic pool fallback: if the client's selected key pool produced nothing
    // or ran out of quota (429), retry the remaining gap on the OTHER pool the
    // admin allows (e.g. fall back to the built-in keys when the client's own
    // keys are spent). Only kicks in when there's still time left in the budget.
    if (
      (fallbackWorkers?.length || 0) > 0 &&
      collected.length < target &&
      Date.now() < deadline &&
      !job.cancelled &&
      (collected.length === 0 || lastError?.status === 429 || lastError?.status === 520)
    ) {
      lastError = null; // give the fallback pool a clean slate for error reporting
      attempts = 0; // and its own attempt budget
      await Promise.all(fallbackWorkers.map((ep) => worker(ep)));
    }

    if (job.cancelled) {
      // Stopped by the user — finalize as "done" with whatever was produced so
      // far (may be empty) so the client can insert the partial batch.
      save({
        status: "done",
        questions: collected.length ? balanceCorrectOptions(reorderNoConsecutiveTypes(collected)) : [],
        error: "cancelled",
      });
    } else if (!collected.length) {
      let msg;
      if (lastError?.status === 429) {
        msg = quota429Message(lastError.detail);
      } else if (lastError?.status === 520) {
        msg =
          "The AI kept returning empty responses. This usually means the selected model is a 'thinking'/lite model (the default gemini-2.5-flash-lite often does this) or a safety filter blocked the request. Go to Admin → AI Keys, set the key's model to gemini-2.5-flash (or another full model), pick that model in the generator, and try again.";
      } else if (lastError?.status === 404) {
        msg =
          "The selected AI model isn't available for your key (404). Go to Admin → AI Keys, click 'Show models' on the key to see valid model ids, click one to set it, then pick that model in the generator.";
      } else if (lastError) {
        const busy = lastError.status === 503 ? " The model is busy — try again shortly or pick a different model." : "";
        msg = `AI provider error (${lastError.status}).${busy} ${(lastError.detail || "").slice(0, 200)}`;
      } else {
        msg = "The AI did not return any usable questions. Try again, a simpler topic, or a different model.";
      }
      save({ status: "error", error: msg });
    } else {
      // Finished (possibly short of target if every key's quota ran out). Even out
      // the correct-answer positions across the whole batch before returning.
      // Only flag "quota" when we actually fell short.
      const short = collected.length < target;
      save({ status: "done", questions: balanceCorrectOptions(reorderNoConsecutiveTypes(collected)), error: short && lastError?.status === 429 ? "quota" : null });
    }
  } catch (err) {
    save(collected.length ? { status: "done", questions: balanceCorrectOptions(reorderNoConsecutiveTypes(collected)) } : { status: "error", error: err?.message || "AI request failed." });
  }
}

// POST /api/ai/generate  (admin)
// Body: { topic, notes, model, plan:[{type,difficulty,count}] }  (or legacy { count, difficulty, types })
// Starts a background job and returns { jobId, requested }. Poll /api/ai/job/:id.
export async function generateQuestions(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const requestedModel = String(req.body?.model || "").trim();

  // Build one worker per ENABLED key in a scope so they ALL generate at once. A
  // key that serves the chosen model uses it; any other key uses its own first
  // model — so every available key contributes, not just those on the model.
  const buildPool = async (sc) => {
    const chosen = await resolveModel(requestedModel, sc);
    if (!chosen || !chosen.endpoints.length) return { model: null, workers: [] };
    const provs = await providers(sc);
    return {
      model: chosen.model,
      workers: provs.map((p) => ({
        key: p.key,
        baseUrl: p.baseUrl,
        owner: sc.owner ?? null,
        model: p.models.includes(chosen.model) ? chosen.model : (p.models[0] || chosen.model),
        label: p.label || `••••${String(p.key).slice(-4)}`,
      })),
    };
  };

  // The OTHER pool the admin allows, used as an automatic fallback when the
  // client's chosen pool is empty or rate-limited (429). Admins/students always
  // use the single platform pool, so they have no fallback pool.
  let fallbackScope = null;
  if (req.user?.role === "client") {
    if (scope.mode === "self" && scope.allowInbuilt) fallbackScope = { owner: null, includeEnv: true, mode: "inbuilt" };
    else if (scope.mode === "inbuilt" && scope.allowSelf) fallbackScope = { owner: req.user._id, includeEnv: false, mode: "self" };
  }

  const primaryPool = await buildPool(scope);
  const fallbackPool = fallbackScope ? await buildPool(fallbackScope) : { model: null, workers: [] };

  if (!primaryPool.workers.length && !fallbackPool.workers.length) {
    return res.status(400).json({
      message:
        scope.mode === "self"
          ? "No API keys added yet. Go to the AI tab, choose “Use my own API keys” and add at least one key, or switch to Built-in APIs."
          : "AI is not configured. Add an API key in Admin → AI Keys, or set AI_API_KEY on the server.",
    });
  }

  // Prefer the client's selected pool. If it has no keys at all, promote the
  // fallback pool to primary (and then there's nothing left to fall back to).
  const usingPrimary = primaryPool.workers.length > 0;
  const workers = usingPrimary ? primaryPool.workers : fallbackPool.workers;
  const fallbackWorkers = usingPrimary ? fallbackPool.workers : [];
  const jobOwner = (usingPrimary ? scope.owner : fallbackScope?.owner) ?? null;
  const model = usingPrimary ? primaryPool.model : fallbackPool.model;

  // Optional SOURCE MATERIAL: a pasted paragraph and/or a page URL to generate
  // questions FROM. When present, a topic is not required (we derive one).
  const genUrl = String(req.body?.url || "").trim();
  let source = String(req.body?.source || "").trim();
  if (genUrl) {
    if (!/^https?:\/\//i.test(genUrl)) {
      return res.status(400).json({ message: "Enter a valid http(s) URL, or paste the text instead." });
    }
    const page = await fetchPageText(genUrl);
    if (!page.ok) {
      return res.status(502).json({ message: sourceReadError(genUrl, page) });
    }
    source = `${source}\n\n${page.text}`.trim();
  }
  if (source) source = source.slice(0, 24000); // cap material sent on each call

  let topic = String(req.body?.topic || "").trim();

  // Auto-research: when the user ticks "research the web" and hasn't supplied a
  // source link/text, fetch real up-to-date material for the topic (Tavily if an
  // admin configured a key, else free Wikipedia) so current-affairs topics are
  // built from verified facts rather than the model's frozen memory. Cached per
  // topic so multiple generation waves reuse the same material. Non-fatal: if it
  // finds nothing we simply fall back to topic-only generation.
  const wantResearch = req.body?.research === true || req.body?.research === "true";
  if (wantResearch && !source && topic) {
    const r = await webResearch(topic);
    if (r.ok && r.text) source = r.text.slice(0, 24000);
  }

  if (!topic) topic = source ? "the provided source material" : "";
  if (!topic) return res.status(400).json({ message: "A topic is required (or provide source material)." });

  const notes = String(req.body?.notes || "").trim();

  // Optional explicit subtopics the user wants questions spread across. Accepts
  // a newline/comma/semicolon-separated string OR an array. When provided we use
  // these instead of auto-detecting subtopics (and skip that extra API call).
  const rawSubtopics = req.body?.subtopics;
  let userSubtopics = Array.isArray(rawSubtopics)
    ? rawSubtopics.map((s) => String(s || ""))
    : typeof rawSubtopics === "string"
    ? rawSubtopics.split(/[\n,;]+/)
    : [];
  userSubtopics = [
    ...new Set(
      userSubtopics
        .map((s) => s.replace(/^\s*[-*•\d.)\]]+\s*/, "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length >= 2)
    ),
  ].slice(0, 60);

  // Effective per-batch cap + rate quota for this account (admin global cap, or
  // the client's assigned plan).
  const limits = await effectiveAiLimits(req.user);
  const perBatchCap = limits.maxPerBatch;

  // Explicit per-bucket plan — sanitized and capped at the per-batch cap. Falls
  // back to the legacy count/difficulty/types path when no plan is provided.
  let plan = null;
  if (Array.isArray(req.body?.plan)) {
    plan = req.body.plan
      .filter((b) => b && TYPES.includes(b.type) && DIFFS.includes(b.difficulty))
      .map((b) => ({ type: b.type, difficulty: b.difficulty, count: Math.max(0, parseInt(b.count, 10) || 0) }))
      .filter((b) => b.count > 0);
    let running = 0;
    plan = plan
      .map((b) => {
        const c = Math.min(b.count, Math.max(0, perBatchCap - running));
        running += c;
        return { ...b, count: c };
      })
      .filter((b) => b.count > 0);
    if (!plan.length) plan = null;
  }

  const count = Math.min(perBatchCap, Math.max(1, parseInt(req.body?.count, 10) || 5));
  const difficulty = req.body?.difficulty;
  const types = Array.isArray(req.body?.types)
    ? req.body.types.filter((t) => TYPES.includes(t))
    : [];

  const target = plan ? plan.reduce((s, b) => s + b.count, 0) : count;

  // Per-window rate quota (clients only; admins are unlimited). Blocks a run
  // that would exceed the plan's questions-per-window allowance.
  if (req.user?.role === "client" && limits.perWindow !== Infinity) {
    const windowMs = limits.windowMinutes * 60 * 1000;
    const used = aiRecentUsage(String(req.user._id), windowMs);
    if (used + target > limits.perWindow) {
      const remaining = Math.max(0, limits.perWindow - used);
      return res.status(429).json({
        message: `Your plan allows ${limits.perWindow} question(s) every ${limits.windowMinutes} minutes. You have ${remaining} left right now — reduce the batch size or wait a few minutes.`,
        quota: { perWindow: limits.perWindow, windowMinutes: limits.windowMinutes, used, remaining },
      });
    }
    aiRecordUsage(String(req.user._id), target);
  }

  cleanupJobs();
  const id = newJobId();
  genJobs.set(id, {
    status: "pending",
    questions: [],
    requested: target,
    error: null,
    model,
    plan: plan || null, // per type × difficulty buckets — powers the live breakdown
    updatedAt: Date.now(),
  });

  // Stems of questions that already exist (from earlier batches) — the generator
  // must not repeat these. Capped to keep the request reasonable.
  const avoid = Array.isArray(req.body?.avoid)
    ? req.body.avoid.filter((s) => typeof s === "string" && s.trim()).slice(0, 1000)
    : []; // may include EVERY existing question in the whole topic (across its quizzes) so new questions don't duplicate them

  // Fire-and-forget — the client polls /api/ai/job/:id for progress.
  guardJob(id, runGenerationJob(id, { workers, fallbackWorkers, model, topic, notes, plan, count, difficulty, types, target, avoid, owner: jobOwner, source, userSubtopics, numerical: !!req.body?.numerical, reshape: !!req.body?.reshape }));

  res.json({ jobId: id, requested: target, model });
}

// GET /api/ai/job/:id  (admin) — poll generation progress.
export function jobStatus(req, res) {
  const job = genJobs.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Job not found or expired." });
  // Live per-type/per-difficulty breakdown ("have / want") from what's been
  // produced so far, so the UI can show e.g. "Assertion & Reason — Hard 8/10".
  let byBucket;
  if (Array.isArray(job.plan) && job.plan.length) {
    const have = {};
    for (const q of job.questions) { const k = `${q.type}|${q.difficulty}`; have[k] = (have[k] || 0) + 1; }
    byBucket = job.plan.map((b) => ({
      type: b.type,
      difficulty: b.difficulty,
      want: b.count,
      have: have[`${b.type}|${b.difficulty}`] || 0,
    }));
  }
  res.json({
    status: job.status, // pending | done | error
    count: job.questions.length,
    requested: job.requested,
    byBucket, // [{ type, difficulty, want, have }] — undefined for legacy/count-mode jobs
    chunksTotal: job.chunksTotal, // for import jobs (source split into pieces)
    chunksDone: job.chunksDone,
    model: job.model,
    error: job.error,
    cancelled: !!job.cancelled,
    keyStats: job.keyStats || {}, // live per-key activity this run
    waitUntil: job.waitUntil || null, // epoch ms until an auto-retry after a rate limit → UI shows a countdown
    questions: job.status === "done" ? job.questions : undefined,
  });
}

// POST /api/ai/job/:id/cancel  (admin/client) — request a running background job
// to STOP. The workers (generate / import / extend / regenerate) check
// job.cancelled between chunks and finish early, KEEPING whatever they produced
// so far (the job still finalizes as "done" with the partial questions, so the
// user can insert what was generated before stopping). An in-flight provider
// call already sent isn't aborted — no NEW work is started once cancelled.
export function cancelJob(req, res) {
  const job = genJobs.get(req.params.id);
  if (!job) return res.status(404).json({ message: "Job not found or expired." });
  job.cancelled = true;
  job.updatedAt = Date.now();
  res.json({ ok: true, status: job.status });
}


/* --------------------- Import questions from a website / text ---------------------
   The admin pastes a page URL and/or the copied text; the AI EXTRACTS the
   questions already present and returns them in the app schema for preview. */

const MAX_SOURCE_CHARS = 400000; // overall cap on pasted/fetched material
// Smaller pieces per call so the JSON reply (which lists many questions) does
// not hit the model's output-token limit and get truncated — truncation was
// silently dropping the tail questions of every chunk.
const SOURCE_CHUNK_CHARS = 6000; // size of each piece sent to the model per call
const SOURCE_CHUNK_OVERLAP = 500; // repeat a little of the previous piece so a question split across a boundary is still captured whole (duplicates are removed later)

// Split large source text into chunks, breaking on natural boundaries so a
// question isn't cut in half. Handles multi-section pages in one import. Each
// piece overlaps the previous one slightly so boundary questions aren't lost.
function splitSource(text, size) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const brk = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (brk > size * 0.5) end = i + brk + 1;
    }
    chunks.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(end - SOURCE_CHUNK_OVERLAP, i + 1); // step back for overlap, but always move forward
  }
  return chunks.filter(Boolean);
}

// Number of questions to send to the model per call (user-requested batch size).
const QUESTIONS_PER_CHUNK = 20;
// Safety ceiling so a batch of long questions can't grow big enough to truncate
// the model's JSON reply (which would drop questions — the very bug we fixed).
const QUESTION_CHUNK_MAX_CHARS = 14000;

// Detect numbered questions in the source and group them into batches of
// ~QUESTIONS_PER_CHUNK. This makes each AI call handle a predictable number of
// questions (20, 20, …) instead of a blind character slice. Returns
// { count, chunks } or null when no reliable numbering is found (caller then
// falls back to character-based splitting).
function splitByQuestions(text, perChunk = QUESTIONS_PER_CHUNK) {
  // Line-start question markers. The leading markup run allows ANY mix of
  // Markdown markers and spaces BEFORE the number/keyword — so a bold-wrapped
  // heading like "### **Question 201**" is recognised (previously the "**" and
  // the "**" that CLOSES the number were not handled, so such headings were
  // missed entirely and extraction latched onto an unrelated "1. 2. 3." list
  // inside an answer — dropping every question before it).
  //   Recognised: "### **Question 201**", "## 1.", "**1.**", "> 3.", "- 4)",
  //               "Q3.", "Question 5:", "1)".
  // The number may be closed by ".)]:", by Markdown bold/italic ("**"/"_"), or by
  // end-of-line — a lookahead, so a 4-digit year like "2026." is never matched.
  const re = /(^|\n)((?:[#>\-]+|[*_]+|[ \t]+)*)(Q(?:uestion)?\.?[ \t]*)?(?:[*_]+[ \t]*)?(\d{1,3})(?=[.)\]:*_]|[ \t]*(?:\n|$))/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    // "strong" = a real question number: introduced by a "Q"/"Question" keyword,
    // or wrapped in Markdown heading/bold (#, *, _). Bare "1." lines are weak.
    const strong = /[#*_]/.test(m[2] || "") || !!m[3];
    marks.push({ pos: m.index + (m[1] ? m[1].length : 0), num: parseInt(m[4], 10), strong });
    if (re.lastIndex === m.index) re.lastIndex++; // guard against a zero-width match stalling the loop
  }
  // When the document uses strong markers (headings/bold/"Q"), rely ONLY on those
  // so a numbered list inside a question can't fragment it. Plain numbered papers
  // (no markup at all) keep using every numbered line as before.
  const hasStrong = marks.some((mk) => mk.strong);
  let usable = (hasStrong ? marks.filter((mk) => mk.strong) : marks).sort((a, b) => a.pos - b.pos);
  usable = usable.filter((mk, i) => i === 0 || mk.pos !== usable[i - 1].pos); // drop coincident matches
  // Keep a sequential chain so stray numbers / numbered options aren't mistaken
  // for question starts. STRONG markers are explicit, so we trust them from the
  // FIRST one and only require the numbers to keep increasing — this handles a
  // paper that starts high (e.g. "Questions 201–305") and tolerates a missing
  // number. BARE-only papers still must begin near the first question (num <= 3)
  // to avoid latching onto an incidental list. A reset to 1 starts a new section.
  const starts = [];
  let prev = null;
  for (const mk of usable) {
    if (prev === null) {
      if (hasStrong || mk.num <= 3) { starts.push(mk.pos); prev = mk.num; }
    } else if (mk.num === 1 || (hasStrong ? mk.num > prev : mk.num === prev + 1)) {
      starts.push(mk.pos);
      prev = mk.num;
    }
  }
  if (starts.length < 2) return null; // no reliable numbering — fall back

  // One text block per detected question.
  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const block = text.slice(starts[i], end).trim();
    if (block) blocks.push(block);
  }

  // Group into batches of `perChunk`, but start a new batch early if adding the
  // next question would exceed the char ceiling.
  const chunks = [];
  let cur = [];
  let curChars = 0;
  for (const b of blocks) {
    if (cur.length && (cur.length >= perChunk || curChars + b.length > QUESTION_CHUNK_MAX_CHARS)) {
      chunks.push(cur.join("\n\n"));
      cur = [];
      curChars = 0;
    }
    cur.push(b);
    curChars += b.length + 2;
  }
  if (cur.length) chunks.push(cur.join("\n\n"));
  return { count: blocks.length, chunks };
}

// Hard filter so ONLY genuine questions survive extraction — never headers,
// footers, reference/file numbers, exam-centre/hall names, instructions, marks,
// time, roll-number fields, invigilator/signature lines, page markers, etc.
const EXTRACT_JUNK = [
  /file\s*no[.:]/i,
  /generated\s+from\s+\w*office/i,
  /\bcomputer\s*no\b/i,
  /\d{3,}\s*\/\s*\d{2,4}\s*\/\s*\d+\s*\/\s*\d+/, // reference no. like 8233675/2026/0/0
  /(maximum|max\.?|total)\s+marks|marks\s*[:=]/i,
  /\btime\s*(allowed|:|=)|\bduration\b/i,
  /\broll\s*(no|number)\b/i,
  /\b(invigilator|signature|candidate'?s?\s+name)\b/i,
  /read\s+the\s+following\s+instructions|do\s+not\s+open|rough\s+work|instructions\s+to\s+candidates/i,
  /\bp\.?\s*t\.?\s*o\.?\b/i,
  /service\s+selection\s+board/i,
];

function isRealQuestion(q) {
  const text = String(q?.text || "").trim();
  if (!text) return false;
  if (EXTRACT_JUNK.some((re) => re.test(text))) return false; // obvious boilerplate
  // Every supported question type carries answer options; headers/instructions
  // do not. Require at least 2 real options + a non-trivial stem.
  const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || "").trim()).filter(Boolean);
  if (opts.length < 2) return false;
  if (text.replace(/[^a-z0-9]/gi, "").length < 5) return false; // too short to be a question
  return true;
}

// Signature to de-duplicate questions collected across chunks/sections. Strips
// ALL non-alphanumerics and sorts the options/columns so the SAME question
// extracted twice (with minor whitespace/punctuation/order differences from the
// chunk overlap or OCR) collapses to one — fixing over-counts like 80 -> 84.
// Options are still part of the key so distinct questions that share a generic
// stem ("Which of the following is correct?") are NOT wrongly merged.
function extractSig(q) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const stem = norm(q.text).slice(0, 200);
  const opts = (Array.isArray(q.options) ? q.options : []).map(norm).filter(Boolean).sort().join("|");
  const cols = [...(q.columnA || []), ...(q.columnB || [])].map(norm).filter(Boolean).sort().join("|");
  return `${stem}##${opts}##${cols}`;
}

// A normal browser UA — some sites (and YouTube) reject unknown clients.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Decode the HTML entities that show up in scraped text / caption XML.
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

// Pull the 11-char video id out of any common YouTube link shape.
function youTubeId(url) {
  const m = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// Fetch a YouTube video's TRANSCRIPT (captions) as plain text, so questions can
// be generated/extracted from a video link. Works only for videos that have
// captions (manual or auto). Uses YouTube's own caption track — no extra deps.
// fetch() with a per-request timeout and automatic retry/back-off on the
// transient statuses YouTube throws at datacentre IPs (429 Too Many Requests,
// 403 age/consent walls that clear on retry, and 5xx). Uses exponential
// back-off with jitter, honouring a Retry-After header when present.
async function fetchRetry(url, opts = {}, { tries = 4, timeoutMs = 20000 } = {}) {
  let lastStatus = 0;
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      // Retry only on transient rate-limit / server errors.
      if (resp.status === 429 || resp.status === 503 || resp.status === 500) {
        lastStatus = resp.status;
        if (attempt < tries - 1) {
          const retryAfter = Number(resp.headers.get("retry-after"));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15000)
            : Math.min(800 * 2 ** attempt, 8000) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return resp;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < tries - 1) {
        await new Promise((r) => setTimeout(r, Math.min(800 * 2 ** attempt, 6000)));
        continue;
      }
      throw e;
    }
  }
  // Exhausted retries on a transient status — surface it as a synthetic response.
  return { ok: false, status: lastStatus, text: async () => "", json: async () => ({}), headers: new Map(), _err: lastErr };
}

// Turn a caption track's baseUrl into flat transcript text (json3 or XML).
async function readCaptionTrack(baseUrl, headers) {
  let u = String(baseUrl || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  if (!u) return "";
  if (!/[?&]fmt=/.test(u)) u += "&fmt=json3"; // easier to parse than XML
  const cap = await fetchRetry(u, { headers }, { tries: 4, timeoutMs: 20000 });
  if (!cap.ok) return "";
  const raw = await cap.text();
  let text = "";
  try {
    const data = JSON.parse(raw); // json3 format
    if (Array.isArray(data.events)) {
      text = data.events.map((e) => (e.segs || []).map((s) => s.utf8 || "").join("")).join(" ");
    }
  } catch {
    text = raw.replace(/<[^>]+>/g, " "); // XML fallback: strip <text> tags
  }
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function pickTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  return (
    tracks.find((t) => /^en/i.test(t.languageCode || "")) ||
    tracks.find((t) => /en/i.test(t.vssId || "")) ||
    tracks[0]
  );
}

// Ask YouTube's InnerTube player API for the caption tracks. Datacentre IPs get
// rate-limited (429) far less often here than on the public watch page, and the
// ANDROID client rarely hits consent/age walls — so we try this FIRST.
async function ytCaptionTracksViaInnerTube(id) {
  // Public InnerTube key + a couple of client identities to try in order.
  const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const clients = [
    { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
    { clientName: "WEB", clientVersion: "2.20240726.00.00" },
  ];
  for (const client of clients) {
    try {
      const resp = await fetchRetry(
        `https://www.youtube.com/youtubei/v1/player?key=${KEY}&prettyPrint=false`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": BROWSER_UA,
            "Accept-Language": "en-US,en;q=0.9",
            "X-Goog-Api-Format-Version": "2",
          },
          body: JSON.stringify({ context: { client: { ...client, hl: "en", gl: "US" } }, videoId: id }),
        },
        { tries: 4, timeoutMs: 20000 }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length) return tracks;
    } catch { /* try next client */ }
  }
  return [];
}

// Fall back to scraping the watch page for caption tracks.
async function ytCaptionTracksViaWatchPage(id, headers) {
  const resp = await fetchRetry(
    `https://www.youtube.com/watch?v=${id}&hl=en`,
    { redirect: "follow", headers: { ...headers, Accept: "text/html" } },
    { tries: 4, timeoutMs: 20000 }
  );
  if (!resp.ok) return { tracks: [], status: resp.status };
  const html = await resp.text();
  const m = html.match(/"captionTracks":(\[.*?\])/s);
  let tracks = [];
  if (m) { try { tracks = JSON.parse(m[1]); } catch { /* fall through */ } }
  if (!tracks.length) {
    const urls = [...html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g)].map((x) => x[1]);
    tracks = urls.map((u) => ({ baseUrl: u }));
  }
  return { tracks, status: resp.status };
}

// Fetch a YouTube video's TRANSCRIPT (captions) as plain text, so questions can
// be generated/extracted from a video link. Works only for videos that have
// captions (manual or auto). Tries the InnerTube API first, then the watch page,
// each with retry/back-off so a transient HTTP 429 doesn't fail the whole thing.
async function fetchYouTubeTranscript(url) {
  const id = youTubeId(url);
  if (!id) return { ok: false, error: "Not a recognised YouTube link." };
  const headers = { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" };
  try {
    // 1) Preferred path: InnerTube player API (rarely rate-limited).
    let tracks = await ytCaptionTracksViaInnerTube(id);
    let lastStatus = 0;
    // 2) Fallback: scrape the watch page.
    if (!tracks.length) {
      const wp = await ytCaptionTracksViaWatchPage(id, headers);
      tracks = wp.tracks;
      lastStatus = wp.status;
    }
    if (!tracks.length) {
      if (lastStatus === 429) {
        return { ok: false, status: 429, error: "YouTube is rate-limiting the server right now (HTTP 429). Please wait a minute and try again, or open the video, copy its transcript, and paste it instead." };
      }
      return { ok: false, status: lastStatus || undefined, error: "This video has no transcript/captions available. Open the video, copy the transcript text, and paste it instead." };
    }
    // 3) Read the best caption track. If the first pick fails, try the rest.
    const ordered = [pickTrack(tracks), ...tracks].filter(Boolean);
    for (const track of ordered) {
      const text = await readCaptionTrack(track.baseUrl, headers);
      if (text) return { ok: true, text };
    }
    return { ok: false, error: "Couldn't fetch the video transcript — YouTube may be throttling the server. Wait a minute and retry, or paste the transcript text instead." };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "The video took too long to load." : (e?.message || "Couldn't read the video.") };
  }
}

// Build a friendly message when a source URL couldn't be read. YouTube links
// already carry a full, helpful message (and the HTTP code) in page.error, so
// we don't prefix them with the generic "Couldn't read that page" wording.
function sourceReadError(url, page) {
  if (youTubeId(url)) {
    return page.error || `Couldn't read that YouTube video${page.status ? ` (HTTP ${page.status})` : ""}. Open the video, copy its transcript, and paste it instead.`;
  }
  return `Couldn't read that page${page.status ? ` (HTTP ${page.status})` : ""}. ${page.error || "The site may block automated access — paste the text instead."}`;
}

// Fetch a web page and reduce it to readable plain text. For a YouTube link it
// returns the video's transcript instead of the (useless) page HTML.
async function fetchPageText(url) {
  if (youTubeId(url)) {
    const yt = await fetchYouTubeTranscript(url);
    // Don't fall back to page HTML for a video — it has no useful text.
    if (yt.ok) return yt;
    return { ok: false, status: yt.status, error: yt.error || "Couldn't read the video's transcript. Copy the transcript text and paste it instead." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // A normal browser UA — some sites reject unknown clients.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) return { ok: false, status: resp.status };
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ") // strip tags
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "The page took too long to load." : e?.message };
  } finally {
    clearTimeout(timer);
  }
}

function buildExtractPrompt(sourceText, notes = "") {
  const instr = String(notes || "").trim();
  return [
    'You extract questions from an exam/quiz document. Return ONLY JSON: {"questions":[...]}.',
    ...(instr
      ? ["", `======================\nMANDATORY USER INSTRUCTIONS (HIGHEST PRIORITY)\nThe user gave these instructions — follow them EXACTLY while extracting (e.g. only keep questions on a given topic, translate/clean wording, fix obvious OCR typos, set difficulty, etc.). They OVERRIDE any conflicting rule below:\n${instr}\n======================`]
      : []),
    "",
    "MOST IMPORTANT: capture EVERY question in the material below — do not skip, summarise or merge any. If the text contains 40 questions, return all 40, in their original order.",
    "Equally important: do NOT invent questions, do NOT repeat/duplicate a question, and do NOT split one question (or its sub-parts/options) into multiple questions. The number you return must NOT exceed the number actually present in the text.",
    "The source questions are NUMBERED. For EACH question, include its printed source number as an integer field \"n\", and return EXACTLY ONE object per printed question, in the original order. Never merge two questions into one object, and NEVER split one question into two.",
    "Question numbers may RESTART at 1 for every new SECTION / PART of the paper (e.g. several sections each beginning at \"Question No. 1\") — that is normal and expected, and the same number can appear in several sections. Treat EVERY printed question as its own separate object even when its number repeats across sections; never drop, merge or renumber a question just because that number appeared earlier.",
    "A single question OFTEN CONTAINS internal structure — a data / frequency / marks table, x/y value rows, a \"Match the following\" list (I, II, III, IV), an assertion–reason pair, or numbered statements (1., 2., 3., …). ALL of that is PART OF ONE question. NEVER treat a table row, a match item, a statement line, a sub-part, or an answer option as a separate question. Keep the whole thing as exactly ONE object of the appropriate type.",
    "The number of objects you return for this material must EQUAL the number of printed question stems in it — never more. If you are unsure whether something is a new question or a part of the previous one, keep it as part of the previous one.",
    "Write any mathematical or numerical content as INLINE MATH using $…$ (LaTeX) inside \"text\" and \"options\": equations, fractions, exponents/powers, roots, ratios, percentages, and the numbers used in quantitative questions. Examples: $2^{10}\\times5^{8}$, $\\frac{3}{4}$, $x\\%$ of $y$, $45678x9231$, $\\sqrt{2}$. (Numbers that are just part of ordinary prose need not be wrapped.)",
    "NEVER use the \"$\" character for money/currency — \"$\" is reserved only for wrapping math, and a stray \"$\" (e.g. \"$300\") corrupts rendering. Write money as \"300 dollars\"/\"900 rupees\"/just the number.",
    "",
    "Output ONLY actual questions — NOTHING else. A valid question has a stem AND answer options. IGNORE and never output: titles, headings, exam/booklet names, exam-centre or hall names (e.g. \"Clerical Hall JKSSB\"), file/reference/computer numbers (e.g. \"8233675/2026/0/0\", \"File No. …\"), page numbers, \"Set-A\", \"P.T.O.\", maximum marks, time/duration, roll-number/candidate fields, invigilator or signature lines, general instructions, section headers, and watermarks. If a line or block is not a real question with options, drop it entirely.",
    "",
    "If a reading PASSAGE / paragraph is given before a group of questions (comprehension), prepend the relevant passage text to the \"text\" of each of those questions so each question is self-contained; do NOT output the passage on its own as a question.",
    "",
    "Reproduce each question exactly as written (same wording, same options). For each one set:",
    '- "text": the full question stem, verbatim.',
    '- "type": choose the type that matches how the question actually looks:',
    '    • "assertion" — an Assertion (A) and Reason (R) pair → put them in "assertion" and "reason".',
    '    • "statement" — a "consider the following statements" question → put each statement verbatim in "columnA" (array).',
    '    • "matching" — match Column A with Column B. Put Column A entries (WITHOUT labels) in "columnA" — the app shows them as 1,2,3,4 — and Column B entries in "columnB" — the app shows them as I,II,III,IV. Each of the 4 "options" must be a full A→B mapping using EXACTLY those labels, e.g. "1-III, 2-I, 3-IV, 4-II". Never put a/b/c/d inside an option and never relabel a column.',
    '    • "table" — data laid out as a table → each row as an array inside "tableRows".',
    '    • "mcq" — everything else: ordinary multiple choice, true/false, fill-in-the-blank, numerical/integer-answer, etc.',
    '- "options": the answer choices exactly as printed (4 for MCQ). For true/false use ["True","False","",""]. If more than 4 are printed, keep the 4 real ones. If the source genuinely has no printed options, give the most sensible 4.',
    '- "correct": 0-based index of the right option. For NUMERICAL questions, COMPUTE the answer yourself using the correct formula (formula → substitute values → result) and pick the option equal to YOUR result even if the source answer key differs (keys can be wrong). For matching/pair/statement questions, check each item and pick the option matching the true count. Otherwise use the source answer key (bold, "Ans", tick) or your best answer.',
    '- "explanation": keep it to ONE short sentence — EXCEPT for numerical questions, where you give the brief formula-based working (formula → substitution → result) that leads to the marked option.',
    "",
    "Keep everything BRIEF — do NOT write per-option notes or long explanations. Verbose output makes questions get cut off and lost, which must not happen.",
    "",
    "SOURCE MATERIAL:",
    sourceText,
  ].join("\n");
}

// Background worker: extract questions from every source chunk and combine
// (de-duplicated), so a multi-section page is imported in one go.
// `have` = questions the caller ALREADY has (from a first pass). We seed the
// de-dup set with them so a re-run collects ONLY the ones that were missed —
// this powers the "Extract remaining" button (e.g. got 68 of 80, fetch the
// other 12 without duplicates).
async function runExtractionJob(id, { endpoints, model, chunks, owner = null, have = [], notes = "" }) {
  const job = genJobs.get(id);
  const deadline = Date.now() + 8 * 60 * 1000; // 8-minute budget (smaller chunks = more calls)
  const collected = [];
  const seen = new Set();
  // Seed the de-dup set with the already-extracted questions so they are skipped
  // on a re-run ("Extract remaining"). Key by the STABLE CONTENT SIGNATURE, never
  // the source number: (1) the same question can come back with or without an
  // "n" between passes, and an n-key seeded from the first pass then fails to
  // match a signature-keyed re-extraction — so the duplicates slip through and a
  // re-run balloons far past the detected total (the "extract remaining 20 →
  // 140" bug); (2) multi-section papers reuse numbers (Section A "1.", Section B
  // "1."), so an n-key wrongly collapses two DISTINCT questions into one. The
  // signature is identical across passes and unique per real question.
  for (const nq of normalize(Array.isArray(have) ? have : [])) {
    seen.add(extractSig(nq));
  }
  let lastError = null;

  const save = (patch) => Object.assign(job, patch, { updatedAt: Date.now() });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Process every chunk, but treat a failed / empty / quota-blocked chunk as
  // RETRYABLE rather than losing it. The old loop dropped a whole chunk (~20
  // questions) whenever ONE call had a transient error (it just `continue`d),
  // and ABORTED the entire job on the first 429 (`break`) — both left the import
  // far short of the detected total. Now we make several passes: any chunk that
  // errors, is rate-limited, or parses to zero questions is retried on a later
  // pass, and a 429 makes us WAIT for the per-minute limit to reset (surfaced via
  // `waitUntil` for a live countdown) instead of giving up on the rest.
  const MAX_ROUNDS = 4;
  const doneIdx = new Set(); // chunks that returned a usable (parseable) reply
  let pending = chunks.map((text, idx) => ({ text, idx }));
  try {
    for (let round = 0; round < MAX_ROUNDS && pending.length && Date.now() < deadline && !job.cancelled; round++) {
      const failed = [];
      for (const item of pending) {
        if (Date.now() > deadline || job.cancelled) { failed.push(item); continue; }
        const r = await callWithFallback({
          endpoints,
          model,
          userPrompt: buildExtractPrompt(item.text, notes),
          maxTokens: 16000,
          owner,
        });
        if (!r.ok) {
          lastError = r;
          failed.push(item); // retry this chunk on a later pass
          if (r.status === 429) {
            // Quota/rate limit — wait for it to reset, then keep going instead of
            // abandoning every remaining chunk. Expose the wait for a countdown.
            const wait = 60000;
            if (Date.now() + wait < deadline) { save({ waitUntil: Date.now() + wait }); await sleep(wait); save({ waitUntil: null }); }
          }
          continue;
        }
        const parsed = normalize(parseQuestions(r.content));
        if (!parsed.length) { failed.push(item); continue; } // parse failed / empty / truncated to nothing — retry
        for (const q of parsed) {
          if (!isRealQuestion(q)) continue; // keep ONLY genuine questions — drop headers/instructions/etc.
          // De-duplicate by the STABLE CONTENT SIGNATURE (same key on every pass and
          // section) so a re-run adds only the genuinely-missed questions and never
          // re-piles ones we already have. (Source numbers are unreliable: they can
          // restart per section and may be present in one pass but absent in another.)
          const key = extractSig(q);
          if (seen.has(key)) continue; // skip duplicates across chunks / re-runs
          seen.add(key);
          collected.push(q);
        }
        doneIdx.add(item.idx);
        save({ questions: collected.slice(), chunksDone: doneIdx.size });
      }
      pending = failed;
      // Brief pause before retrying stragglers left by transient (non-quota) errors.
      if (pending.length && round < MAX_ROUNDS - 1 && Date.now() < deadline && !job.cancelled) await sleep(1500);
    }

    if (job.cancelled) {
      save({ status: "done", questions: collected, error: "cancelled" });
    } else if (!collected.length) {
      const msg =
        lastError?.status === 429
          ? "Gemini quota/rate limit reached before any questions were extracted. Wait a minute or use a different model."
          : lastError
          ? `AI provider error (${lastError.status}). ${(lastError.detail || "").slice(0, 200)}`
          : "No questions could be extracted. Make sure the source actually contains questions.";
      save({ status: "error", error: msg });
    } else {
      // If any chunk is still unfinished (ran out of rounds/time), flag it so the
      // UI nudges the user to click "Extract remaining" for the last few.
      const incomplete = pending.length > 0;
      save({ status: "done", questions: collected, error: incomplete ? (lastError?.status === 429 ? "quota" : "partial") : null });
    }
  } catch (err) {
    save(collected.length ? { status: "done", questions: collected } : { status: "error", error: err?.message || "Import failed." });
  }
}

// POST /api/ai/extract  (admin)
// Body: { url?, content?, model? } — starts a background import job over the
// whole source (all sections) and returns { jobId }. Poll /api/ai/job/:id.
export async function extractQuestions(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message:
        scope.mode === "self"
          ? "No API keys added yet. Go to the AI tab, choose “Use my own API keys”, and add at least one key."
          : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }
  const { model, endpoints } = chosen;
  const url = String(req.body?.url || "").trim();
  let content = String(req.body?.content || "").trim();

  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ message: "Enter a valid http(s) URL, or paste the text instead." });
    }
    const page = await fetchPageText(url);
    if (!page.ok) {
      return res.status(502).json({ message: sourceReadError(url, page) });
    }
    content = `${content}\n\n${page.text}`.trim();
  }

  if (!content) {
    return res.status(400).json({ message: "Provide a page URL or paste the questions text to import." });
  }

  const source = content.slice(0, MAX_SOURCE_CHARS);
  // First figure out how many questions the source contains and split it into
  // batches of ~20 questions each. If numbering can't be detected reliably,
  // fall back to character-based splitting.
  const detected = splitByQuestions(source);
  const chunks = detected ? detected.chunks : splitSource(source, SOURCE_CHUNK_CHARS);

  cleanupJobs();
  const id = newJobId();
  genJobs.set(id, {
    status: "pending",
    questions: [],
    requested: detected?.count || null, // detected question count (when known)
    chunksTotal: chunks.length,
    chunksDone: 0,
    error: null,
    model,
    updatedAt: Date.now(),
  });

  // Already-extracted questions from a previous pass (for "Extract remaining") —
  // they seed the de-dup set so only the missed questions come back. Capped.
  const have = Array.isArray(req.body?.have) ? req.body.have.slice(0, 500) : [];
  // Optional strong user instructions to steer extraction.
  const notes = String(req.body?.notes || "").trim();

  guardJob(id, runExtractionJob(id, { endpoints, model, chunks, owner: scope.owner, have, notes }));
  res.json({ jobId: id, chunks: chunks.length, questionsDetected: detected?.count || 0, model });
}


/* --------------------------- Study notes generation --------------------------- */

const NOTES_SYSTEM_PROMPT = `You are an expert teacher who writes concise, exam-ready STUDY NOTES.
Output PLAIN TEXT using light Markdown ONLY — no HTML, no code fences:
- "# " for the main title, "## " for sections, "### " for sub-sections.
- "- " for bullet points; keep each bullet short and factual.
- **bold** for key terms; ==highlight== for the single most important facts/definitions.
- Prefer short lines and clear structure over long paragraphs.
- Include key dates, formulas, definitions and short examples where relevant.
- Only when a term/place genuinely has a former/renamed name, add it in brackets (e.g. "Mumbai (formerly Bombay)"); don't translate ordinary terms into vernacular or force alternative names.
Write mathematical/numeric content as inline math between $...$ (LaTeX).
NEVER use the "$" sign for money/currency (write "300 dollars"/"900 rupees"/just the number) — "$" is reserved only for wrapping math and a stray "$" corrupts rendering.
Return ONLY the notes — no preamble, no closing remarks.`;

function buildNotesPrompt({ topic, notes }) {
  const lines = [
    `Write clear, well-structured revision STUDY NOTES on: ${topic}.`,
    "Organise them with a title, sections and short bullet points covering the important points a student needs to revise.",
  ];
  if (notes) lines.push(`Extra instructions: ${notes}`);
  return lines.join("\n");
}

// POST /api/ai/infer-topic — given a few existing question stems, name the ONE
// specific topic/syllabus they belong to. Lets the generator pre-fill the topic
// for quizzes built BEFORE the topic was remembered. Returns { topic }.
export async function inferTopic(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.json({ topic: "" });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) return res.json({ topic: "" });
  const stems = (Array.isArray(req.body?.questions) ? req.body.questions : [])
    .map((s) => String(s?.text || s || "").trim())
    .filter(Boolean)
    .slice(0, 40);
  if (!stems.length) return res.json({ topic: "" });
  const userPrompt = [
    "Below are exam question stems that all come from ONE quiz. In 3-8 words, name the SINGLE specific topic/syllabus they belong to, as a student would title it (e.g. \"Physiography of Jammu and Kashmir\", \"Indian Constitution — Fundamental Rights\"). Return ONLY the topic text — no quotes, no explanation, no trailing punctuation.",
    ...stems.map((s, i) => `${i + 1}. ${s.slice(0, 160)}`),
  ].join("\n");
  const r = await callWithFallback({
    endpoints: chosen.endpoints,
    model: chosen.model,
    userPrompt,
    maxTokens: 40,
    owner: scope.owner,
    systemPrompt: "You output ONLY a short topic name, nothing else.",
  });
  const topic = r.ok
    ? String(r.content || "").split("\n")[0].replace(/^["'\s]+|["'\s.]+$/g, "").slice(0, 120)
    : "";
  res.json({ topic });
}

// POST /api/ai/outline-units — read SOURCE MATERIAL (a PDF / pasted text) and
// return the distinct UNITS / CHAPTERS / TOPICS it is organised into, so the
// caller can auto-create one topic per unit under a subject and generate
// questions per topic. Returns { units: ["Unit name", ...] }.
export async function outlineUnits(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self" ? "No API keys added yet." : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }
  let source = String(req.body?.source || "").trim();
  if (!source) return res.status(400).json({ message: "Provide the PDF/source text to detect units from." });
  source = source.slice(0, 24000);

  const userPrompt = [
    "You are a curriculum analyst. Read the SOURCE MATERIAL below and identify the distinct UNITS / CHAPTERS / TOPICS it is organised into (the natural sections a teacher would split it into for separate quizzes).",
    "Rules:",
    "- Base the list ONLY on what is actually present in this material — do NOT invent outside units.",
    "- Prefer the document's own unit/chapter/section headings when present; otherwise group by distinct themes.",
    "- Keep each unit name a short, clear title (3-10 words).",
    "- Return between 2 and 30 units, in the order they appear.",
    "",
    "SOURCE MATERIAL:",
    source,
    "",
    'Return ONLY a JSON array of strings, e.g. ["Unit 1 title","Unit 2 title"]. No commentary, no markdown.',
  ].join("\n");

  const r = await callWithFallback({
    endpoints: chosen.endpoints,
    model: chosen.model,
    userPrompt,
    maxTokens: 1500,
    owner: scope.owner,
    systemPrompt: "You output ONLY a JSON array of short strings — no markdown, no commentary.",
  });
  if (!r.ok) {
    return res.status(502).json({ message: r.status === 429 ? quota429Message(r.detail) : `AI provider error (${r.status}). ${(r.detail || "").slice(0, 160)}` });
  }
  // De-duplicate case-insensitively, keep order, cap at 30.
  const seen = new Set();
  const units = [];
  for (const u of parseStringArray(r.content)) {
    const k = u.toLowerCase().replace(/\s+/g, " ").trim();
    if (k.length < 2 || seen.has(k)) continue;
    seen.add(k);
    units.push(u.replace(/\s+/g, " ").trim());
    if (units.length >= 30) break;
  }
  res.json({ units });
}

// POST /api/ai/parse-syllabus — read a FULL syllabus (pasted text / extracted
// PDF / OCR) and return the structure to save in one go:
//   { subject, topics: [ { title, subtopics: [ ... ] } ] }
// Powers the standalone "Import syllabus" flow (create Subject → Topics, with
// each topic's subtopics saved for generate-now-or-later).
export async function parseSyllabus(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({ message: scope.mode === "self" ? "No API keys added yet." : "AI is not configured. Add an API key in Admin → AI Keys." });
  }
  let source = String(req.body?.source || "").trim();
  if (!source) return res.status(400).json({ message: "Paste or upload the syllabus text first." });
  source = source.slice(0, 24000);

  const userPrompt = [
    "You are a curriculum analyst. Read the SYLLABUS below and extract its structure for an exam-prep app.",
    "Return STRICT JSON of EXACTLY this shape (no markdown, no commentary):",
    '{ "subject": "overall subject/paper name", "topics": [ { "title": "topic or section name", "subtopics": ["point 1","point 2"] } ] }',
    "Rules:",
    "- Base everything ONLY on what is present in this syllabus — do NOT invent outside topics.",
    "- \"subject\" MUST NEVER be blank. Use the syllabus's stated subject/paper title if present; otherwise INFER a concise, standard subject name from the topics — e.g. content about cells, tissues, and the cardiovascular/digestive/respiratory/nervous systems → \"Anatomy and Physiology\". Ignore page numbers, annexure labels and \"Semester\" lines; give the real subject.",
    "- Each \"topics\" entry is a distinct section/chapter/system the syllabus lists (short title, 2-10 words), in the order they appear.",
    "- \"subtopics\" are the specific points listed under that topic. Split long comma/semicolon lists into separate short items (3-12 words each). If a topic lists no explicit points, use [].",
    "- Stay faithful to the wording; do not add explanations.",
    "",
    "SYLLABUS:",
    source,
    "",
    "Return ONLY the JSON object.",
  ].join("\n");

  const r = await callWithFallback({
    endpoints: chosen.endpoints,
    model: chosen.model,
    userPrompt,
    maxTokens: 6000,
    owner: scope.owner,
    failOnEmpty: true,
    systemPrompt: 'You output ONLY a strict JSON object {"subject":"...","topics":[{"title":"...","subtopics":["..."]}]} — no markdown, no commentary.',
  });
  if (!r.ok) {
    return res.status(502).json({ message: r.status === 429 ? quota429Message(r.detail) : `AI provider error (${r.status}). ${(r.detail || "").slice(0, 160)}` });
  }

  // Tolerant parse: strip code fences, narrow to the outer { ... } object.
  let data = null;
  try {
    let t = String(r.content || "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const a = t.indexOf("{"); const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    data = JSON.parse(t);
  } catch { data = null; }
  if (!data || typeof data !== "object") return res.status(502).json({ message: "Could not read the syllabus structure — try again, or paste cleaner text." });

  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const subject = clean(data.subject).slice(0, 120);
  const seenT = new Set();
  const topics = (Array.isArray(data.topics) ? data.topics : [])
    .map((t) => {
      const title = clean(t?.title).slice(0, 120);
      const seenS = new Set();
      const subtopics = (Array.isArray(t?.subtopics) ? t.subtopics : [])
        .map((s) => clean(s).slice(0, 160))
        .filter((s) => { const k = s.toLowerCase(); if (s.length < 2 || seenS.has(k)) return false; seenS.add(k); return true; })
        .slice(0, 80);
      return { title, subtopics };
    })
    .filter((t) => { const k = t.title.toLowerCase(); if (!t.title || seenT.has(k)) return false; seenT.add(k); return true; })
    .slice(0, 80);

  if (!topics.length) return res.status(502).json({ message: "No topics found in the syllabus — paste more of it, or try again." });
  res.json({ subject, topics });
}

// POST /api/ai/classify-units — given a UNIT list and a set of question stems,
// return which unit each question belongs to (so extracted PDF questions can be
// filed under the right topic). Returns { assign: [unitIndex per question] }
// where unitIndex is 1-based (0 = none/unclear). Batches internally.
export async function classifyUnits(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({ message: scope.mode === "self" ? "No API keys added yet." : "AI is not configured. Add an API key in Admin → AI Keys." });
  }
  const units = (Array.isArray(req.body?.units) ? req.body.units : []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 30);
  const stems = (Array.isArray(req.body?.questions) ? req.body.questions : []).map((s) => String(s?.text || s || "").trim()).filter(Boolean).slice(0, 600);
  if (!units.length || !stems.length) return res.json({ assign: [] });

  const assign = new Array(stems.length).fill(0);
  const BATCH = 60;
  for (let start = 0; start < stems.length; start += BATCH) {
    const batch = stems.slice(start, start + BATCH);
    const prompt = [
      "You are filing exam questions under the correct unit/topic.",
      "UNITS (numbered):",
      units.map((u, i) => `${i + 1}. ${u}`).join("\n"),
      "",
      `QUESTIONS (numbered ${start + 1}..${start + batch.length}):`,
      batch.map((s, i) => `${start + i + 1}. ${s.slice(0, 160)}`).join("\n"),
      "",
      "For EACH question, choose the SINGLE best-matching unit NUMBER. If none fit, use 0.",
      `Return ONLY a JSON array of ${batch.length} integers, in the same order as the questions, e.g. [1,3,2,0,...]. No commentary.`,
    ].join("\n");
    const r = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      userPrompt: prompt,
      maxTokens: 1200,
      owner: scope.owner,
      systemPrompt: "You output ONLY a JSON array of integers — no markdown, no commentary.",
    });
    if (r.ok) {
      const nums = (String(r.content).match(/-?\d+/g) || []).map(Number);
      for (let i = 0; i < batch.length; i++) {
        const n = nums[i];
        assign[start + i] = Number.isInteger(n) && n >= 1 && n <= units.length ? n : 0;
      }
    }
  }
  res.json({ assign });
}

// POST /api/ai/coverage-gaps — given a topic and the stems of questions ALREADY
// made across a set of quizzes, list the syllabus subtopics/areas NOT yet
// Pedagogical ordering for the coverage checklist so "missing areas" read as a
// logical study sequence (foundational first) instead of a random list. Each
// item is ranked by the FIRST syllabus category keyword it contains; unmatched
// concept items sit in the middle. The sort is stable (original order breaks
// ties), so the model's own ordering is preserved within a tier.
const COVERAGE_ORDER = [
  ["introduction", "intro", "overview", "meaning", "definition", "define", "what is", "basics", "fundamental", "concept"],
  ["terminology", "terms", "nomenclature", "notation", "symbol"],
  ["history", "background", "origin", "evolution", "discovery"],
  ["classification", "types", "kinds", "categories", "forms", "classes"],
  ["components", "parts", "structure", "elements", "composition", "anatomy", "constituent"],
  ["properties", "characteristics", "features", "nature", "attribute"],
  ["principle", "laws", "law of", "rules", "theory", "theorem", "postulate", "axiom"],
  ["process", "mechanism", "working", "functioning", "procedure", "method", "steps", "cycle"],
  ["function", "role", "purpose"],
  ["factors", "determinant", "conditions", "requirement"],
  ["causes", "reasons"],
  ["effects", "impact", "consequence", "result", "outcome"],
  ["importance", "significance", "need", "relevance", "advantage", "merit", "benefit", "uses", "application"],
  ["disadvantage", "limitation", "demerit", "drawback", "problem", "challenge", "issue"],
  ["example", "case study", "instance", "illustration"],
  ["comparison", "difference", "versus", "distinguish", "contrast"],
  ["exception", "special case"],
  ["formula", "equation", "numerical", "calculation", "derivation"],
  ["diagram", "map ", "graph", "figure"],
  ["current affairs", "recent", "latest", "modern", "advanced", "future development"],
];
const COVERAGE_DEFAULT_RANK = 7.5; // concept items with no category keyword → middle
function coverageRank(item) {
  const s = String(item || "").toLowerCase();
  for (let r = 0; r < COVERAGE_ORDER.length; r++) if (COVERAGE_ORDER[r].some((k) => s.includes(k))) return r;
  return COVERAGE_DEFAULT_RANK;
}
function orderSyllabus(items) {
  return (Array.isArray(items) ? items : [])
    .map((s, i) => ({ s, i, r: coverageRank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

// covered so the user can generate questions to fill the gaps. Returns
// { topic, coveredCount, missing:[...] }.
export async function coverageGaps(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self" ? "No API keys added yet." : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }
  const topic = String(req.body?.topic || "").trim();
  // SOURCE MATERIAL (PDF / link / pasted text): when provided, the coverage
  // checklist is built from the ACTUAL content of the source — its sections /
  // areas — instead of a general syllabus for a typed topic. This is what powers
  // "areas covered / not covered from THIS pdf".
  let source = String(req.body?.source || "").trim();
  if (source) source = source.slice(0, 24000); // cap material sent to the model
  if (!topic && !source) return res.status(400).json({ message: "A topic or source material is required to scan coverage." });
  const stems = (Array.isArray(req.body?.questions) ? req.body.questions : [])
    .map((s) => String(s?.text || s || "").trim())
    .filter(Boolean)
    .slice(0, 300);
  // A FIXED checklist keeps coverage STABLE: as questions accumulate, items only
  // move from "missing" to "covered" — the total never grows. The caller passes
  // the checklist it got on the first call so later calls classify the SAME
  // list. On the first call (none passed) we build it here.
  let syllabus = (Array.isArray(req.body?.syllabus) ? req.body.syllabus : [])
    .map((s) => String(s || "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2)
    .slice(0, 80);

  const label = topic || "the provided source material";

  // Step 1 — build the checklist once, if the caller doesn't have one yet.
  if (!syllabus.length) {
    const buildPrompt = source
      ? [
          "You are a coverage analyst. Read the SOURCE MATERIAL below and extract a checklist of the distinct topics/areas/sections it actually covers (the things a question could be asked about). Base it ONLY on what is present in this source — do NOT add outside topics. List AS MANY as the source GENUINELY covers and NO MORE — do NOT pad to a fixed number: a short source may yield only 4-6 items, a large one 40 or more. Keep items at a consistent, medium granularity (not hyper-specific single facts). ORDER them as a learner would study them, step by step: foundational items first (introduction, definitions, terminology), then structure/classification, then processes/mechanisms, then causes/effects/factors, then importance/applications, and finally comparisons/exceptions/advanced items.",
          "",
          "SOURCE MATERIAL:",
          source,
          "",
          "Return ONLY a JSON array of strings, e.g. [\"area one\",\"area two\"]. No commentary, no markdown.",
        ].join("\n")
      : [
          "You are a syllabus coverage analyst. Build a checklist of the important, broad, non-overlapping subtopics for the topic below (NCERT / standard university / competitive-exam scope). List AS MANY subtopics as the topic GENUINELY warrants — and NO MORE. Do NOT pad to a fixed number: a small/narrow topic may have only 4-6 subtopics, while a broad one may have 40 or more. Match the topic's real breadth — never invent filler, and never split one idea into near-duplicate items just to reach a count. Keep them at a consistent, medium granularity — NOT hyper-specific niche facts. ORDER them as a learner would study them, step by step: foundational items first (introduction, definitions, terminology), then structure/classification, then processes/mechanisms, then causes/effects/factors, then importance/applications, and finally comparisons/exceptions/advanced items.",
          `Topic: ${topic}.`,
          TOPIC_SCOPE_RULE,
          "Return ONLY a JSON array of strings, e.g. [\"subtopic one\",\"subtopic two\"]. No commentary, no markdown.",
        ].join("\n");
    const rb = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      userPrompt: buildPrompt,
      maxTokens: 1500,
      owner: scope.owner,
      systemPrompt: "You output ONLY a JSON array of short strings — no markdown, no commentary.",
    });
    if (!rb.ok) {
      return res.status(502).json({ message: rb.status === 429 ? quota429Message(rb.detail) : `AI provider error (${rb.status}). ${(rb.detail || "").slice(0, 160)}` });
    }
    syllabus = parseStringArray(rb.content).slice(0, 80);
  }
  if (!syllabus.length) return res.json({ topic: label, coveredCount: stems.length, syllabus: [], covered: [], missing: [] });

  // Order the checklist as a logical study sequence (introduction/definition
  // first → structure → process → causes/effects → importance/applications →
  // comparisons/advanced) so "missing areas" can be tackled step by step. The
  // sort is deterministic, so it stays consistent as the caller passes the
  // fixed checklist back on later calls.
  syllabus = orderSyllabus(syllabus);

  // Step 2 — classify coverage by ITEM NUMBER (robust: no wording match needed).
  // For each numbered checklist item, the model returns whether any question
  // tests it. Nothing to classify when there are no questions yet.
  let coveredIdx = new Set();
  if (stems.length) {
    const classifyPrompt = [
      `Subject: ${label}.`,
      "COVERAGE CHECKLIST (numbered):",
      syllabus.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      "",
      `Question stems already written (${stems.length}):`,
      stems.map((s, i) => `${i + 1}. ${s.slice(0, 140)}`).join("\n"),
      "",
      "For EACH checklist item, decide whether AT LEAST ONE of the questions above tests that area (even partially). Return ONLY a JSON array of the checklist NUMBERS that ARE covered, e.g. [1,3,4,9]. Return [] if none are covered.",
    ].join("\n");
    const rc = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      userPrompt: classifyPrompt,
      maxTokens: 500,
      owner: scope.owner,
      systemPrompt: "You output ONLY a JSON array of integers — no markdown, no commentary.",
    });
    if (rc.ok) {
      const nums = (String(rc.content).match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= syllabus.length);
      coveredIdx = new Set(nums.map((n) => n - 1));
    }
  }
  const covered = syllabus.filter((_, i) => coveredIdx.has(i));
  const missing = syllabus.filter((_, i) => !coveredIdx.has(i));
  res.json({ topic: label, coveredCount: stems.length, syllabus, covered, missing });
}

// POST /api/ai/notes — generate study notes (Markdown text) on a topic.
export async function generateNotes(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }
  const topic = String(req.body?.topic || "").trim();
  if (!topic) return res.status(400).json({ message: "A topic is required." });
  const notes = String(req.body?.notes || "").trim();

  const r = await callWithFallback({
    endpoints: chosen.endpoints,
    model: chosen.model,
    systemPrompt: NOTES_SYSTEM_PROMPT,
    userPrompt: buildNotesPrompt({ topic, notes }),
    maxTokens: 4000,
    owner: scope.owner,
  });
  if (!r.ok) {
    const msg = r.status === 429
      ? "AI quota/rate limit reached. Wait a minute and try again."
      : `AI provider error (${r.status || 0}). ${(r.detail || "").slice(0, 150)}`;
    return res.status(502).json({ message: msg });
  }
  const text = String(r.content || "")
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!text) return res.status(502).json({ message: "The AI did not return any notes. Try a more specific topic." });
  res.json({ notes: text, model: chosen.model });
}


/* --------------------- Visualization Engine (AI → JSON spec) ---------------------
   Turns a natural-language prompt ("create a demand curve", "GDP pie chart") into
   a structured, renderable visualization spec. The frontend Visualization Studio
   renders the spec with Chart.js. Kept intentionally provider-agnostic — reuses
   the same key pool / fallback as the rest of the AI features. */

const VIZ_SYSTEM_PROMPT = `You output ONLY JSON for a data-visualization spec — no markdown, no commentary.
Exact shape:
{"type":"bar","title":"...","description":"...","labels":["A","B"],"series":[{"name":"Series 1","data":[10,20]}],"colors":["#2563eb"],"options":{}}
Rules:
- "type" MUST be one of: bar, groupedbar, stackedbar, horizontalbar, line, spline, step, area, stackedarea, pie, donut, scatter, bubble, radar, polar, histogram. Pick the type that best fits the request (e.g. a share/breakdown → pie or donut; a trend over time → line; a supply & demand or two-curve relationship → line with two series; a distribution → histogram; comparisons across categories → bar).
- "labels": the category/x-axis labels (array of strings). Omit for scatter/bubble.
- "series": array of { "name", "data" }. For category charts (bar/line/pie/…) "data" is an array of NUMBERS aligned to "labels" (pie/donut/polar/radar use ONE series). For "scatter"/"bubble" each series "data" is an array of points {"x":n,"y":n} (bubble adds "r":n).
- "options" may include booleans: stacked, horizontal, smooth (spline curve), stepped, area (fill under line), donut, beginAtZero. Include only when relevant.
- "colors": optional array of hex colours.
- If the user gives no numbers, invent REALISTIC, sensible example data so the chart is meaningful. Keep it small (3-8 points). Keep everything renderable and valid JSON.

SCIENCE/MATH ILLUSTRATIONS: for a Bohr/atomic model return {"type":"bohrmodel","title":"...","science":{"kind":"bohr","symbol":"Na","protons":11,"neutrons":12,"shells":[2,8,1]}} (shells = electrons per shell). For a free-body diagram return {"type":"freebodydiagram","title":"...","science":{"kind":"freebody","label":"Block","forces":[{"label":"Weight","angle":270,"magnitude":60}]}} (angle in degrees, 0=right, 90=up). For an energy level diagram return {"type":"energylevel","title":"...","science":{"kind":"energy","levels":[{"label":"n=1","energy":-13.6}]}}. For a number line return {"type":"numberline","science":{"kind":"numberline","min":-5,"max":5,"step":1,"points":[{"x":2,"label":"A"}]}}. For a coordinate/Cartesian plane with plotted points return {"type":"coordinateplane","science":{"kind":"coordinate","min":-10,"max":10,"points":[{"x":3,"y":4,"label":"P"}],"lines":[{"label":"y=x","points":[{"x":-8,"y":-8},{"x":8,"y":8}]}]}}.

ILLUSTRATIONS (physics/chemistry/biology figures): emit an "illustration" object with a "kind". Wave → {"type":"wave","illustration":{"kind":"wave","amplitude":90,"wavelength":200,"cycles":2}}. Projectile motion → {"type":"projectilemotion","illustration":{"kind":"projectile","angle":45}}. Circuit → {"type":"circuitdiagram","illustration":{"kind":"circuit","components":[{"type":"battery","label":"9V"},{"type":"resistor","label":"R"},{"type":"bulb","label":"Lamp"},{"type":"switch"}]}}. Ray/optics/lens → {"type":"raydiagram","illustration":{"kind":"ray","lens":"convex","focalLength":3,"objectDistance":6,"objectHeight":2}}. Electric field → {"kind":"efield","charges":[{"x":-0.5,"q":1},{"x":0.5,"q":-1}]}. Magnetic field (bar magnet) → {"kind":"bmagnet"}. Molecular structure → {"type":"molecularstructure","illustration":{"kind":"molecule","atoms":[{"el":"O","x":0,"y":0},{"el":"H","x":-1,"y":0.8},{"el":"H","x":1,"y":0.8}],"bonds":[{"a":0,"b":1},{"a":0,"b":2}]}} (x,y are relative layout units; bond order 1/2/3). Reaction energy profile → {"type":"reactiondiagram","illustration":{"kind":"reaction","reactants":40,"products":15,"activationEnergy":60}}. Orbital/electron config boxes → {"kind":"orbital","subshells":[{"label":"1s","electrons":2,"capacity":2},{"label":"2p","electrons":4,"capacity":6}]}. DNA → {"type":"dna","illustration":{"kind":"dna","sequence":"ATGCGATCGT"}}; RNA uses kind "rna". Animal/plant cell → {"type":"animalcell","illustration":{"kind":"cell","type":"animal"}} (type "plant" for plant cell).

MORE ILLUSTRATION KINDS (same "illustration" object): data table (payoff matrix, balance sheet, ledger, trial balance, stem-and-leaf) → {"kind":"table","headers":["","Left","Right"],"rows":[["Up","3, 3","0, 5"],["Down","5, 0","1, 1"]]}. Vector/slope field → {"kind":"field","type":"vector"} or "slope". Mitosis/meiosis → {"kind":"celldivision","process":"mitosis"} (or "meiosis"). Human body systems → {"kind":"humanbody"}. Periodic table (optionally highlight symbols) → {"kind":"periodictable","highlight":["Na","Cl"]}. ORGANIC REACTION MECHANISMS (real 2D structures): emit a "chem" object. Each step gives a SMILES string so the molecule is drawn as an actual skeletal structure. Use type ids reactionmechanism / substitutionmechanism / additionmechanism / eliminationmechanism / rearrangementmechanism. Format: {"type":"additionmechanism","chem":{"title":"Electrophilic Addition: ethene + HBr","steps":[{"smiles":"C=C","label":"ethene"},{"smiles":"C[CH2+]","label":"carbocation","bracket":true,"charge":"+"},{"smiles":"CCBr","label":"bromoethane"}],"arrows":[{"type":"forward","top":"H⁺ (from HBr)"},{"type":"forward","top":"Br⁻ (nucleophile)"}]}}. Rules: steps[].smiles = valid SMILES. IMPORTANT: steps must ONLY contain the main-chain species along the reaction path (reactant → intermediate / transition state → product). Do NOT create separate steps/boxes for reagents, spectator ions, or byproducts (e.g. H₂O, Cl⁻, K⁺, KCl) — those belong on the arrows or in "byproducts". Put reagents on the arrow as a SHORT formula in top (e.g. "KOH", "HBr", "Cl⁻"), not a sentence — never phrases like "Concerted E2 Mechanism" or "Products". Put eliminated/leaving byproducts either in arrow.bottom (short, e.g. "− H₂O") or in a "byproducts" array (["H₂O","KCl"]) shown as "+ H₂O + KCl" after the product. Keep every label under ~16 characters. bracket:true draws square brackets around an intermediate; charge "+"/"-" adds a formal-charge badge; arrows length = steps−1, type "forward" (→) or "equilibrium" (⇌); optional electrons:[{"step":i,"from":[fx,fy],"to":[fx,fy]}] draws a pink curved electron-pushing arrow with coordinates strictly between 0 and 1 within that step's box. The four classic types are substitution, addition, elimination, and rearrangement (e.g. keto–enol tautomerism). To show SEVERAL mechanisms stacked in one figure (e.g. "show all reaction mechanism types together"), use type "combinedmechanisms" and put each mechanism in chem.sections: {"type":"combinedmechanisms","chem":{"overallTitle":"Organic Reaction Mechanisms","sections":[{"title":"Substitution","steps":[...],"arrows":[...]},{"title":"Addition","steps":[...],"arrows":[...]}]}} (each section has the same steps/arrows/electrons shape as a single mechanism). Fishbone/Ishikawa → {"kind":"fishbone","effect":"Problem","causes":[{"category":"People","items":["..."]}]}. Flashcards → {"kind":"flashcards","cards":[{"front":"Q","back":"A"}]}. Kanban/roadmap use a framework grid: {"type":"kanban","framework":{"kind":"grid","cols":3,"cells":[{"title":"To Do","items":["..."]}]}}.

MAPS: if the request is a map, choropleth, or flow map, return {"type":"<map|choropleth|flowmap>","title":"...","map":{"center":[lat,lng],"zoom":4,"markers":[{"lat":N,"lng":N,"label":"...","value":N}],"lines":[{"from":[lat,lng],"to":[lat,lng]}]}}. Use REAL latitude/longitude. For choropleth put a numeric "value" on each marker (0-100); for a flow map add "lines" connecting points.

FRAMEWORKS: if the request is a SWOT, PESTLE, BCG matrix, Porter's Five Forces, Business Model Canvas, value chain, comparison, or cycle diagram, return {"type":"<that>","title":"...","framework":{"kind":"<swot|pestle|bcg|forces|canvas|grid|cycle>","cells":[{"title":"...","items":["...","..."]}]}}. Use the standard cells for the framework (e.g. SWOT → Strengths/Weaknesses/Opportunities/Threats; Porter → the 5 forces with Competitive Rivalry first). Keep 2-5 short items per cell.

GRAPHS & NETWORKS: if the request is a network graph, force-directed graph, tree, binary tree, AVL, heap, trie, linked list, queue, stack, organization chart, decision tree, classification tree, food chain, or food web, return {"type":"<that>","title":"...","graph":{"nodes":[{"id":"A","label":"A"}],"edges":[{"source":"A","target":"B","label":""}],"layout":"breadthfirst","directed":true}}. Use "breadthfirst" for trees/hierarchies, "cose" for networks/webs, "grid" for lists/chains. Keep it to ~4-12 nodes. (A network topology may instead use a "network" object: {"type":"networkdiagram","network":{"layout":"star|mesh|ring|bus|tree","nodes":[{"id":"SW1","type":"switch","label":"Switch","x":300,"y":200}],"connections":[{"from":"SW1","to":"PC1"}]}} — from/to map to edges, optional x/y position the nodes, and node "type" (switch/router/server/firewall/cloud/pc) colours them.)

ADVANCED CHARTS (Plotly): if the request is a heatmap, boxplot, violinplot, sankey, treemap, sunburst, candlestick, ohlc, gauge, funnel, waterfall, 3dsurface, contourplot, correlationmatrix, or scattermatrix, return {"type":"<that>","title":"...","plotly":{"data":[<valid Plotly trace objects>],"layout":{}}} — a real Plotly figure (e.g. heatmap → [{"z":[[..]],"x":[..],"y":[..],"type":"heatmap"}]; sankey → [{"type":"sankey","node":{"label":[..]},"link":{"source":[..],"target":[..],"value":[..]}}]; gauge → [{"type":"indicator","mode":"gauge+number","value":N,"gauge":{"axis":{"range":[0,100]}}}]). Use small, realistic data.

FUNCTIONS, CURVES & DISTRIBUTIONS: for a mathematical function (quadratic, exponential, log, trig, polynomial, derivative, integral…), a statistics distribution (normal, binomial, Poisson…), a regression, or an economics curve (supply/demand, PPF, IS-LM, AD-AS, cost/revenue curves, Lorenz, Laffer, Phillips, indifference, budget line…), use "type":"line" (or "scatter" for point clouds / regression). COMPUTE real numeric data across a sensible range and put x-values in "labels" (line) and y-values in each series' "data". Use MULTIPLE series for multiple curves (e.g. Demand & Supply, IS & LM, function & its derivative). For a regression, use "scatter" with a data series plus a second series {"name":"Trend","line":true,"data":[{"x":..,"y":..}]}. Set options.smooth=true for smooth curves. Prefer 6-20 computed points.

DIAGRAM TYPES (structure, not data): if the request is a flowchart, algorithmflow, activitydiagram, processdiagram, mindmap, conceptmap, learningtree, sequencediagram, classdiagram, uml, statediagram, erdiagram, gantt, timeline, or customerjourney, DO NOT use labels/series. Instead return {"type":"<one of those>","title":"...","code":"<VALID Mermaid code>"} where "code" is correct Mermaid syntax for that diagram (e.g. flowchart → "flowchart TD\\n A[..]-->B[..]"; mindmap → "mindmap\\n root((..))\\n  Child"; sequencediagram → "sequenceDiagram\\n A->>B: msg"; classdiagram/uml → "classDiagram\\n class X{..}"; statediagram → "stateDiagram-v2\\n [*]-->S"; erdiagram → "erDiagram\\n A ||--o{ B : rel"; gantt → "gantt\\n title ..\\n dateFormat YYYY-MM-DD\\n section S\\n Task :2024-01-01, 10d"; customerjourney → "journey\\n title ..\\n section S\\n Step: 3: Actor"). Use real line breaks in the code. Keep the diagram small and valid.`;

// Tolerant JSON extraction for the viz spec (handles code fences / stray text).
function parseVizSpec(content) {
  let t = String(content || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(t);
  if (!obj) {
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s !== -1 && e > s) obj = tryParse(t.slice(s, e + 1)) || tryParse(repairJson(t.slice(s, e + 1)));
  }
  return obj && typeof obj === "object" ? obj : null;
}

// POST /api/ai/visualize — body: { prompt, model?, mode? } → { spec, model }.
export async function visualizeSpec(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self" ? "No API keys added yet. Add at least one key in the AI tab." : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ message: "Describe the visualization you want." });

  const r = await callWithFallback({
    endpoints: chosen.endpoints,
    model: chosen.model,
    systemPrompt: VIZ_SYSTEM_PROMPT,
    userPrompt: `Create a visualization for this request: ${prompt}\nReturn ONLY the JSON spec.`,
    maxTokens: 2000,
    owner: scope.owner,
  });
  if (!r.ok) {
    const msg = r.status === 429
      ? "AI quota/rate limit reached. Wait a minute and try again."
      : `AI provider error (${r.status || 0}). ${(r.detail || "").slice(0, 150)}`;
    return res.status(502).json({ message: msg });
  }
  const spec = parseVizSpec(r.content);
  if (!spec || !spec.type) {
    return res.status(502).json({ message: "The AI did not return a usable visualization. Try rephrasing the request." });
  }
  res.json({ spec, model: chosen.model });
}


/* --------------------- Extend explanations (bulk, in place) ---------------------
   Rewrites the explanation + per-option notes of EVERY question in one quiz or
   test — without changing the question, options or correct answer. Runs as a
   background job (reuses genJobs/jobStatus) so big quizzes don't time out. */

const EXTEND_SYSTEM_PROMPT = `You are an expert exam teacher. You are given ONE existing exam question (its stem, options, the CORRECT option, its type, and any columns/assertion/reason). Your ONLY job is to write a richer, clearer EXPLANATION and per-option notes for it.

CRITICAL — you MUST ALWAYS respond, for EVERY question, with ONE single valid JSON object and NOTHING else: no markdown, no code fences, no text before or after. The exact shape is:
{"explanation":"...","optionExplanations":["","","",""]}
(Whenever you determine the stored answer is WRONG — whether it is a numerical, a FACTUAL/conceptual, or a count-based question — ALSO include "correct":<0-3>, and, if the true answer is not among the current options, "options":["A","B","C","D"] — see the verification rules below.)
JSON VALIDITY RULES (follow exactly or the answer is discarded):
- Escape any double quote inside a string as \\". You MAY use normal line breaks inside the strings for readability.
- MATH: write ALL mathematical/numeric content (equations, fractions, powers, roots, ratios, %) as inline LaTeX between single dollar signs — e.g. $x^2+2x-3=0$, $\\frac{3}{4}$, $2^{10}\\times5^{8}$, $\\sqrt{2}$. This ALSO includes every numeric ANSWER value in "optionExplanations" and any option value you return — wrap numbers/expressions in $...$ so they render as math (e.g. "$12.5$", "$\\frac{180}{13}$", "$25\\%$"). Do NOT use \\( \\) or \\[ \\] delimiters and do NOT write bare LaTeX outside dollar signs.
- CURRENCY: NEVER use the "$" character for money or amounts — "$" is RESERVED solely for opening/closing math, and a stray "$" (e.g. "$300") corrupts the rendering of the ENTIRE explanation. Write money as a plain number with the currency word AFTER it, e.g. "300 dollars", "900 rupees", or just "300". The only "$" characters allowed are the matched pairs that wrap math.
- Do NOT use markdown (no **bold**, no bullet characters), no code fences, no trailing commas.
- Never refuse and never return an empty object — always produce a full explanation.

Content rules:
- "explanation": a THOROUGH, self-contained explanation of the correct answer (3-6 sentences). Include EVERY relevant supporting fact — exact dates/years, historical background, definitions, full formulas WITH the actual calculation, laws/theorems/principles by name, and cause-and-effect reasoning. Teach the concept as if to someone seeing it for the first time; never just restate the option. Put each sentence or distinct point on its OWN line (a real line break between points), not one long paragraph. SCOPE BY TYPE: for a plain "mcq", explain ONLY the correct option — do NOT mention or justify the incorrect options in the explanation. For every OTHER type (matching, statement, pair, pairselect, assertion, table), the explanation MUST go through each pairing / statement / sub-option and the assertion–reason relationship (correct and incorrect) in detail.
- LAWS / BILLS / ACTS / AMENDMENTS & DATES: when the question or its answer concerns a law/bill/act/amendment/ordinance/scheme/treaty/appointment/report/event, the explanation MUST use its EXACT date (day, month and year of introduction/passage/enactment/coming into force) — NOT the year alone — and state only facts about the REAL, verifiable item. If the exact date or provisions of a very recent item are not reliably known, do NOT fabricate a date/number/provision; explain the established, verifiable facts instead.
- LOCAL / ALTERNATIVE NAMES: whenever a term/place/concept/person/disease/chemical/unit/law has a common local or vernacular (Hindi/regional) name, synonym, abbreviation's full form or old name, add it in brackets right after it.
- "optionExplanations": a real JSON array of EXACTLY 4 SEPARATE strings, in the same order as the options (entry 0 = option A, 1 = B, 2 = C, 3 = D). For EACH option state clearly whether it is correct or incorrect and WHY (for a wrong numeric option, show what mistake produces that value). This applies to EVERY type INCLUDING plain "mcq" — for an mcq each incorrect option MUST still get its own note here even though the "explanation" box stays focused only on the correct option. Keep each to 1-2 short sentences; do NOT prefix an entry with a label such as "A)", "(A)", "A." or "Option A", and do NOT put more than one option's note inside a single entry; leave the truly-CORRECT option's entry an empty string "".
- CALCULATION-BASED questions: if the question is answered by CALCULATION (arithmetic, applying a formula, or solving an equation), ALSO include "numerical":true and leave ALL FOUR "optionExplanations" as empty strings "" — the step-by-step working in "explanation" is the full justification, so do NOT write any per-option "why it's wrong" notes.
VERIFY THE ANSWER — do this for EVERY question, not only calculations: work out the correct answer yourself FIRST, then compare it with the option currently marked correct before writing the notes.
FACTUAL / CONCEPTUAL QUESTIONS (dates, years, names, places, capitals, definitions, discoveries, science & general-knowledge facts, etc.):
- Recall the ACTUAL established fact and decide which option is truly correct.
- If the option marked correct is factually WRONG and the right answer IS one of the four options, return the corrected 0-based "correct" index (0=A,1=B,2=C,3=D), and in "explanation" state plainly why the previously-marked option is wrong and which option is right.
- If NONE of the four options states the correct fact, return a corrected "options" array of EXACTLY 4 that INCLUDES the true answer (keep the other three as plausible, same-category distractors) and set "correct" to its index.
- CONFIDENCE GUARD: correct the answer ONLY when you are genuinely certain of the fact (a well-established, verifiable fact). If you are unsure or it is debatable, leave "correct"/"options" unchanged and simply explain the intended answer — never guess a "correction".
NUMERICAL / QUANTITATIVE QUESTIONS — you MUST verify by SOLVING, not just describe:
- Solve the problem yourself from scratch. In "explanation" show the working STEP BY STEP: state the formula, substitute the actual values, and show each intermediate result on its OWN line, ending with the final computed value. Every arithmetic step must be correct and lead exactly to the answer you choose.
- Compare your computed value with the four options and decide which option is TRULY correct.
- If your verified correct option DIFFERS from the given CORRECT answer, the stored answer is wrong — return the corrected 0-based index as "correct" (0=A, 1=B, 2=C, 3=D).
- If the correct value is NOT present among the options (or an option's value is numerically wrong), return a corrected "options" array of EXACTLY 4 values that INCLUDES your computed correct value, keep the other three as plausible distractors in the same style/units, and set "correct" to the index of the right value.
- Re-check your arithmetic before responding; the steps shown in "explanation" must match the option you mark correct.
MATCHING / PAIR / STATEMENT questions ("match the columns", "how many pairs are correctly matched", "which statements are correct"):
- Evaluate EACH pair / statement / match INDIVIDUALLY in the explanation: say whether it is correctly matched or true, and if not, give the CORRECT match/characteristic. (Item i in Column A pairs with item i in Column B.)
- Then COUNT how many are correct and choose the option that states that exact count/combination.
- If your verified count/combination DIFFERS from the marked answer, return the corrected "correct" index.
- If NO option matches the true answer (e.g. ZERO pairs are correctly matched but there is no "None" option), return a corrected "options" array of EXACTLY 4 that INCLUDES the right choice (e.g. "None of the pairs are correctly matched") and set "correct" to its index.
STRICT: Do NOT change the question's wording or meaning, and do NOT invent a different question. You MAY fix the "correct" index and option VALUES ONLY when your explicit verification — a step-by-step calculation, a pair-by-pair / statement-by-statement check, OR a confident recall of a well-established fact — proves the stored answer is wrong; if you are not certain, omit "correct"/"options" and leave them unchanged. Return ONLY the JSON object.`;

// Dedicated, FORCEFUL prompt for "extend + fix options". Unlike the conservative
// EXTEND prompt, this one is explicitly told to REWRITE off-category distractors
// so all four options match the correct answer's category — while keeping the
// stem and the correct answer unchanged.
const EXTEND_FIXOPTS_SYSTEM_PROMPT = `You are an expert exam editor. You are given ONE multiple-choice question: its stem, its four current options, and WHICH option is the CORRECT answer. You have TWO jobs and you MUST do both:

1) FIX THE OPTIONS so all four belong to the SAME real-world category/type as the correct answer — WITHOUT changing the stem or which answer is correct.
2) Write a rich, correct EXPLANATION and per-option notes.

Respond with ONE valid JSON object and NOTHING else (no markdown, no code fences):
{"options":["A","B","C","D"],"correct":<0-3>,"explanation":"...","optionExplanations":["","","",""]}

OPTIONS — MANDATORY, this is the main task:
- First identify the CATEGORY of the correct answer (e.g. is it a BIRD? a tree? a person? a river? a disease? a language name?).
- Keep the CORRECT option's text EXACTLY as given. Do NOT change it and do NOT change which answer is correct.
- Look at the OTHER three options. REPLACE every option that is NOT the same category as the correct answer with a REAL, well-known member of that SAME category that a student could genuinely confuse with the correct answer. Example: for "the Dogri name of the Kalij PHEASANT (a bird)", every option MUST be a BIRD name — replace a deer (Hangul), a tree (Booune) or a flower (Pamposh) with real bird names. Match the same language/naming style (e.g. local Dogri/Kashmiri/Hindi names), length and form.
- After your fix, ALL FOUR options must be plausible members of the one category. NEVER leave an off-category, unrelated or joke option, and never make a distractor an obvious give-away.
- "correct": the 0-based index (0-3) of the correct option in the "options" array you return (it must still point to the original correct answer's text).

EXPLANATION — "explanation": thorough and self-contained; since this prompt is only for plain MCQs, the explanation box must teach ONLY the correct option and NOT discuss the incorrect options; put each point on its OWN line; add local/alternative names in brackets. "optionExplanations": a real JSON array of EXACTLY 4 SEPARATE notes, one per option in order (0=A,1=B,2=C,3=D) — for each WRONG option say why it is incorrect (name the misconception); do NOT prefix entries with labels like "A)"/"Option A" and do NOT pack multiple options into one entry; leave the correct option's entry "". For CALCULATION-based questions ALSO include "numerical":true and leave ALL FOUR "optionExplanations" empty "" (the working in "explanation" is enough). MATH: wrap any math/number in $...$ (never \\( \\) or \\[ \\]); NEVER use "$" for money. No markdown, no trailing commas. Return ONLY the JSON object.`;

const EXT_LETTERS = ["A", "B", "C", "D"];
const toRomanLite = (n) => { const m = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]]; let r = ""; for (const [s, v] of m) while (n >= v) { r += s; n -= v; } return r; };

function buildExtendPrompt(q, notes, fixOptions = false, extendQuestion = false) {
  const lines = [`Question type: ${q.type || "mcq"}`];
  if (q.text) lines.push(`Question: ${q.text}`);
  if (q.assertion) lines.push(`Assertion (A): ${q.assertion}`);
  if (q.reason) lines.push(`Reason (R): ${q.reason}`);
  if (Array.isArray(q.columnA) && q.columnA.length) lines.push(`Column A: ${q.columnA.map((x, i) => `${i + 1}. ${x}`).join("  |  ")}`);
  if (Array.isArray(q.columnB) && q.columnB.length) lines.push(`Column B: ${q.columnB.map((x, i) => `${toRomanLite(i + 1)}. ${x}`).join("  |  ")}`);
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length) lines.push(`Options:\n${opts.map((o, i) => `${EXT_LETTERS[i] || i}) ${o}`).join("\n")}`);
  if (typeof q.correct === "number" && opts[q.correct] != null) lines.push(`CORRECT answer: ${EXT_LETTERS[q.correct]}) ${opts[q.correct]}`);
  if (q.explanation) lines.push(`Existing explanation (improve and expand it — keep anything correct): ${q.explanation}`);
  if (notes) lines.push(`MANDATORY user instructions (follow EXACTLY): ${notes}`);
  lines.push(`Write a THOROUGH "explanation". For a plain mcq, the "explanation" box must explain ONLY the correct option (do NOT discuss the incorrect options in it), but STILL fill each of the 4 "optionExplanations" with why that option is right or wrong (leaving the correct option's entry ""). For every OTHER type (matching, statement, pair, pairselect, assertion, table, journal), the "explanation" walks through all options AND fill each of the 4 "optionExplanations" — state whether each option is correct or wrong and why — leaving the correct option's entry "" (for journal, name the accounts debited & credited, their classification and the rule applied, and confirm debit total = credit total). If this is a numerical/quantitative question, SOLVE it yourself step by step — put each calculation step on its own line in the explanation — then check which option is truly correct. If this is a matching / "how many pairs are correctly matched" / statement question, evaluate EACH pair or statement one by one and COUNT the correct ones. If this is a plain FACTUAL/knowledge question, recall the actual established fact and decide which option is truly correct. In EVERY case, if the marked CORRECT answer is wrong, return the corrected "correct" index (0-3); if a value/fact is wrong or no option matches the true answer (e.g. zero pairs match but there is no "None" option, or the correct fact is not listed), return a fixed "options" array of 4 that includes the right choice. Only make such a correction when you are genuinely confident it is wrong; if unsure, leave the answer as-is and just explain. Do NOT change the question's wording. Write any math as inline LaTeX between $...$ (never \\( \\) or \\[ \\]). If the question is CALCULATION-based, set "numerical": true and leave all four "optionExplanations" empty "" (the step-by-step working in the explanation is enough — no per-option notes). Return ONLY one valid JSON object.`);
  if (q.type === "assertion") {
    lines.push(`ENSURE THE DEDICATED ASSERTION–REASON FORMAT: return a NON-EMPTY "assertion" (the full Assertion A sentence) and a NON-EMPTY "reason" (the full Reason R sentence) as SEPARATE fields — if A and/or R are currently packed into the stem, the options, or written inline as "Assertion (A): … Reason (R): …", SPLIT them out into these two fields. Keep "text" as ONLY the short intro line with NO A/R copy inside it. The 4 "options" MUST remain EXACTLY the four standard choices in this order: "Both A and R are true and R is the correct explanation of A", "Both A and R are true but R is NOT the correct explanation of A", "A is true but R is false", "A is false but R is true"; keep the same correct answer unless it is genuinely wrong, in which case return the corrected 0-based "correct" index.`);
  }
  if (fixOptions && (!q.type || q.type === "mcq" || q.type === "journal")) {
    lines.push(`ALSO FIX THE OPTIONS (do this in addition): keep the question stem and the CORRECT option EXACTLY as given, but make sure all four options belong to the SAME real-world category/type as the correct answer${q.type === "journal" ? " — for a journal question every option must be a COMPLETE, BALANCED journal entry / ledger posting in the standard \"Account A/c Dr. amount // To Account A/c amount\" format (debit total = credit total), amounts as plain numbers (no \"$\"), and the wrong ones must be classic accounting mistakes (reversed Dr/Cr, wrong account, wrong classification)" : ""}. If any option is off-category, unrelated or an obvious give-away (for example a bird or a flower listed among tree names), REPLACE only those wrong options with real, closely-related same-category distractors that match their language, form, length and specificity. Return the full corrected "options" array of EXACTLY 4 (the correct option's text unchanged) plus the 0-based "correct" index for it. Do NOT change the stem or which answer is correct.`);
  }
  if (extendQuestion) {
    lines.push(`ALSO EXTEND THE QUESTION LENGTH (this OVERRIDES the "do not change the wording" rule for the STEM ONLY): rewrite the question stem into a slightly LONGER, clearer, more descriptive version and return it as "text". ONLY EXTEND QUESTIONS THAT GENUINELY NEED IT — this is critical. Many stems are ALREADY clear, complete and self-contained and must be LEFT EXACTLY AS-IS (return the original "text" unchanged, do NOT reword or pad them): e.g. "What is the full form of NABARD?", "What is the SI unit of force?", "Who wrote …?", "In which year …?", "The capital of … is?", a simple definition, or any one-fact recall that already reads as a proper question. Extend a stem that is a bare fragment, label or too terse to read as a real question, by turning it into a proper full sentence. DECISIVE STRUCTURAL RULE: if the stem ENDS WITH A COLON (":") or is just a phrase/label that is NOT itself a complete question sentence — e.g. "Like magnetic poles:", "Lateral means:", "Newton's second law:", "Photosynthesis?" — you MUST rewrite it into a complete question; this is exactly the case that needs extending, so NEVER return a colon-ended or fragment stem unchanged. Conversely, if the stem is ALREADY a complete question sentence (it reads as a full question on its own), leave it EXACTLY as-is. Apply this structural test instead of guessing; only leave a stem unchanged when it is genuinely already a complete question. STRICT LENGTH LIMIT (when you do extend): the rewritten stem must be SHORT — AT MOST 3 lines, i.e. no more than 2 sentences / about 40 words. Do NOT expand it into a paragraph; brevity matters more than extra detail — stop as soon as it is a clear, full-sentence question, and never exceed 3 lines. You MUST keep the EXACT SAME meaning, the same thing being asked, the same options and the same correct answer — only make the phrasing fuller by adding a little neutral framing/context and turning a bare label like "Lateral means:" into a proper full sentence such as "In anatomical terminology, the directional term 'lateral' refers to which of the following?". CRITICAL — DO NOT lengthen by adding full forms or units: NEVER spell out an abbreviation/acronym into its full form and NEVER add an SI unit or any unit of measurement in the stem. Keep every acronym, abbreviation, symbol and term EXACTLY as written (e.g. keep "NABARD", "DNA", "GDP", "N", "kg" as-is) — expanding them can reveal the answer or change the question. Do NOT make the question harder, do NOT change the topic, do NOT add or reveal the answer, and do NOT turn it into a different question. Keep any real math/values wrapped in $...$ but never wrap ordinary words in $...$. For matching/assertion/statement/table questions, extend ONLY the intro sentence in "text" (still within the 3-line limit) and leave the columns/assertion/reason/table untouched.`);
  }
  return lines.join("\n");
}

// Escape RAW control chars (real newlines/tabs) that appear INSIDE JSON string
// literals — the #1 reason a model's JSON fails to parse, since we ask for
// multi-line explanations and models often press Enter instead of writing \\n.
function escapeRawControlCharsInStrings(t) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\") { out += c; esc = true; continue; }
      if (c === '"') { out += c; inStr = false; continue; }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
    } else {
      out += c;
      if (c === '"') inStr = true;
    }
  }
  return out;
}

// Models very often emit LaTeX with SINGLE backslashes inside JSON strings —
// e.g. they write "\frac" / "\times" / "\text" instead of the JSON-legal
// "\\frac". JSON.parse then interprets "\f"→form-feed, "\t"→tab, "\b"→backspace,
// silently DESTROYING the command ("\frac"→"<FF>rac", "\times"→"<TAB>imes",
// "\text"→"<TAB>ext"). This is the #1 cause of garbled math in explanations.
//
// We repair it BEFORE parsing: inside every JSON string literal, DOUBLE any
// backslash that begins a LaTeX command (backslash + letter, or backslash + a
// LaTeX symbol such as %, {, }, ^, _), while leaving genuine JSON escapes
// (\" \\ \/ \uXXXX, and control escapes \b\f\n\r\t NOT followed by a letter)
// untouched. Runs before escapeRawControlCharsInStrings.
function escapeLatexBackslashes(t) {
  const s = String(t || "");
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      out += c;
      if (c === '"') inStr = true;
      continue;
    }
    if (c !== "\\") {
      out += c;
      if (c === '"') inStr = false;
      continue;
    }
    // Backslash inside a string literal — decide keep vs. double.
    const n = s[i + 1];
    if (n === undefined) { out += "\\\\"; continue; }
    // Genuine JSON escapes that must stay as-is.
    if (n === '"' || n === "\\" || n === "/") { out += "\\" + n; i += 1; continue; }
    // \uXXXX unicode escape — only when followed by exactly 4 hex digits.
    if (n === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += "\\u"; i += 1; continue; }
    // \b \f \n \r \t: a real control escape ONLY when NOT followed by a letter.
    // Followed by a letter it is really a LaTeX command (\beta, \frac, \nu,
    // \rho, \text, \times) whose first char collides with a JSON escape char.
    if ("bfnrt".includes(n) && !/[a-zA-Z]/.test(s[i + 2] || "")) { out += "\\" + n; i += 1; continue; }
    // Everything else is a LaTeX backslash → double it so JSON.parse yields a
    // single literal backslash. Leave the next char for the normal loop.
    out += "\\\\";
  }
  return out;
}

// Apply both JSON repairs (LaTeX backslashes, then raw control chars).
const repairJson = (t) => escapeRawControlCharsInStrings(escapeLatexBackslashes(t));

// Even when JSON.parse SUCCEEDS, single-backslash LaTeX (\rightarrow, \times,
// \frac, \beta, …) is silently turned into a raw control char that ate the
// backslash + first letter (\rightarrow → CR+"ightarrow", \times → TAB+"imes",
// \frac → FORMFEED+"rac", \beta → BACKSPACE+"eta"). Those control chars are
// never legitimate content, so revive them back into the LaTeX command. A real
// newline (\n) is a genuine line break and is left untouched. Then render arrows
// as a Unicode "→" so they show even in prose sequences (not only inside $…$).
function reviveLatex(s) {
  if (typeof s !== "string") return s;
  let out = s;
  if (/[\u0008\f\r\t]/.test(out)) {
    out = out
      .replace(/\r/g, "\\r")       // \rho, \rightarrow, \rangle …
      .replace(/\t/g, "\\t")       // \times, \text, \tau, \theta, \to …
      .replace(/\f/g, "\\f")       // \frac, \forall, \flat …
      .replace(/\u0008/g, "\\b");  // \beta, \bar, \binom …
  }
  out = out
    .replace(/\\(?:longrightarrow|Rightarrow|rightarrow|to)(?![a-zA-Z])/g, "→")
    .replace(/\\(?:longleftarrow|Leftarrow|leftarrow)(?![a-zA-Z])/g, "←")
    .replace(/\\(?:leftrightarrow|Leftrightarrow)(?![a-zA-Z])/g, "↔");
  return out;
}
// Walk any parsed value and revive LaTeX in every string.
function deepReviveLatex(v) {
  if (typeof v === "string") return reviveLatex(v);
  if (Array.isArray(v)) return v.map(deepReviveLatex);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepReviveLatex(v[k]);
    return out;
  }
  return v;
}

// Last resort: pull the "explanation" (and optionExplanations) out with regex,
// even from broken or truncated JSON.
function salvageExplanation(t) {
  // Prefer a fully-terminated explanation string; if the reply was truncated
  // mid-explanation (no closing quote), grab everything after the key so a long
  // answer that ran past the token limit is still recovered.
  let m = t.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) m = t.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  if (!m) return null;
  let explanation = "";
  try { explanation = JSON.parse(`"${m[1]}"`); } catch { explanation = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'); }
  explanation = String(explanation).trim();
  if (!explanation) return null;
  let oe = null;
  const am = t.match(/"optionExplanations"\s*:\s*\[([\s\S]*?)\]/);
  if (am) { try { oe = JSON.parse(`[${am[1]}]`).map((x) => (x == null ? "" : String(x))); } catch { oe = null; } }
  return { explanation, optionExplanations: oe };
}

// The model sometimes returns the per-option notes malformed: ALL four packed
// into the first array slot (renders as a blob under option A, nothing on the
// rest), or each note prefixed with an "A)" / "(B)" / "Option C" label — which
// leaves the correct option showing a bare stray label like "B)". Normalize into
// a clean 4-slot array: re-split a packed blob by its option labels, and strip a
// leading enumerator from each per-option note. Leaves already-correct arrays
// untouched.
function normalizeOptionNotes(rawOe) {
  const arr = (Array.isArray(rawOe) ? rawOe : []).map((x) => (x == null ? "" : String(x)));
  while (arr.length < 4) arr.push("");
  const trimmed = arr.slice(0, 4).map((s) => s.trim());
  const filled = trimmed.filter(Boolean).length;
  const joined = trimmed.filter(Boolean).join("\n");

  // Find option labels at a line start: "Option A", "(A)", "A)", "A.", "A:", "A-".
  const findRe = /(?:^|\n)[\t ]*(?:option[\t ]+([A-Da-d])\b|\(([A-Da-d])\)|([A-Da-d])[\).:\u2013-])/gi;
  const labels = [];
  let m;
  while ((m = findRe.exec(joined)) !== null) {
    labels.push({
      labelStart: m.index + (/^\n/.test(m[0]) ? 1 : 0),
      afterLabel: findRe.lastIndex,
      letter: (m[1] || m[2] || m[3] || "").toUpperCase(),
      kind: m[1] ? "word" : "enum", // "Option A" keeps the words; "A)" is dropped
    });
  }
  const distinct = new Set(labels.map((l) => l.letter));

  // Packed into one slot but clearly labelled for 2+ options → re-split by label.
  if (filled <= 1 && distinct.size >= 2) {
    const bucket = { A: "", B: "", C: "", D: "" };
    for (let i = 0; i < labels.length; i++) {
      const from = labels[i].kind === "word" ? labels[i].labelStart : labels[i].afterLabel;
      const to = i + 1 < labels.length ? labels[i + 1].labelStart : undefined;
      const seg = joined.slice(from, to).trim();
      if (seg) bucket[labels[i].letter] = seg;
    }
    return [bucket.A, bucket.B, bucket.C, bucket.D];
  }
  // Otherwise per-slot already — just strip a leading enumerator ("A)", "(B)", "C.").
  const out = trimmed.map((s) => s.replace(/^\s*(?:\([A-Da-d]\)|[A-Da-d][\).:\u2013-])\s*/, "").trim());
  while (out.length < 4) out.push("");
  return out.slice(0, 4);
}

// Robustly pull { explanation, optionExplanations } from the model's text.
function parseExplanationJson(content) {
  let t = String(content || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Narrow to the outermost object if there's stray text around it.
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  const slice = s !== -1 && e > s ? t.slice(s, e + 1) : t;

  let obj = null;
  for (const candidate of [t, slice, repairJson(t), repairJson(slice)]) {
    try { obj = JSON.parse(candidate); break; } catch { /* try next */ }
  }
  if (obj) obj = deepReviveLatex(obj); // fix \rightarrow/\times/\frac corrupted into control chars

  if (obj && typeof obj === "object") {
    const explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : "";
    let oe = Array.isArray(obj.optionExplanations)
      ? obj.optionExplanations.map((x) => (x == null ? "" : String(x)))
      : typeof obj.optionExplanations === "string"
        ? [obj.optionExplanations] // a single blob string — normalizeOptionNotes will split it
        : null;
    if (oe) oe = normalizeOptionNotes(oe); // split packed blobs / strip "A)" labels; pads to 4
    // Optional numerical-correction fields: a corrected 0-based answer index and
    // a corrected 4-option array (only present when the AI's working proves the
    // stored answer wrong). Accept a number, a "0".."3" string, or a letter A-D.
    let correct = null;
    const rc = obj.correct;
    if (typeof rc === "number" && Number.isInteger(rc)) correct = rc;
    else if (typeof rc === "string" && /^[0-3]$/.test(rc.trim())) correct = parseInt(rc.trim(), 10);
    else if (typeof rc === "string" && /^[A-Da-d]$/.test(rc.trim())) correct = rc.trim().toUpperCase().charCodeAt(0) - 65;
    if (correct != null && (correct < 0 || correct > 3)) correct = null;
    const options = Array.isArray(obj.options) && obj.options.length === 4
      ? obj.options.map((x) => (x == null ? "" : String(x)))
      : null;
    // Optional re-wrapped stem/columns (used by Regenerate to fix math rendering
    // in the question itself — same meaning, math wrapped in $...$). Extend
    // ignores these.
    const text = typeof obj.text === "string" && obj.text.trim() ? obj.text.trim() : null;
    const columnA = Array.isArray(obj.columnA) ? obj.columnA.map((x) => (x == null ? "" : String(x))) : null;
    const columnB = Array.isArray(obj.columnB) ? obj.columnB.map((x) => (x == null ? "" : String(x))) : null;
    const tableRows = Array.isArray(obj.tableRows) && obj.tableRows.every((r) => Array.isArray(r))
      ? obj.tableRows.map((r) => r.map((c) => (c == null ? "" : String(c))))
      : null;
    // For PAIR questions: one short "why they match" reason per aligned pair,
    // used to build the explanation after the backend reshuffles Column B.
    const pairFacts = Array.isArray(obj.pairFacts) ? obj.pairFacts.map((x) => (x == null ? "" : String(x))) : null;
    // Calculation-based flag — when true, callers drop the per-option notes.
    const numerical = obj.numerical === true || obj.numerical === "true";
    if (explanation || oe || options || text || tableRows) return { explanation, optionExplanations: oe, correct, options, text, columnA, columnB, tableRows, pairFacts, numerical };
  }

  // Couldn't parse as JSON at all — salvage the explanation with regex (from the
  // backslash-repaired text so single-backslash LaTeX survives the salvage too).
  const salvaged = salvageExplanation(repairJson(t));
  return salvaged ? deepReviveLatex(salvaged) : salvaged;
}

// Randomly REORDER a question's answer options while keeping the SAME correct
// answer — moves the `correct` index and reorders `optionExplanations` to follow
// their options, so the answer's POSITION changes but nothing becomes wrong.
// Used by Extend when the caller ticks "Reshuffle options" (e.g. so the right
// answer isn't always option B, or after two quizzes end up in the same order).
// Skips assertion (its four options are a fixed A/R rubric whose order carries
// meaning) and anything with fewer than 2 options. Works on the EFFECTIVE
// options — a freshly fixed set from the AI if present, otherwise the stored
// ones — so it composes correctly with "fix options"/numerical corrections.
function applyOptionShuffle(set, q) {
  if (q.type === "assertion") return; // fixed rubric — order is meaningful
  // Shuffle the options we're actually going to store, and track the correct
  // index that MATCHES that same array. IMPORTANT: when we're reordering the
  // ORIGINAL options (the model didn't return a fixed options array), anchor to
  // the ORIGINAL correct answer (q.correct) — NOT any `correct` the model may
  // have returned, which can be relative to a different order and would move
  // the answer to the wrong option (e.g. B → C). This guarantees a reshuffle
  // never changes WHICH option is correct.
  const usingSet = Array.isArray(set.options) && set.options.length;
  const options = (usingSet ? set.options : (Array.isArray(q.options) ? q.options : [])).map((x) => String(x));
  const n = options.length;
  if (n < 2) return;
  const correct = usingSet
    ? (Number.isInteger(set.correct) ? set.correct : (Number.isInteger(q.correct) ? q.correct : null))
    : (Number.isInteger(q.correct) ? q.correct : null);
  const oe = Array.isArray(set.optionExplanations) ? set.optionExplanations.slice()
    : (Array.isArray(q.optionExplanations) ? q.optionExplanations.slice() : null);
  // A genuinely RANDOM permutation (not identity, not a simple rotation) that
  // moves the correct answer to a random new slot; perm[newIndex] = oldIndex.
  const perm = shuffledPermutation(n, (correct != null && correct >= 0 && correct < n) ? correct : null);
  set.options = perm.map((p) => options[p]);
  if (correct != null && correct >= 0 && correct < n) set.correct = perm.indexOf(correct);
  if (oe) { while (oe.length < n) oe.push(""); set.optionExplanations = perm.map((p) => oe[p] ?? ""); }
}

// Build the Mongo $set for an extended question. Always updates the explanation
// (+ per-option notes). For NUMERICAL corrections, when the AI returned a valid
// corrected answer index it also updates `correct`; option VALUES are replaced
// only together with a corrected index (so options and answer stay in sync).
// When `shuffleOptions` is set, the final options are also reordered (answer
// position changes, correctness preserved) as the LAST step.
function buildExtendSet(q, parsed, extendQuestion = false, shuffleOptions = false) {
  const set = { explanation: parsed.explanation };
  // When the caller asked to extend the question length, apply the AI's longer
  // rewrite of the stem (same meaning/answer) — sanitising any $...$ the model
  // wrongly wrapped around plain words. Ignored otherwise so Extend never
  // touches the question wording.
  if (extendQuestion && typeof parsed?.text === "string" && parsed.text.trim()) {
    const rewritten = unwrapWordMath(parsed.text.trim());
    // Backstop for the "at most 3 lines" rule: if the model ignored the limit
    // and returned an over-long stem (roughly > 3 lines ≈ 45 words or explicit
    // line breaks pushing past 3 lines), keep the ORIGINAL short stem instead of
    // applying a wall of text.
    const wordCount = rewritten.split(/\s+/).filter(Boolean).length;
    const lineCount = rewritten.split(/\r?\n/).filter((l) => l.trim()).length;
    if (wordCount <= 45 && lineCount <= 3) set.text = rewritten;
  }
  const newCorrect =
    Number.isInteger(parsed?.correct) && parsed.correct >= 0 && parsed.correct <= 3 ? parsed.correct : null;
  const newOptions =
    Array.isArray(parsed?.options) && parsed.options.length === 4 && parsed.options.every((s) => String(s).trim() !== "")
      ? parsed.options.map((x) => String(x))
      : null;
  // The correct answer is verifiable for EVERY question type, so a corrected
  // index may be applied to any type. Option VALUES may be rewritten for the
  // free-form + "how many are correct" families (plain MCQ, table, and
  // pair/pairselect/statement/matching) — e.g. to insert a missing "None of the
  // pairs" choice — but NOT for assertion–reason, whose four options are a fixed
  // rubric.
  const canFixOptions = !q.type || ["mcq", "table", "pair", "pairselect", "statement", "matching", "journal", "ledger", "rearrange"].includes(q.type);
  if (newOptions && newCorrect != null && canFixOptions) set.options = newOptions; // replace values only with a corrected index
  if (newCorrect != null) set.correct = newCorrect;
  const effectiveCorrect = newCorrect != null ? newCorrect : q.correct;
  if (Array.isArray(parsed?.optionExplanations)) {
    const oe = parsed.optionExplanations.slice(0, 4);
    while (oe.length < 4) oe.push("");
    if (typeof effectiveCorrect === "number" && effectiveCorrect >= 0 && effectiveCorrect < 4) oe[effectiveCorrect] = "";
    set.optionExplanations = oe;
  }
  // Calculation-based question → drop per-option "why wrong" notes (the
  // step-by-step working in the explanation is enough). Clears any existing
  // notes too, so re-extending a calc question also removes them.
  if (parsed?.numerical) set.optionExplanations = ["", "", "", ""];
  // LAST: optionally reorder the (possibly just-fixed) options, keeping the same
  // correct answer — so the answer's position is shuffled without breaking it.
  if (shuffleOptions) applyOptionShuffle(set, q);
  // ASSERTION–REASON: guarantee the dedicated format even on Extend. Recover A
  // and R into their own fields (splitting a packed field/the stem), strip the
  // A/R copy from the stem, and force the four standard A/R options — so an
  // old/broken assertion question becomes properly structured. The answer index
  // is kept (Extend never changes it unless the AI supplied a corrected one).
  if (q.type === "assertion") {
    const ar = recoverAssertionReason(
      parsed?.assertion != null ? parsed.assertion : q.assertion,
      parsed?.reason != null ? parsed.reason : q.reason,
      set.text || parsed?.text || q.text
    );
    if (ar.assertion) set.assertion = ar.assertion;
    if (ar.reason) set.reason = ar.reason;
    const intro = stripAssertionFromStem(set.text || parsed?.text || q.text || "");
    set.text = intro || "Consider the following Assertion (A) and Reason (R):";
    set.options = [...ASSERTION_OPTIONS];
    if (!(Number.isInteger(set.correct) && set.correct >= 0 && set.correct <= 3)) {
      set.correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3 ? q.correct : 0;
    }
  }
  return set;
}

async function runExtendJob(id, { endpoints, model, questions, owner = null, notes = "", fixOptions = false, extendQuestion = false, shuffleOptions = false }) {
  const job = genJobs.get(id);
  const deadline = Date.now() + 12 * 60 * 1000; // overall time budget
  const save = (patch) => Object.assign(job, patch, { updatedAt: Date.now() });
  const total = questions.length;
  if (!job.keyStats) job.keyStats = {}; // live per-key activity for THIS run
  let updated = 0;
  let lastError = null;
  let parseFails = 0;   // calls that succeeded (HTTP ok) but yielded no usable explanation
  let emptyReplies = 0; // of those, how many returned empty content (safety filter / blank completion)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const MAX_QUOTA_WAITS = 6;  // per key: 429s we ride out before retiring the key
  const MAX_EMPTY = 4;        // per key: empty replies we retry before retiring it
  const MAX_ITEM_RETRIES = 4; // per question: soft failures before we give up on it

  // Shared work queue — every worker (one per key) pulls from the SAME queue, so
  // whichever key is free grabs the next question. Soft failures (bad JSON /
  // empty / transient) are re-queued (bounded) so one blip doesn't drop a
  // question. This mirrors the question generator, which uses all keys smoothly.
  const queue = [...questions];
  const itemTries = new Map(); // q._id -> soft-retry count
  const reserveOne = () => (queue.length ? queue.shift() : null); // atomic: no await between check & shift
  const requeue = (q) => {
    const k = String(q._id);
    const n = (itemTries.get(k) || 0) + 1;
    itemTries.set(k, n);
    if (n <= MAX_ITEM_RETRIES) queue.push(q); // else give up on this ONE question
  };

  // Run ONE question on ONE key. Returns an outcome the worker acts on.
  const extendOnKey = async (q, ep, ks) => {
    ks.requests += 1; save({}); // reflect the in-flight request immediately
    const r = await callProvider({
      key: ep.key,
      baseUrl: ep.baseUrl,
      model: ep.model || model,
      systemPrompt: fixOptions ? EXTEND_FIXOPTS_SYSTEM_PROMPT : EXTEND_SYSTEM_PROMPT,
      userPrompt: buildExtendPrompt(q, notes, fixOptions, extendQuestion),
      maxTokens: 8000, // the verified/step-by-step replies are long — avoid truncation
      failOnEmpty: true, // an empty reply → retry/roll over instead of counting as done
    });
    if (r.ok) {
      const parsed = parseExplanationJson(r.content);
      if (!parsed || !parsed.explanation) {
        // Call succeeded but the reply couldn't be turned into an explanation —
        // track it so a 0-updated run can report the REAL reason.
        parseFails += 1;
        if (!String(r.content || "").trim()) emptyReplies += 1;
        ks.error += 1; save({});
        return "soft";
      }
      const set = buildExtendSet(q, parsed, extendQuestion, shuffleOptions); // may fix a wrong answer/options, lengthen the stem, and/or reshuffle options
      await Question.updateOne({ _id: q._id }, { $set: set }).catch(() => {});
      updated += 1;
      ks.ok += 1; ks.questions += 1;
      AiKey.updateOne({ key: ep.key, owner: owner ?? null }, { $inc: { usedRequests: 1, usedTokens: r.tokens || 0 } }).catch(() => {});
      job.questions.push(1); // progress = actual successes (jobStatus reports count)
      save({});
      return "ok";
    }
    lastError = r;
    if (r.status === 429) { ks.limited += 1; save({}); return "limited"; }
    if (r.status === 520 && r.empty) { ks.error += 1; save({}); return "empty"; }
    if ([401, 403, 404].includes(r.status)) { ks.error += 1; save({}); return "dead"; }
    ks.error += 1; save({});
    return "soft";
  };

  // ONE worker PER API KEY → every key runs SIMULTANEOUSLY (same model as the
  // question generator, which works smoothly with all keys). Each worker sticks
  // to its OWN key; when that key hits its per-minute limit (429) it waits it out
  // ALONE while every OTHER key keeps extending. There is NO global barrier and
  // NO whole-job pause, so a rate limit on a few keys can't freeze the run.
  const worker = async (ep) => {
    let quotaWaits = 0;
    let emptyOnKey = 0;
    const _kl = ep.label || `••••${String(ep.key).slice(-4)}`;
    const ks = job.keyStats[_kl] || (job.keyStats[_kl] = { requests: 0, ok: 0, limited: 0, error: 0, questions: 0 });
    while (Date.now() < deadline && !job.cancelled) {
      const q = reserveOne();
      if (!q) break; // queue drained — this key retires cleanly
      let outcome;
      try { outcome = await extendOnKey(q, ep, ks); } catch { outcome = "soft"; }
      if (outcome === "ok") continue;
      if (outcome === "dead") { queue.push(q); break; } // key unauthorized / model invalid — retire it, let others take the question
      if (outcome === "limited") {
        // Hand this question to another (free) key right away, then ride out THIS
        // key's per-minute limit. The other workers keep going meanwhile.
        queue.push(q);
        if (quotaWaits >= MAX_QUOTA_WAITS) break; // this key keeps getting limited — retire it
        const waitMs = Math.min(retryWaitMs(null, lastError?.detail) || 30000, 60000);
        if (Date.now() + waitMs >= deadline) break;
        quotaWaits += 1;
        await sleep(waitMs);
        continue;
      }
      if (outcome === "empty") {
        requeue(q);
        if (++emptyOnKey >= MAX_EMPTY) break; // key keeps emitting empty — retire it
        continue;
      }
      requeue(q); // soft / transient — let any free key retry it (bounded)
    }
  };

  try {
    // Launch EVERY key at once; join only when the queue is drained (or every
    // key has retired / the time budget is spent).
    await Promise.all((endpoints || []).map((ep) => worker(ep)));

    if (updated === 0) {
      save({
        status: "error",
        error: lastError
          ? (lastError.status === 429
            ? "AI quota/rate limit reached before any explanation was updated. Wait a minute and try again."
            : lastError.empty
              ? `Every key returned an empty reply for all ${total} question(s) — usually a safety filter or a thinking-only/weak model. Try again, or set the key's model to gemini-2.5-flash (or gemini-2.5-pro).`
              : `AI provider error (${lastError.status || 0}). ${(lastError.detail || "").slice(0, 150)}`)
          : parseFails
            ? (emptyReplies >= parseFails
              ? `The AI returned empty replies for all ${total} question(s) — usually a safety filter or an overloaded/weak model. Try again, or set the key's model to gemini-2.5-flash.`
              : `The AI replied but its answers weren't valid JSON for all ${total} question(s). Try again, or switch to a stronger model (gemini-2.5-flash / gemini-2.5-pro).`)
            : "No explanations could be updated. Try again.",
      });
    } else {
      // If some remain, tell the caller so they can simply run it again.
      const short = updated < total;
      save({
        status: "done",
        updatedCount: updated,
        requested: total,
        error: short ? (lastError?.status === 429 ? "quota" : "partial") : null,
        remaining: short ? total - updated : 0,
      });
    }
  } catch (err) {
    save(updated ? { status: "done", updatedCount: updated } : { status: "error", error: err?.message || "Failed to extend explanations." });
  }
}

// POST /api/ai/extend-explanations  (admin or owning client)
// Body: { quiz? | testSeries?, model?, notes?, mode? } — starts a background job
// that rewrites the explanation + option notes of EVERY question in that quiz or
// test, updating them in place. Poll /api/ai/job/:id for progress.
export async function extendExplanations(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }

  // Load the target quiz/test's questions, scoped to the caller's own space so a
  // client can only touch their own content and an admin only platform content.
  const own = ownerFilter(req);
  let filter = null;
  if (req.body?.testSeries) filter = { testSeries: req.body.testSeries, ...own };
  else if (req.body?.quiz) filter = { quiz: req.body.quiz, ...own };
  if (!filter) return res.status(400).json({ message: "Provide a quiz or test to update." });
  // Optional: restrict to ONE question type (e.g. only "matching" / only "pair").
  // "all" (or any unknown value) means every type.
  // Special value "not_updated" = only questions never edited since upload.
  const onlyType = String(req.body?.type || "").trim();
  if (onlyType && onlyType !== "all" && onlyType !== "not_updated" && TYPES.includes(onlyType)) filter.type = onlyType;
  if (onlyType === "not_updated") {
    filter.$expr = { $lte: [{ $subtract: ["$updatedAt", "$createdAt"] }, 5000] };
  }

  // Process LEAST-RECENTLY-UPDATED first. Extending a question bumps its
  // updatedAt, so when a run stops early on quota, clicking "Extend" again
  // starts with the questions that were NOT reached last time — so repeated runs
  // actually finish the whole quiz instead of re-doing the first few each time.
  const questions = await Question.find(filter).sort("updatedAt").select("_id type text options correct columnA columnB tableRows assertion reason explanation optionExplanations").lean();
  if (!questions.length) return res.status(400).json({ message: filter.type ? `No "${filter.type}" questions found here (try "All question types").` : "No questions found to update (or not your content)." });

  const notes = String(req.body?.notes || "").trim();
  cleanupJobs();
  const id = newJobId();
  genJobs.set(id, { status: "pending", questions: [], requested: questions.length, error: null, model: chosen.model, updatedAt: Date.now() });
  guardJob(id, runExtendJob(id, { endpoints: chosen.endpoints, model: chosen.model, questions, owner: scope.owner, notes, fixOptions: !!req.body?.fixOptions, extendQuestion: !!req.body?.extendQuestion, shuffleOptions: !!req.body?.shuffleOptions }));
  res.json({ jobId: id, requested: questions.length, model: chosen.model });
}

// POST /api/ai/extend-explanation  (admin or owning client) — extend ONE
// question's explanation right away (synchronous, with a few retries) and
// return the updated explanation. Body: { questionId, model?, notes?, mode? }.
export async function extendOneExplanation(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }

  const own = ownerFilter(req);
  const q = await Question.findOne({ _id: req.body?.questionId, ...own })
    .select("_id type text options correct columnA columnB assertion reason explanation optionExplanations")
    .lean();
  if (!q) return res.status(404).json({ message: "Question not found (or not your content)." });

  const notes = String(req.body?.notes || "").trim();
  let parsed = null;
  let lastError = null;
  // A few attempts so a bad/truncated JSON reply is retried, not lost.
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    const r = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      systemPrompt: req.body?.fixOptions ? EXTEND_FIXOPTS_SYSTEM_PROMPT : EXTEND_SYSTEM_PROMPT,
      userPrompt: buildExtendPrompt(q, notes, !!req.body?.fixOptions, !!req.body?.extendQuestion),
      maxTokens: 8000,
      owner: scope.owner,
    });
    if (!r.ok) {
      lastError = r;
      if ([401, 403].includes(r.status)) break; // key dead — stop
      continue;
    }
    const p = parseExplanationJson(r.content);
    if (p && p.explanation) parsed = p;
  }

  if (!parsed) {
    const msg = lastError?.status === 429
      ? "AI quota/rate limit reached. Wait a minute and try again."
      : `The AI didn't return a usable explanation${lastError ? ` (error ${lastError.status || 0})` : ""}. Try again.`;
    return res.status(502).json({ message: msg });
  }

  const set = buildExtendSet(q, parsed, !!req.body?.extendQuestion, !!req.body?.shuffleOptions); // may fix a wrong numerical answer/options, lengthen the stem, and/or reshuffle options
  await Question.updateOne({ _id: q._id }, { $set: set });
  res.json({
    _id: q._id,
    explanation: set.explanation,
    optionExplanations: set.optionExplanations || q.optionExplanations,
    correct: set.correct ?? q.correct, // reflect any answer correction so the UI updates
    options: set.options || q.options,
    text: set.text ?? q.text, // reflect any extended/longer stem so the UI updates
    assertion: set.assertion ?? q.assertion, // reflect recovered A/R so the UI updates
    reason: set.reason ?? q.reason,
  });
}


/* --------------------- Regenerate a question's options ---------------------
   Takes the WHOLE existing question, analyses the stem/structure, and rebuilds
   fresh, correct OPTIONS + answer + explanations that actually fit it — fixing
   questions whose options or answer don't match the stem. The stem, type and any
   columns/assertion/reason are kept unchanged (reuses parseExplanationJson +
   buildExtendSet to apply the result). */

const REGEN_SYSTEM_PROMPT = `You are an expert exam question editor. You are given ONE existing exam question (its stem, type, any columns/assertion/reason, and its CURRENT options — which may be wrong or may not fit the question). ANALYSE the question and produce the CORRECT set of answer options that truly fit it, the correct answer, and rich explanations.

Respond with ONE valid JSON object and NOTHING else — no markdown, no code fences:
{"text":"...","options":["","","",""],"correct":0,"explanation":"...","optionExplanations":["","","",""]}
RULES:
- Keep the question's MEANING, TYPE and what it asks UNCHANGED. Do NOT invent a different question or change the numbers/facts being asked.
- FIX MATH RENDERING: if any math anywhere (stem, columns, options, explanation) is written as PLAIN TEXT, wrap it properly in $...$ so it renders — e.g. "3/4" → "$\\frac{3}{4}$", "x^2" → "$x^2$", "N/2" → "$\\frac{N}{2}$", "sqrt(2)" → "$\\sqrt{2}$", "25%" → "$25\\%$", "Sum(P1*Q0)/Sum(P0*Q0)" → "$\\frac{\\sum P_1 Q_0}{\\sum P_0 Q_0}$". Return the SAME meaning with the math wrapped and obvious typos/rendering fixed.
- COLUMN QUESTIONS (matching / pair / pairselect / statement / rearrange): "text" must be ONLY the short intro line (e.g. "Identify the correct mapping." or "Consider the following statements:"). NEVER put the Column A / Column B / statement / sentence items inside "text". Put the Column A items in "columnA" and the Column B items in "columnB" (the SAME number of items as given), each with any formula/math wrapped in $...$ so the columns themselves render. Do NOT prefix these items with numbers or roman numerals (no "1.", "I.") — the app numbers Column A (1,2,3,4) and Column B (I,II,III,IV) automatically. The 4 "options" stay as mapping sequences (e.g. "1-II, 2-IV, 3-I, 4-III") / combinations. For a "rearrange" (sentence rearrangement) question, put the FOUR jumbled sentences (one per element, no numbering) in "columnA" and make "text" ONLY the instruction line; if the sentences are currently embedded in the stem paragraph, SPLIT them out into "columnA". Its 4 "options" are orderings of the four sentences written as Roman numerals joined by hyphens (e.g. "IV-II-I-III"), matching columnA order (columnA[0]=I, columnA[1]=II, columnA[2]=III, columnA[3]=IV); exactly one is the correct logical order.
- MATCHING, PAIR & PAIRSELECT questions: return "columnA" and "columnB" ALIGNED so EVERY pair is correct (columnA[i] ↔ columnB[i]), plus "pairFacts" (one short reason per pair). Do NOT shuffle and do NOT set the "options"/"correct" yourself — the app reshuffles Column B and builds the mapping / count / which-pairs answer to match.
- TABLE questions: the data table MUST go in "tableRows" (a 2D array; the FIRST inner row is the header), NEVER as a markdown/pipe table inside "text". "text" is ONLY the question sentence (no "| ... |" rows). If the question currently shows a table in the stem AND/OR in tableRows — even with DIFFERENT numbers — CONSOLIDATE into ONE correct table in "tableRows" (choose the data that is consistent with the intended options, wrap any math in each cell in $...$), remove the table from "text", then SOLVE the question from THAT table with the correct formula and set "options"/"correct" to match your computed value. Return the table in "tableRows".
- Regenerate the 4 "options", the 0-based "correct" index, the "explanation" and the 4 "optionExplanations" so they are correct and fit the question.
- "options": EXACTLY 4, fitting the question TYPE, with ONE genuinely correct answer and three plausible-but-wrong distractors. SAME-CATEGORY RULE (important): all four options MUST be of the SAME real-world category/type and format as the correct answer — e.g. a question about a TREE → ALL options are tree names; a river → all rivers; a person → all people of that field/era; a date → plausible nearby dates. Never mix in an unrelated kind (a flower/bird/word among tree names), and match their language, form, length and specificity so the wrong ones are closely related and believable. Wrap any numeric option value or expression in $...$ so it renders as math (e.g. "$12.5$", "$\\frac{3}{4}$", "$2^{10}$", "$25\\%$"):
  • mcq / table: four answer choices.
  • journal: four candidate ACCOUNTING answers of the same form — each a COMPLETE journal entry written as a PIPE-DELIMITED TABLE in the standard textbook format with EXACTLY five columns "Date | Particulars | LF | Amount(Dr.) | Amount(Cr.)" (a header row, then one row per entry line separated by "\\n"; a debited account → Particulars "<Account> A/c Dr." with its amount in "Amount(Dr.)"; a credited account → Particulars "To <Account> A/c" with its amount in "Amount(Cr.)"; a final "(Being …)" narration row; Date and LF left empty; NO "---" separator row). Wrap every row in outer "|" pipes with exactly five cells. Example: "| Date | Particulars | LF | Amount(Dr.) | Amount(Cr.) |\\n| | Cash/Bank A/c Dr. | | 80,000 | |\\n| | Assets A/c Dr. | | 30,000 | |\\n| | To Capital A/c | | | 1,10,000 |\\n| | (Being business started with cash and assets) | | | |". Exactly one is correct and every entry must BALANCE (Amount(Dr.) total = Amount(Cr.) total). Apply the rules of debit and credit correctly; write amounts as plain numbers (NO "$", no currency symbol); the three wrong options are classic mistakes (reversed Dr/Cr, wrong account, wrong classification, wrong amount).
  • matching: each option is a FULL mapping like "1-III, 2-I, 3-IV, 4-II"; exactly one is the correct complete mapping.
  • statement: combinations like "1 only", "1 and 2 only", "Neither 1 nor 2".
  • pair: how MANY pairs are correctly matched — "Only one pair", "Only two pairs", "Only three pairs", "All four pairs", or "None of the pairs are correctly matched" when zero match.
  • pairselect: WHICH pairs are correct — "1 and 2 only", "2 and 3 only", "All of the above", etc.
  • rearrange: orderings of the four sentences as Roman numerals joined by hyphens (e.g. "IV-II-I-III"), matching columnA order (columnA[0]=I …); exactly one is the correct logical order.
  • assertion: keep the four standard A/R options; just choose the correct one.
- NUMERICAL: solve with the correct FORMULA step by step; the correct option MUST equal your computed value; show the working in "explanation" (each step on its own line).
- MATCHING / PAIR / STATEMENT: evaluate EACH pair/statement individually and make the answer reflect the TRUE count/combination; if none of the standard options fit (e.g. zero pairs match), include the right one (e.g. "None of the pairs are correctly matched").
- "correct": 0-based index (0-3) of the truly correct option; leave THAT option's "optionExplanations" entry an empty string "".
- CALCULATION-BASED questions: if the answer is reached by calculation (arithmetic/formula/solving), ALSO include "numerical":true and leave ALL FOUR "optionExplanations" empty "" — the step-by-step working in "explanation" is enough; do NOT write per-option notes.
- LAWS / BILLS / ACTS / AMENDMENTS & DATES: when the question or its answer concerns a law/bill/act/amendment/ordinance/scheme/treaty/appointment/report/event, use its EXACT date (day, month and year) in the explanation — NOT the year alone — and state only facts about the REAL, verifiable item; if the exact date/provisions of a very recent item are not reliably known, do NOT fabricate them.
- EXPLANATION SCOPE BY TYPE: for a plain "mcq", the "explanation" box must teach ONLY the correct option (do NOT mention or justify the incorrect options in it) — but STILL fill each of the 4 "optionExplanations" with why that option is right or wrong (leaving the correct option's entry ""). For every OTHER type (matching, statement, pair, pairselect, assertion, table, journal), the "explanation" must go through each pairing / statement / sub-option / journal entry in detail (for journal: name the accounts debited & credited, their classification, the rule applied, and confirm debit total = credit total), AND each of the 4 "optionExplanations" must explain why that option is right or wrong (leaving the correct option's entry ""). EXCEPTION — for CALCULATION-based questions, leave ALL FOUR "optionExplanations" empty "" (the working in "explanation" is enough).
- "explanation": thorough, self-contained, each point/step on its own line. Write math as inline LaTeX between $...$ (never \\( \\) or \\[ \\]); NEVER use "$" for money. No trailing commas.
Return ONLY the JSON object.`;

function buildRegenPrompt(q, notes, { fixOptions = true, extendQuestion = false } = {}) {
  const lines = [`Question type: ${q.type || "mcq"}`];
  if (q.text) lines.push(`Question: ${q.text}`);
  if (q.assertion) lines.push(`Assertion (A): ${q.assertion}`);
  if (q.reason) lines.push(`Reason (R): ${q.reason}`);
  if (Array.isArray(q.columnA) && q.columnA.length) lines.push(`Column A: ${q.columnA.map((x, i) => `${i + 1}. ${x}`).join("  |  ")}`);
  if (Array.isArray(q.columnB) && q.columnB.length) lines.push(`Column B: ${q.columnB.map((x, i) => `${toRomanLite(i + 1)}. ${x}`).join("  |  ")}`);
  if (Array.isArray(q.tableRows) && q.tableRows.length) lines.push(`Current table (first row = header):\n${q.tableRows.map((r) => (Array.isArray(r) ? r.join(" | ") : String(r))).join("\n")}`);
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length) lines.push(
    fixOptions
      ? `Current options (may be WRONG — replace with correct ones that fit the question):\n${opts.map((o, i) => `${EXT_LETTERS[i] || i}) ${o}`).join("\n")}`
      : `Current options (KEEP these EXACTLY — do NOT change them):\n${opts.map((o, i) => `${EXT_LETTERS[i] || i}) ${o}`).join("\n")}`
  );
  if (notes) lines.push(`MANDATORY user instructions (follow EXACTLY): ${notes}`);
  if (fixOptions && ["pair", "matching", "pairselect"].includes(q.type)) {
    const kind = q.type === "pair" ? "count" : q.type === "matching" ? "mapping" : "which-pairs-are-correct";
    lines.push(`This is a ${q.type.toUpperCase()} question. Return "columnA" and "columnB" ALIGNED so that columnA[i] is the CORRECT match of columnB[i] for EVERY index i (i.e. all pairs correct as returned) — do NOT shuffle them yourself and keep the SAME number of items. Also return "pairFacts": an array with one SHORT reason per pair (pairFacts[i] = why columnA[i] correctly matches columnB[i]). Do NOT set the "options" or the "correct" index yourself — the app reshuffles Column B and builds the ${kind} answer to match.`);
  }
  if (fixOptions && q.type === "rearrange") {
    lines.push(`This is a REARRANGE (sentence rearrangement) question. Return the FOUR sentences in "columnA" as an array of 4 complete sentences (no numbering) and make "text" ONLY the instruction line (e.g. "Rearrange the following sentences to form a meaningful paragraph:"). If the four sentences are currently EMBEDDED IN THE STEM paragraph, SPLIT them out into "columnA". The 4 "options" are orderings written as Roman numerals joined by hyphens (e.g. "IV-II-I-III"), matching columnA order (columnA[0]=I, [1]=II, [2]=III, [3]=IV); exactly ONE is the correct logical order.`);
  } else if (fixOptions && q.type === "statement") {
    lines.push(`This is a STATEMENT question. Return the statements in "columnA" (an array, no numbering) and make "text" ONLY the intro line. If the statements are currently EMBEDDED IN THE STEM, SPLIT them out into "columnA".`);
  }
  if (q.type === "assertion") {
    lines.push(`This is an ASSERTION–REASON question — return it in the DEDICATED FORMAT. Provide a NON-EMPTY "assertion" (the full Assertion A sentence) and a NON-EMPTY "reason" (the full Reason R sentence) as SEPARATE fields. If A and/or R are currently packed into the stem, the options, or written inline as "Assertion (A): … Reason (R): …", SPLIT them out into these two fields. Make "text" ONLY the short intro line (e.g. "Consider the following Assertion (A) and Reason (R):") with NO A/R copy inside it. The 4 "options" MUST be EXACTLY, in this order: "Both A and R are true and R is the correct explanation of A", "Both A and R are true but R is NOT the correct explanation of A", "A is true but R is false", "A is false but R is true". Set "correct" to the 0-based index (0-3) that truly holds after evaluating A and R.`);
  }
  // When the user ticks "Extend the question length", allow (only) the STEM to
  // be rewritten a little longer — same rules and 3-line cap as Extend.
  if (extendQuestion) {
    lines.push(`ALSO EXTEND THE QUESTION LENGTH (this OVERRIDES "keep the meaning unchanged" for the STEM ONLY): rewrite the question stem into a slightly LONGER, clearer, full-sentence version and return it as "text" — but ONLY if it genuinely needs it. Many stems are ALREADY complete questions and MUST be returned EXACTLY as-is (e.g. "What is the full form of NABARD?", "What is the SI unit of force?", "Who wrote …?"). DECISIVE RULE: if the stem ends with a colon or is a bare phrase/label (e.g. "Lateral means:", "Newton's second law:"), you MUST turn it into a complete question; if it is already a full question sentence, leave it unchanged. STRICT LENGTH LIMIT when you do extend: AT MOST 3 lines (about 2 sentences / 40 words) — never a paragraph. Keep the EXACT SAME meaning, options and correct answer. NEVER spell out an abbreviation/acronym into its full form and NEVER add a unit of measurement in the stem (keep "NABARD", "DNA", "N", "kg" as-is). For matching/assertion/statement/table questions, extend ONLY the intro sentence in "text" (still within 3 lines) and leave the columns/assertion/reason/table untouched.`);
  }
  if (fixOptions) {
    lines.push(`Analyse THIS question and FIX anything wrong: rebuild the 4 "options", the "correct" index, the "explanation" and the 4 "optionExplanations" so they are correct and fit the question, AND wrap any plain-text math so it renders. Return the SAME stem in "text" (and same-count "columnA"/"columnB" for matching/pair/statement) with math wrapped in $...$ — keep the meaning unchanged${extendQuestion ? " (except the allowed stem-lengthening above)" : ""}. If the question is CALCULATION-based, set "numerical": true and leave all four "optionExplanations" empty "" (the working in the explanation is enough). Return ONLY one valid JSON object {"text":"...","options":["","","",""],"correct":0,"explanation":"...","optionExplanations":["","","",""]}.`);
  } else {
    lines.push(`DO NOT change the options or the correct answer — keep them EXACTLY as given. Your ONLY job is to write a rich "explanation" and the 4 "optionExplanations" (why each option is right/wrong) for the EXISTING options, leaving the correct option's note "". Also return the SAME stem in "text" with any plain-text math wrapped in $...$ so it renders${extendQuestion ? " (you MAY apply the allowed stem-lengthening above)" : " — keep the meaning and wording unchanged"}. Do NOT return a "correct" index or a new "options" array that differs from the current ones. Return ONLY one valid JSON object {"text":"...","explanation":"...","optionExplanations":["","","",""]}.`);
  }
  return lines.join("\n");
}

const NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const toRomanPos = (i0) => ROMAN[i0] || String(i0 + 1); // 0-based index → roman label
const shuffleInPlace = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// A uniformly-random permutation (perm[newIndex] = oldIndex) for reshuffling
// options that is genuinely RANDOM — never the identity, never a simple cyclic
// rotation (so the answer doesn't just march A→B→C→D→A), and, when a correct
// index is given, ALWAYS moves that answer to a different slot. Best-effort:
// returns the last attempt after enough tries.
function shuffledPermutation(n, mustMoveIndex = null) {
  if (n < 2) return [...Array(n).keys()];
  const isRotation = (p) => { for (let k = 1; k < n; k++) if (p.every((v, i) => v === (i + k) % n)) return true; return false; };
  let perm = [...Array(n).keys()];
  for (let g = 0; g < 80; g++) {
    shuffleInPlace(perm);
    const identity = perm.every((p, i) => p === i);
    const rotated = n >= 4 && isRotation(perm); // only enforce for 4+ options (n<4 has too few perms)
    const answerStuck = mustMoveIndex != null && perm.indexOf(mustMoveIndex) === mustMoveIndex;
    if (!identity && !rotated && !answerStuck) break;
  }
  return perm;
}
// Return a derangement (permutation with NO element left in its original slot).
function derange(arr) {
  if (arr.length < 2) return arr.slice();
  let res;
  let tries = 0;
  do { res = shuffleInPlace(arr.slice()); tries++; } while (tries < 50 && res.some((v, i) => v === arr[i]));
  return res;
}
// A position map of length n with EXACTLY k fixed points (perm[i]===i). The
// remaining n-k positions are deranged, so they are genuinely wrong. Requires
// 0<=k<=n-2 or k===n (a permutation can never have exactly n-1 fixed points).
function permWithKFixed(n, k) {
  const order = shuffleInPlace([...Array(n).keys()]);
  const fixed = new Set(order.slice(0, k));
  const perm = new Array(n);
  for (let i = 0; i < n; i++) if (fixed.has(i)) perm[i] = i;
  const movers = [...Array(n).keys()].filter((i) => !fixed.has(i));
  const dv = derange(movers);
  movers.forEach((pos, i) => { perm[pos] = dv[i]; });
  return perm;
}
// Build the 4 count-options for an n-pair question and the correct index for k.
function buildPairCountOptions(n, k) {
  const label = (c) => (c === n ? `All ${NUM_WORD[n] || n} pairs` : c === 0 ? "None of the pairs" : `Only ${NUM_WORD[c] || c} pair${c === 1 ? "" : "s"}`);
  const chosen = new Set([k]);
  const pool = [];
  for (let c = 1; c <= n; c++) pool.push(c);
  if (n < 4) pool.unshift(0);
  pool.sort((a, b) => Math.abs(a - k) - Math.abs(b - k));
  for (const c of pool) { if (chosen.size >= 4) break; chosen.add(c); }
  let pad = 0;
  while (chosen.size < 4) { if (!chosen.has(pad)) chosen.add(pad); pad++; }
  const counts = shuffleInPlace(Array.from(chosen));
  return { options: counts.map(label), correctIndex: counts.indexOf(k) };
}
// PAIR questions: the AI returns columnA/columnB ALIGNED so every pair is
// correct, plus pairFacts. We deterministically reshuffle Column B so exactly
// k pairs stay correct (1 <= k <= n-2 → guaranteed a real mix, at least one
// correct and at least one wrong), then set the count option, correct index and
// explanation to MATCH — so the shown answer is always right for the layout.
function applyPairReshuffle(set, q, parsed) {
  const columnA = (set.columnA && set.columnA.length ? set.columnA : parsed.columnA || q.columnA || []).map((x) => String(x));
  const columnB = (set.columnB && set.columnB.length ? set.columnB : parsed.columnB || q.columnB || []).map((x) => String(x));
  const n = columnA.length;
  if (n < 3 || columnB.length !== n) return; // need >=3 to make a valid 1..n-2 mix
  const k = 1 + Math.floor(Math.random() * (n - 2)); // 1 .. n-2
  const perm = permWithKFixed(n, k);
  const newB = perm.map((p) => columnB[p]);
  const facts = Array.isArray(parsed.pairFacts) ? parsed.pairFacts.map((x) => String(x)) : [];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const why = facts[i] ? ` (${facts[i]})` : "";
    if (perm[i] === i) lines.push(`${i + 1}. ${columnA[i]} — ${newB[i]}: correctly matched${why}.`);
    else lines.push(`${i + 1}. ${columnA[i]} — ${newB[i]}: NOT correctly matched — ${columnA[i]} actually pairs with ${columnB[i]}${why}.`);
  }
  lines.push(`So ${NUM_WORD[k] || k} of the ${NUM_WORD[n] || n} pairs ${k === 1 ? "is" : "are"} correctly matched.`);
  const { options, correctIndex } = buildPairCountOptions(n, k);
  set.columnA = columnA;
  set.columnB = newB;
  set.options = options;
  set.correct = correctIndex;
  set.explanation = lines.join("\n");
  set.optionExplanations = options.map((_, idx) => (idx === correctIndex ? "" : `Incorrect — exactly ${NUM_WORD[k] || k} pair${k === 1 ? "" : "s"} match, not what this option states.`));
}

// MATCHING questions: the AI returns columnA/columnB ALIGNED (columnA[i] ↔
// columnB[i] is the correct match) + pairFacts. We reshuffle Column B with a
// FULL derangement (all items move to a new position) and rebuild the mapping
// options so the correct sequence matches the new positions, adding 3 wrong
// full-mapping distractors — so the correct answer always fits the layout.
function applyMatchingReshuffle(set, q, parsed) {
  const columnA = (set.columnA && set.columnA.length ? set.columnA : parsed.columnA || q.columnA || []).map((x) => String(x));
  const columnB = (set.columnB && set.columnB.length ? set.columnB : parsed.columnB || q.columnB || []).map((x) => String(x));
  const n = columnA.length;
  if (n < 3 || columnB.length !== n) return; // need >=3 for a valid full reshuffle + distinct distractors
  const perm = derange([...Array(n).keys()]); // newB[j] = columnB[perm[j]] (all items move)
  const newB = perm.map((p) => columnB[p]);
  const invPerm = new Array(n); // invPerm[i] = new position of columnB[i]
  perm.forEach((p, j) => { invPerm[p] = j; });
  const correctAssign = invPerm.slice(); // correctAssign[i] = 0-based position of columnA[i]'s true match
  const mappingStr = (assign) => assign.map((pos, i) => `${i + 1}-${toRomanPos(pos)}`).join(", ");
  const correctStr = mappingStr(correctAssign);
  // 3 distinct WRONG full-mapping distractors (each a valid, plausible permutation).
  const seen = new Set([correctStr]);
  const distractors = [];
  for (let guard = 0; distractors.length < 3 && guard < 300; guard++) {
    const s = mappingStr(shuffleInPlace([...Array(n).keys()]));
    if (!seen.has(s)) { seen.add(s); distractors.push(s); }
  }
  while (distractors.length < 3) distractors.push(correctStr); // safety only (n>=3 always fills)
  const options = shuffleInPlace([correctStr, ...distractors]);
  const correctIndex = options.indexOf(correctStr);
  const facts = Array.isArray(parsed.pairFacts) ? parsed.pairFacts.map((x) => String(x)) : [];
  const lines = ["The correct matching is:"];
  for (let i = 0; i < n; i++) {
    const why = facts[i] ? ` (${facts[i]})` : "";
    lines.push(`${i + 1}-${toRomanPos(correctAssign[i])}: ${columnA[i]} ↔ ${columnB[i]}${why}.`);
  }
  set.columnA = columnA;
  set.columnB = newB;
  set.options = options;
  set.correct = correctIndex;
  set.explanation = lines.join("\n");
  set.optionExplanations = options.map((_, idx) => (idx === correctIndex ? "" : `Incorrect mapping — the correct sequence is ${correctStr}.`));
}

// Format a set of 1-based positions as a pairselect option: [2,3] → "2 and 3
// only", [1,3,4] → "1, 3 and 4 only", [2] → "2 only", full set → "All of the above".
function formatSubset(positions, n) {
  const s = [...positions].sort((a, b) => a - b);
  if (s.length >= n) return "All of the above";
  if (s.length === 1) return `${s[0]} only`;
  return `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]} only`;
}
const subsetKey = (positions) => [...positions].sort((a, b) => a - b).join(",");
// Build 4 distinct which-pairs options (including the true correct set) + the index.
function buildPairSelectOptions(n, correctPositions) {
  const correctKey = subsetKey(correctPositions);
  const seen = new Set([correctKey]);
  const subsets = [correctPositions.slice()];
  const all = [...Array(n).keys()].map((i) => i + 1); // "All of the above" — always a good distractor
  if (subsetKey(all) !== correctKey) { seen.add(subsetKey(all)); subsets.push(all); }
  for (let guard = 0; subsets.length < 4 && guard < 500; guard++) {
    const s = [];
    for (let p = 1; p <= n; p++) if (Math.random() < 0.5) s.push(p);
    if (!s.length) continue;
    const key = subsetKey(s);
    if (!seen.has(key)) { seen.add(key); subsets.push(s); }
  }
  for (let p = 1; p <= n && subsets.length < 4; p++) { if (!seen.has(String(p))) { seen.add(String(p)); subsets.push([p]); } }
  const opts = shuffleInPlace(subsets.slice(0, 4));
  return { options: opts.map((s) => formatSubset(s, n)), correctIndex: opts.findIndex((s) => subsetKey(s) === correctKey) };
}
// PAIRSELECT questions: the AI returns columnA/columnB ALIGNED (all correct) +
// pairFacts. We reshuffle Column B so exactly k pairs stay correct (1..n-2 →
// at least one correct and at least one wrong), then set the which-pairs option,
// correct index and explanation to MATCH the reshuffled layout.
function applyPairSelectReshuffle(set, q, parsed) {
  const columnA = (set.columnA && set.columnA.length ? set.columnA : parsed.columnA || q.columnA || []).map((x) => String(x));
  const columnB = (set.columnB && set.columnB.length ? set.columnB : parsed.columnB || q.columnB || []).map((x) => String(x));
  const n = columnA.length;
  if (n < 3 || columnB.length !== n) return;
  const k = 1 + Math.floor(Math.random() * (n - 2)); // 1 .. n-2
  const perm = permWithKFixed(n, k);
  const newB = perm.map((p) => columnB[p]);
  const correctPositions = [];
  for (let i = 0; i < n; i++) if (perm[i] === i) correctPositions.push(i + 1);
  const facts = Array.isArray(parsed.pairFacts) ? parsed.pairFacts.map((x) => String(x)) : [];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const why = facts[i] ? ` (${facts[i]})` : "";
    if (perm[i] === i) lines.push(`${i + 1}. ${columnA[i]} — ${newB[i]}: correctly matched${why}.`);
    else lines.push(`${i + 1}. ${columnA[i]} — ${newB[i]}: NOT correctly matched — ${columnA[i]} actually pairs with ${columnB[i]}${why}.`);
  }
  const listAnd = correctPositions.length === 1 ? `${correctPositions[0]}` : `${correctPositions.slice(0, -1).join(", ")} and ${correctPositions[correctPositions.length - 1]}`;
  lines.push(`So pair${correctPositions.length === 1 ? "" : "s"} ${listAnd} ${correctPositions.length === 1 ? "is" : "are"} correctly matched.`);
  const { options, correctIndex } = buildPairSelectOptions(n, correctPositions);
  set.columnA = columnA;
  set.columnB = newB;
  set.options = options;
  set.correct = correctIndex;
  set.explanation = lines.join("\n");
  set.optionExplanations = options.map((_, idx) => (idx === correctIndex ? "" : `Incorrect — only pair${correctPositions.length === 1 ? "" : "s"} ${listAnd} ${correctPositions.length === 1 ? "is" : "are"} correctly matched.`));
}

// Build the Mongo $set from a regenerated/parsed result — shared by the single
// Regenerate endpoint AND the bulk "Regenerate all" job. Applies the re-wrapped
// stem/columns (same meaning, math wrapped so it renders), the reshuffled
// Column B (same item count), fresh options + correct answer, and explanations.
function buildRegenSet(q, parsed, { fixOptions = true, extendQuestion = false, shuffleOptions = true } = {}) {
  const set = {};
  if (parsed.explanation) set.explanation = parsed.explanation;
  // Column-based questions keep their items in columnA/columnB — never in the
  // stem. Strip any "Column A/B …" block the model wrongly merged into "text".
  const isColumnType = ["matching", "pair", "pairselect", "statement", "rearrange"].includes(q.type);
  const isTableType = q.type === "table";
  if (isColumnType) {
    const introOnly = (s) => String(s || "").split(/\bColumn\s*[AB]\b\s*:?/i)[0].trim();
    const intro = introOnly(parsed.text) || introOnly(q.text);
    if (intro) set.text = intro;
  } else if (isTableType) {
    const stripTable = (s) => String(s || "").split(/\r?\n/).filter((ln) => (ln.match(/\|/g) || []).length < 2).join("\n").replace(/\n{2,}/g, "\n").trim();
    const intro = stripTable(parsed.text) || stripTable(q.text);
    if (intro) set.text = intro;
    if (Array.isArray(parsed.tableRows) && parsed.tableRows.length && parsed.tableRows.every((r) => Array.isArray(r))) {
      set.tableRows = parsed.tableRows.map((r) => r.map((c) => (c == null ? "" : String(c))));
    }
  } else if (parsed.text) {
    // When "Extend the question length" was ticked, guard against the model
    // ignoring the 3-line cap: keep the ORIGINAL stem if the rewrite ballooned
    // past ~3 lines / 45 words (mirrors buildExtendSet's backstop).
    if (extendQuestion) {
      const rewritten = String(parsed.text).trim();
      const wordCount = rewritten.split(/\s+/).filter(Boolean).length;
      const lineCount = rewritten.split(/\r?\n/).filter((l) => l.trim()).length;
      set.text = wordCount <= 45 && lineCount <= 3 ? rewritten : q.text;
    } else {
      set.text = parsed.text;
    }
  }
  // ASSERTION–REASON: convert the question into the DEDICATED format. Recover A
  // and R into their own fields (splitting a packed field/the stem), remove the
  // A/R copy from the stem, and FORCE the four standard A/R options — so an old
  // or badly-shaped assertion question becomes properly structured on Regenerate
  // (and on Extend, which keeps the answer). Runs for both fixOptions on/off.
  if (q.type === "assertion") {
    const ar = recoverAssertionReason(
      parsed.assertion != null ? parsed.assertion : q.assertion,
      parsed.reason != null ? parsed.reason : q.reason,
      parsed.text || q.text
    );
    if (ar.assertion) set.assertion = ar.assertion;
    if (ar.reason) set.reason = ar.reason;
    // Intro-only stem — never carries the A/R sentences (they render from their
    // own boxes). Falls back to a standard intro when nothing else is left.
    const intro = stripAssertionFromStem(parsed.text || q.text || "");
    set.text = intro || "Consider the following Assertion (A) and Reason (R):";
    // Always enforce the four canonical A/R options and a valid answer index.
    set.options = [...ASSERTION_OPTIONS];
    set.correct = Number.isInteger(parsed.correct) && parsed.correct >= 0 && parsed.correct <= 3
      ? parsed.correct
      : (Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3 ? q.correct : 0);
  }
  // Strip any leading "1."/"I." marker — the app auto-numbers the columns.
  if (Array.isArray(parsed.columnA) && Array.isArray(q.columnA) && parsed.columnA.length === q.columnA.length) set.columnA = parsed.columnA.map(stripListMarker);
  if (Array.isArray(parsed.columnB) && Array.isArray(q.columnB) && parsed.columnB.length === q.columnB.length) set.columnB = parsed.columnB.map(stripListMarker);
  // Statement / Rearrange: the items live in columnA. Rebuild it (CREATE or
  // RESIZE — not just same-length edits) from the model's columnA, else recover
  // a numbered list from the stem. This converts OLD paragraph-style questions
  // into the boxed list on Regenerate.
  if (q.type === "statement" || q.type === "rearrange") {
    let items = Array.isArray(parsed.columnA) ? parsed.columnA.map((s) => (s == null ? "" : String(s))).filter((s) => s.trim() !== "") : [];
    let intro = parsed.text;
    // Always try to pull a numbered list out of the stem: this both recovers the
    // items (when columnA is missing) AND strips them from the intro line, so an
    // old paragraph-style question is converted into the boxed list + a clean
    // instruction line.
    const ex = extractNumbered(parsed.text) || extractRomanNumbered(parsed.text) || extractNumbered(q.text) || extractRomanNumbered(q.text);
    if (ex && ex.intro) intro = ex.intro;
    if (items.length < 2 && ex && Array.isArray(ex.statements) && ex.statements.length >= 2) items = ex.statements;
    if (items.length >= 2) { set.columnA = items.map(stripListMarker); set.columnB = []; }
    if (intro && String(intro).trim()) set.text = String(intro).trim();
  }
  const newCorrect = Number.isInteger(parsed.correct) && parsed.correct >= 0 && parsed.correct <= 3 ? parsed.correct : null;
  const newOptions = Array.isArray(parsed.options) && parsed.options.length === 4 && parsed.options.every((s) => String(s).trim() !== "")
    ? parsed.options.map((x) => String(x)) : null;
  const canFixOptions = !q.type || ["mcq", "table", "pair", "pairselect", "statement", "matching", "journal", "ledger", "rearrange"].includes(q.type);
  // "Fix options" (default on) gates whether the options/answer are rebuilt at
  // all. When the user unticks it, the existing options & correct answer are
  // kept untouched and only the explanation / per-option notes are refreshed.
  if (fixOptions && canFixOptions) {
    // Move the correct-answer index ONLY together with a fresh, valid 4-option
    // set, so the marked answer always matches what is shown. Updating "correct"
    // on its own (when the model didn't return usable options) would point it at
    // an unrelated OLD option and BREAK the question instead of fixing it — the
    // reported "regenerate doesn't correct a wrong question" bug.
    if (newOptions && newCorrect != null) { set.options = newOptions; set.correct = newCorrect; }
  } else if (fixOptions && newCorrect != null) {
    // Fixed-phrase types (e.g. assertion/reason) keep their canned options, so
    // the answer index can safely be corrected on its own.
    set.correct = newCorrect;
  }
  const eff = typeof set.correct === "number" ? set.correct : q.correct;
  if (Array.isArray(parsed.optionExplanations)) {
    const oe = parsed.optionExplanations.slice(0, 4);
    while (oe.length < 4) oe.push("");
    if (typeof eff === "number" && eff >= 0 && eff < 4) oe[eff] = "";
    set.optionExplanations = oe;
  }
  // Calculation-based question → no per-option "why wrong" notes (the working in
  // the explanation is enough). Clears existing ones too. (Pair/matching types
  // below are never numerical, so this won't clash with their rebuilt notes.)
  if (parsed.numerical) set.optionExplanations = ["", "", "", ""];
  // PAIR / MATCHING: reshuffle Column B deterministically and set the answer to
  // match exactly — fixes "shows the old answer after the columns are reshuffled".
  // The pair/matching/pairselect reshuffles are STRUCTURAL — they build the
  // count/mapping/which-pairs answer — so they only run when options are being
  // rebuilt (fixOptions). When "fix options" is off, everything is left as-is.
  if (fixOptions && q.type === "pair") applyPairReshuffle(set, q, parsed);
  else if (fixOptions && q.type === "matching") applyMatchingReshuffle(set, q, parsed);
  else if (fixOptions && q.type === "pairselect") applyPairSelectReshuffle(set, q, parsed);
  else if (shuffleOptions && q.type !== "assertion") {
    // PLAIN types (mcq / table / statement / untyped): the column types above
    // already reshuffle, and assertion keeps its fixed A/R rubric — but a plain
    // question's freshly rebuilt options can still come back with the answer in
    // a predictable slot. Reorder them here so the correct answer lands in a
    // random position, moving the `correct` index and the per-option notes with
    // it (correctness preserved). Skipped when the user unticks "Reshuffle".
    const opts = Array.isArray(set.options) && set.options.length ? set.options : null;
    if (opts && opts.length >= 2 && Number.isInteger(set.correct) && set.correct >= 0 && set.correct < opts.length) {
      const perm = shuffledPermutation(opts.length, set.correct); // random, non-rotation, answer moves
      set.options = perm.map((p) => opts[p]);
      set.correct = perm.indexOf(set.correct);
      if (Array.isArray(set.optionExplanations)) {
        const oe = set.optionExplanations.slice();
        while (oe.length < opts.length) oe.push("");
        set.optionExplanations = perm.map((p) => oe[p] ?? "");
      }
    }
  }
  return set;
}

// Background job: regenerate EVERY question in a quiz/test (mirrors runExtendJob).
// Multi-pass, one worker per key, so the whole set gets through despite quota.
async function runRegenAllJob(id, { endpoints, model, questions, owner = null, notes = "", fixOptions = true, extendQuestion = false, shuffleOptions = true }) {
  const job = genJobs.get(id);
  const deadline = Date.now() + 12 * 60 * 1000;
  const save = (patch) => Object.assign(job, patch, { updatedAt: Date.now() });
  const total = questions.length;
  if (!job.keyStats) job.keyStats = {}; // live per-key activity for THIS run
  let updated = 0;
  let lastError = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const MAX_QUOTA_WAITS = 6;
  const MAX_EMPTY = 4;
  const MAX_ITEM_RETRIES = 4;

  // Shared work queue + one worker per key (see runExtendJob for the rationale).
  const queue = [...questions];
  const itemTries = new Map();
  const reserveOne = () => (queue.length ? queue.shift() : null);
  const requeue = (q) => {
    const k = String(q._id);
    const n = (itemTries.get(k) || 0) + 1;
    itemTries.set(k, n);
    if (n <= MAX_ITEM_RETRIES) queue.push(q);
  };

  const regenOnKey = async (q, ep, ks) => {
    ks.requests += 1; save({});
    const r = await callProvider({
      key: ep.key,
      baseUrl: ep.baseUrl,
      model: ep.model || model,
      systemPrompt: REGEN_SYSTEM_PROMPT,
      userPrompt: buildRegenPrompt(q, notes, { fixOptions, extendQuestion }),
      maxTokens: 8000,
      failOnEmpty: true,
    });
    if (r.ok) {
      const parsed = parseExplanationJson(r.content);
      if (!parsed || !(parsed.explanation || (Array.isArray(parsed.options) && parsed.options.length === 4) || parsed.text || parsed.tableRows)) {
        ks.error += 1; save({});
        return "soft";
      }
      const set = buildRegenSet(q, parsed, { fixOptions, extendQuestion, shuffleOptions });
      if (!Object.keys(set).length) { ks.error += 1; save({}); return "soft"; }
      await Question.updateOne({ _id: q._id }, { $set: set }).catch(() => {});
      updated += 1;
      ks.ok += 1; ks.questions += 1;
      AiKey.updateOne({ key: ep.key, owner: owner ?? null }, { $inc: { usedRequests: 1, usedTokens: r.tokens || 0 } }).catch(() => {});
      job.questions.push(1);
      save({});
      return "ok";
    }
    lastError = r;
    if (r.status === 429) { ks.limited += 1; save({}); return "limited"; }
    if (r.status === 520 && r.empty) { ks.error += 1; save({}); return "empty"; }
    if ([401, 403, 404].includes(r.status)) { ks.error += 1; save({}); return "dead"; }
    ks.error += 1; save({});
    return "soft";
  };

  // ONE worker PER API KEY — every key regenerates simultaneously; a 429 parks
  // only that key while the others keep working (no global barrier/pause).
  const worker = async (ep) => {
    let quotaWaits = 0;
    let emptyOnKey = 0;
    const _kl = ep.label || `••••${String(ep.key).slice(-4)}`;
    const ks = job.keyStats[_kl] || (job.keyStats[_kl] = { requests: 0, ok: 0, limited: 0, error: 0, questions: 0 });
    while (Date.now() < deadline && !job.cancelled) {
      const q = reserveOne();
      if (!q) break;
      let outcome;
      try { outcome = await regenOnKey(q, ep, ks); } catch { outcome = "soft"; }
      if (outcome === "ok") continue;
      if (outcome === "dead") { queue.push(q); break; }
      if (outcome === "limited") {
        queue.push(q);
        if (quotaWaits >= MAX_QUOTA_WAITS) break;
        const waitMs = Math.min(retryWaitMs(null, lastError?.detail) || 30000, 60000);
        if (Date.now() + waitMs >= deadline) break;
        quotaWaits += 1;
        await sleep(waitMs);
        continue;
      }
      if (outcome === "empty") {
        requeue(q);
        if (++emptyOnKey >= MAX_EMPTY) break;
        continue;
      }
      requeue(q);
    }
  };

  try {
    await Promise.all((endpoints || []).map((ep) => worker(ep)));
    if (updated === 0) {
      save({
        status: "error",
        error: lastError
          ? (lastError.status === 429
            ? "AI quota/rate limit reached before any question was regenerated. Wait a minute and try again."
            : `AI provider error (${lastError.status || 0}). ${(lastError.detail || "").slice(0, 150)}`)
          : "No questions could be regenerated. Try again.",
      });
    } else {
      const short = updated < total;
      save({
        status: "done",
        updatedCount: updated,
        requested: total,
        error: short ? (lastError?.status === 429 ? "quota" : "partial") : null,
        remaining: short ? total - updated : 0,
      });
    }
  } catch (err) {
    save(updated ? { status: "done", updatedCount: updated } : { status: "error", error: err?.message || "Failed to regenerate questions." });
  }
}

// POST /api/ai/regenerate-all  (admin or owning client)
// Body: { quiz? | testSeries?, model?, notes?, mode? } — starts a background job
// that regenerates EVERY question in that quiz/test (rebuilds options/answer/
// explanation, reshuffles pair/matching Column B). Poll /api/ai/job/:id.
export async function regenerateAll(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }

  const own = ownerFilter(req);
  let filter = null;
  if (req.body?.testSeries) filter = { testSeries: req.body.testSeries, ...own };
  else if (req.body?.quiz) filter = { quiz: req.body.quiz, ...own };
  if (!filter) return res.status(400).json({ message: "Provide a quiz or test to update." });
  // Optional: restrict to ONE question type (e.g. only "matching" / only "pair").
  // "all" (or any unknown value) means every type.
  // Special value "not_updated" = only questions never edited since upload.
  const onlyType = String(req.body?.type || "").trim();
  if (onlyType && onlyType !== "all" && onlyType !== "not_updated" && TYPES.includes(onlyType)) filter.type = onlyType;
  if (onlyType === "not_updated") {
    filter.$expr = { $lte: [{ $subtract: ["$updatedAt", "$createdAt"] }, 5000] };
  }

  // Least-recently-updated first so repeated runs finish the whole set.
  const questions = await Question.find(filter).sort("updatedAt").select("_id type text options correct columnA columnB tableRows assertion reason explanation optionExplanations").lean();
  if (!questions.length) return res.status(400).json({ message: filter.type ? `No "${filter.type}" questions found here (try "All question types").` : "No questions found to update (or not your content)." });

  const notes = String(req.body?.notes || "").trim();
  // Optional toggles from the Regenerate-all dialog (defaults preserve the old
  // full-rebuild + reshuffle behaviour so callers that send nothing are
  // unaffected). fixOptions=false keeps each question's options/answer and only
  // refreshes explanations; extendQuestion lengthens bare stems; shuffleOptions
  // controls the answer-position reshuffle.
  const fixOptions = req.body?.fixOptions !== false;
  const shuffleOptions = req.body?.shuffleOptions !== false;
  const extendQuestion = req.body?.extendQuestion === true;
  cleanupJobs();
  const id = newJobId();
  genJobs.set(id, { status: "pending", questions: [], requested: questions.length, error: null, model: chosen.model, updatedAt: Date.now() });
  guardJob(id, runRegenAllJob(id, { endpoints: chosen.endpoints, model: chosen.model, questions, owner: scope.owner, notes, fixOptions, extendQuestion, shuffleOptions }));
  res.json({ jobId: id, requested: questions.length, model: chosen.model });
}

// POST /api/ai/regenerate-question  (admin or owning client) — analyse ONE
// question and rebuild its options/answer/explanations to fit the stem.
// Body: { questionId, model?, notes?, mode? }.
export async function regenerateQuestion(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }

  const own = ownerFilter(req);
  const q = await Question.findOne({ _id: req.body?.questionId, ...own })
    .select("_id type text options correct columnA columnB tableRows assertion reason explanation optionExplanations")
    .lean();
  if (!q) return res.status(404).json({ message: "Question not found (or not your content)." });

  const notes = String(req.body?.notes || "").trim();
  // Optional toggles from the Regenerate dialog. Defaults preserve the original
  // behaviour (full rebuild + reshuffle) so callers that send nothing are
  // unaffected. `fixOptions=false` keeps the current options/answer and only
  // refreshes the explanations; `extendQuestion` allows lengthening the stem;
  // `shuffleOptions=false` keeps the answer in its current position.
  const fixOptions = req.body?.fixOptions !== false;
  const shuffleOptions = req.body?.shuffleOptions !== false;
  const extendQuestion = req.body?.extendQuestion === true;
  let parsed = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    const r = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      systemPrompt: REGEN_SYSTEM_PROMPT,
      userPrompt: buildRegenPrompt(q, notes, { fixOptions, extendQuestion }),
      maxTokens: 8000, // full rebuild (stem + 4 options + explanation + 4 notes) — avoid truncation
      owner: scope.owner,
    });
    if (!r.ok) {
      lastError = r;
      if ([401, 403].includes(r.status)) break;
      continue;
    }
    const p = parseExplanationJson(r.content);
    // Accept a real rebuild: fresh options, an explanation, a re-wrapped stem, or a table.
    if (p && (p.explanation || (Array.isArray(p.options) && p.options.length === 4) || p.text || p.tableRows)) parsed = p;
  }

  if (!parsed) {
    const msg = lastError?.status === 429
      ? "AI quota/rate limit reached. Wait a minute and try again."
      : `The AI didn't return a usable question${lastError ? ` (error ${lastError.status || 0})` : ""}. Try again.`;
    return res.status(502).json({ message: msg });
  }

  // Apply everything the AI rebuilt (shared with the bulk "Regenerate all" job).
  const set = buildRegenSet(q, parsed, { fixOptions, extendQuestion, shuffleOptions });
  if (!Object.keys(set).length) return res.status(502).json({ message: "The AI did not return any usable changes. Try again." });

  await Question.updateOne({ _id: q._id }, { $set: set });
  res.json({
    _id: q._id,
    text: set.text ?? q.text,
    options: set.options || q.options,
    correct: set.correct ?? q.correct,
    explanation: set.explanation ?? q.explanation,
    optionExplanations: set.optionExplanations || q.optionExplanations,
    tableRows: set.tableRows || q.tableRows,
    columnA: set.columnA || q.columnA, // reflect reshuffled columns in the live preview
    columnB: set.columnB || q.columnB,
    assertion: set.assertion ?? q.assertion, // reflect recovered A/R in the live preview
    reason: set.reason ?? q.reason,
  });
}


/* --------------------------- AI key management (admin) --------------------------- */

const maskKey = (k) => {
  const s = String(k || "");
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
};

// Never send the raw key to the browser — only a masked hint + metadata.
function keyToClient(k) {
  return {
    _id: k._id,
    label: k.label || "",
    baseUrl: k.baseUrl,
    models: k.models,
    enabled: k.enabled,
    order: k.order,
    keyMask: maskKey(k.key),
    lastStatus: k.lastStatus || "",
    lastError: k.lastError || "",
    lastCheckedAt: k.lastCheckedAt || null,
    usedRequests: k.usedRequests || 0,
    usedTokens: k.usedTokens || 0,
    creditLimit: k.creditLimit || 0,
  };
}

// The key pool a request manages: admin → platform keys (owner null); a client
// → only their OWN keys. All key-management queries are scoped by this so a
// client can never see or touch platform keys (or another client's keys).
function keyOwner(req) {
  return req.user?.role === "client" ? req.user._id : null;
}

// GET /api/ai/keys — DB keys (editable). For the admin these are the platform
// keys plus the read-only env-var keys; for a client, only their own keys.
export async function listKeys(req, res) {
  const owner = keyOwner(req);
  const isAdmin = req.user?.role === "admin";
  const db = await AiKey.find({ owner: owner ?? null }).sort("order createdAt").lean();
  const dbList = db.map((k) => ({ ...keyToClient(k), source: "db" }));

  // Env-var keys are part of the PLATFORM pool only — never shown to clients.
  const dbKeyValues = new Set(db.map((k) => (k.key || "").trim()));
  const envList = (isAdmin ? envProviders() : [])
    .map((p, i) => ({
      _id: `env-${i + 1}`,
      source: "env",
      readOnly: true, // configured in Render — import it to manage from the UI
      label: i === 0 ? "Server key · AI_API_KEY" : `Server key · AI_API_KEY_${i + 1}`,
      baseUrl: p.baseUrl,
      models: p.models.join(", "),
      key: p.key, // used only to import; stripped before sending below
      keyMask: maskKey(p.key),
      enabled: true,
      lastStatus: "",
      lastError: "",
      lastCheckedAt: null,
      usedRequests: 0,
      usedTokens: 0,
      creditLimit: 0,
    }))
    .filter((p) => !dbKeyValues.has(p.key))
    .map(({ key, ...rest }) => rest); // never send the raw key to the browser

  const models = (await modelRegistry({ owner: owner ?? null, includeEnv: isAdmin })).map((r) => r.model);

  // Aggregate usage across the DB keys (app-tracked — providers don't expose
  // real remaining credits). creditLimit is a manual token budget the admin
  // enters, so remaining = sum(creditLimit) − sum(usedTokens) for limited keys.
  const totalRequests = db.reduce((s, k) => s + (k.usedRequests || 0), 0);
  const totalTokens = db.reduce((s, k) => s + (k.usedTokens || 0), 0);
  const limited = db.filter((k) => (k.creditLimit || 0) > 0);
  const totalCredits = limited.reduce((s, k) => s + (k.creditLimit || 0), 0);
  const usedOnLimited = limited.reduce((s, k) => s + (k.usedTokens || 0), 0);
  const totalRemaining = Math.max(0, totalCredits - usedOnLimited);

  res.json({
    keys: [...dbList, ...envList],
    models,
    totals: {
      totalRequests,
      totalTokens,
      totalCredits, // sum of manual credit limits (0 if none set)
      totalRemaining, // credits − used, only counting keys that have a limit
      hasLimits: limited.length > 0,
    },
  });
}

// POST /api/ai/keys (admin)
export async function createKey(req, res) {
  const { label, baseUrl, models, key, creditLimit } = req.body || {};
  if (!key || !String(key).trim()) return res.status(400).json({ message: "API key is required." });
  const owner = keyOwner(req);
  const order = await AiKey.countDocuments({ owner: owner ?? null });
  const doc = await AiKey.create({
    owner,
    label: String(label || "").trim(),
    baseUrl: String(baseUrl || "").trim() || "https://generativelanguage.googleapis.com/v1beta/openai",
    models: String(models || "").trim() || "gemini-2.5-flash",
    key: String(key).trim(),
    creditLimit: Math.max(0, parseInt(creditLimit, 10) || 0),
    enabled: true,
    order,
  });
  res.status(201).json(keyToClient(doc));
}

// POST /api/ai/keys/bulk (admin) — add MANY keys in one go, all sharing the same
// provider preset (baseUrl / models / creditLimit). Accepts `keys` as an array
// OR a single string with keys separated by newlines, commas or spaces. Blank
// entries, duplicates within the paste, and keys already stored are skipped.
export async function bulkCreateKeys(req, res) {
  const { keys, baseUrl, models, creditLimit, label } = req.body || {};
  const raw = Array.isArray(keys) ? keys : String(keys || "").split(/[\s,]+/);

  // Clean + de-duplicate the pasted keys (API keys never contain spaces/commas).
  const cleaned = [];
  const seenInput = new Set();
  for (const k of raw) {
    const v = String(k || "").trim();
    if (!v || seenInput.has(v)) continue;
    seenInput.add(v);
    cleaned.push(v);
  }
  if (!cleaned.length) return res.status(400).json({ message: "Paste at least one API key." });

  const owner = keyOwner(req);
  // De-dupe within THIS pool only (a client's key list, or the platform's).
  const existing = new Set((await AiKey.find({ owner: owner ?? null }).select("key").lean()).map((k) => (k.key || "").trim()));
  const baseUrlClean =
    String(baseUrl || "").trim() || "https://generativelanguage.googleapis.com/v1beta/openai";
  const modelsClean = String(models || "").trim() || "gemini-2.5-flash";
  const limitClean = Math.max(0, parseInt(creditLimit, 10) || 0);
  const labelBase = String(label || "").trim();

  let order = await AiKey.countDocuments({ owner: owner ?? null });
  const created = [];
  let skipped = 0;
  for (const key of cleaned) {
    if (existing.has(key)) { skipped += 1; continue; }
    const doc = await AiKey.create({
      owner,
      label: labelBase ? `${labelBase} ${created.length + 1}` : "",
      baseUrl: baseUrlClean,
      models: modelsClean,
      key,
      creditLimit: limitClean,
      enabled: true,
      order: order++,
    });
    existing.add(key);
    created.push(keyToClient(doc));
  }
  res.status(201).json({ created: created.length, skipped, keys: created });
}

// PUT /api/ai/keys/:id (admin) — key is only replaced when a new one is provided.
export async function updateKey(req, res) {
  const { label, baseUrl, models, enabled, key, order, creditLimit, resetUsage } = req.body || {};
  const patch = {};
  if (label !== undefined) patch.label = String(label).trim();
  if (baseUrl !== undefined) patch.baseUrl = String(baseUrl).trim();
  if (models !== undefined) patch.models = String(models).trim();
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (order !== undefined) patch.order = parseInt(order, 10) || 0;
  if (key !== undefined && String(key).trim()) patch.key = String(key).trim();
  if (creditLimit !== undefined) patch.creditLimit = Math.max(0, parseInt(creditLimit, 10) || 0);
  // Let the admin zero the app-tracked usage counters (e.g. after a quota reset).
  if (resetUsage) { patch.usedRequests = 0; patch.usedTokens = 0; }
  // Scope by owner so a client can only edit their OWN keys (and admin only
  // platform keys) — never each other's.
  const doc = await AiKey.findOneAndUpdate({ _id: req.params.id, owner: keyOwner(req) ?? null }, patch, { new: true });
  if (!doc) return res.status(404).json({ message: "Key not found" });
  res.json(keyToClient(doc));
}

// GET /api/ai/keys/:id/reveal — return the RAW key so the owner can view/copy it
// in the edit modal. Scoped by owner (a client only sees their own keys; admin
// only platform keys), so no one can reveal another owner's key. Env/server
// keys aren't stored in the DB and so are never revealed here.
export async function revealKey(req, res) {
  const doc = await AiKey.findOne({ _id: req.params.id, owner: keyOwner(req) ?? null }).lean();
  if (!doc) return res.status(404).json({ message: "Key not found" });
  res.json({ key: (doc.key || "").trim() });
}

// DELETE /api/ai/keys/:id — scoped to the caller's own pool.
export async function deleteKey(req, res) {
  const doc = await AiKey.findOneAndDelete({ _id: req.params.id, owner: keyOwner(req) ?? null });
  if (!doc) return res.status(404).json({ message: "Key not found" });
  res.json({ message: "Key deleted" });
}

// Fetch the model ids a key can use (OpenAI-compatible /models). Returns [].
async function fetchModels(key, baseUrl) {
  try {
    const resp = await fetch(`${(baseUrl || DEFAULT_BASE).replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    return (Array.isArray(data?.data) ? data.data : [])
      .map((m) => String(m?.id || "").replace(/^models\//, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Choose a sensible default model from a list. Prefers FREE options first (so we
// never auto-select a paid model), then light "flash"/"mini" chat models.
function pickPreferredModel(models) {
  if (!models.length) return "";
  const pref = [/:free$/i, /gemini[.\-\d]*flash/i, /flash/i, /gpt-4o-mini/i, /mini/i, /haiku/i, /chat/i];
  for (const rx of pref) {
    const hit = models.find((m) => rx.test(m) && !/embed|vision|image|whisper|tts|audio/i.test(m));
    if (hit) return hit;
  }
  return models.find((m) => !/embed|image|whisper|tts|audio/i.test(m)) || models[0];
}

// Live-test one key doc: updates lastStatus and returns whether it worked.
// Turn a raw provider error body into a SHORT, actionable message so a "Not
// working" key tells the admin exactly what to fix (instead of dumping raw JSON
// like `[{ "error": ... }]`). Handles the common Gemini 403 causes.
function explainKeyError(status, detail) {
  let msg = "";
  try {
    const j = JSON.parse(detail);
    const e = Array.isArray(j) ? j[0]?.error : (j?.error || j);
    msg = e?.message || e?.status || "";
  } catch { msg = String(detail || "").replace(/\s+/g, " ").trim(); }
  const low = msg.toLowerCase();
  if (status === 403 && /(has not been used|is disabled|service_disabled|enable it|not enabled|activate)/.test(low))
    return "Generative Language API is disabled for this key's Google Cloud project. Enable it in the Cloud console — or simplest, recreate the key at aistudio.google.com/apikey (that enables the API automatically).";
  if ((status === 403 || status === 400) && /(api key not valid|api_key_invalid|invalid api key|permission denied|caller does not have permission)/.test(low))
    return "This API key is invalid or restricted. Recreate it at aistudio.google.com/apikey with no API/website (referrer) restrictions.";
  if (status === 403)
    return `Access denied (403)${msg ? `: ${msg.slice(0, 110)}` : ""}. The key is likely restricted or its API isn't enabled — recreate it at aistudio.google.com/apikey.`;
  return `HTTP ${status || 0}: ${(msg || String(detail || "")).slice(0, 150)}`;
}

// AUTO-REPAIR: if the configured model is invalid (404), find a valid model for
// this key and switch to it automatically, so a valid key never stays "broken".
async function runKeyTest(doc) {
  let model = (doc.models || "").split(",").map((m) => m.trim()).filter(Boolean)[0] || "gpt-4o-mini";
  const baseUrl = (doc.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  let r = await callProvider({ key: doc.key, baseUrl, model, userPrompt: "Reply with the word ok.", maxTokens: 5, timeoutMs: 20000 });

  if (!r.ok && r.status === 404) {
    const picked = pickPreferredModel(await fetchModels(doc.key, baseUrl));
    if (picked && picked !== model) {
      doc.models = picked; // remember the working model on this key
      model = picked;
      r = await callProvider({ key: doc.key, baseUrl, model, userPrompt: "Reply with the word ok.", maxTokens: 5, timeoutMs: 20000 });
    }
  }

  // A 429 (or a quota/rate-limit message) means the key AND model are VALID —
  // they're just throttled right now. Don't mark that as "not working"; flag it
  // as rate-limited so the badge matches what auto-detect concluded.
  const rateLimited = !r.ok && (r.status === 429 || /quota|rate.?limit|exhausted|resource has been exhausted/i.test(r.detail || ""));
  if (r.ok) {
    doc.lastStatus = "ok";
    doc.lastError = "";
  } else if (rateLimited) {
    doc.lastStatus = "limited";
    doc.lastError = "Valid key, but it was rate-limited / out of quota during the test. Per-minute limits clear in about a minute; free daily quota resets the next day.";
  } else {
    doc.lastStatus = "error";
    doc.lastError = explainKeyError(r.status, r.detail);
  }
  doc.lastCheckedAt = new Date();
  await doc.save();
  return doc.lastStatus !== "error";
}

// Order candidate models best-FIRST for auto-detect, preferring the most
// CAPABLE ("higher") models the key supports (opus/sonnet/gpt-4o/gpt-4.x/
// gemini-pro/70b+/large), then lighter flash/mini/free ones only as a fallback.
// Non-chat modalities (embeddings, image, audio, …) are dropped.
function rankModels(models) {
  const clean = (models || []).filter((m) => m && !/embed|vision|image|whisper|tts|audio|moderation|rerank|dall|diffusion/i.test(m));
  const strong = [/opus/i, /sonnet/i, /gpt-4o(?!-?mini)/i, /gpt-4\.\d/i, /gpt-4(?!o|-?mini)/i, /gemini[.\-\d]*pro/i, /\b(70|72|405)b\b/i, /large|ultra|max/i];
  const light = [/flash/i, /mini/i, /haiku/i, /:free$/i, /\b\d{1,2}b\b/i, /small|lite|nano/i, /chat/i];
  const score = (m) => {
    const s = strong.findIndex((rx) => rx.test(m));
    if (s !== -1) return s;                                 // strongest models first
    const l = light.findIndex((rx) => rx.test(m));
    return strong.length + (l === -1 ? light.length : l);   // lighter ones after
  };
  return clean.map((m) => ({ m, s: score(m) })).sort((a, b) => a.s - b.s).map((x) => x.m);
}

// Order candidate models for DETECTION so the ones most likely to work on a FREE
// tier are tried FIRST: light/cheap models (flash-lite, flash, ":free", mini,
// lite/nano/small, haiku) BEFORE the heavy ones (pro/opus/large), which on free
// tiers are quota-starved. Trying a light model first usually succeeds on the
// FIRST call — so we don't fire a burst of probes (e.g. against gemini-2.5-pro)
// that trips the key's own per-minute limit and makes a perfectly good, freshly
// added key look "rate-limited".
function orderForDetection(models) {
  const clean = (models || []).filter((m) => m && !/embed|vision|image|whisper|tts|audio|moderation|rerank|dall|diffusion/i.test(m));
  const pref = [/flash[.\-]?lite/i, /flash/i, /:free$/i, /lite|nano|small/i, /mini/i, /haiku/i, /chat/i];
  const score = (m) => { const i = pref.findIndex((rx) => rx.test(m)); return i === -1 ? pref.length : i; };
  return clean.map((m) => ({ m, s: score(m) })).sort((a, b) => a.s - b.s).map((x) => x.m);
}

// Auto-find a WORKING model for a key: list the models it can use, then live-
// test them LIGHTEST-first until one replies ok, and store that model on the key.
// A model that only hits a rate limit (429/quota) is still valid, so it's kept
// as a fallback if nothing replies ok. Returns { ok, model, tried, limited }.
async function autoDetectModel(doc) {
  const baseUrl = (doc.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  let candidates = await fetchModels(doc.key, baseUrl);
  if (!candidates.length) {
    // Provider didn't list models → try the configured one(s), then common ids.
    candidates = (doc.models || "").split(",").map((m) => m.trim()).filter(Boolean);
    if (!candidates.length) candidates = ["gpt-4o-mini", "gemini-2.5-flash", "llama-3.3-70b-versatile", "deepseek-chat"];
  }
  // Probe light models FIRST (see orderForDetection) so a healthy key goes Active
  // on the very first call instead of burning its per-minute quota on heavy models.
  const ordered = orderForDetection(candidates);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isRate = (r) => r.status === 429 || /quota|rate.?limit|exhausted/i.test(r.detail || "");
  // First rate-limited model becomes the fallback — since we go lightest-first,
  // the first one is the lightest (most free-quota-friendly) choice.
  let limited = "";
  let denied = null; // a 401/403 → the whole key/project is refused (see below)
  let tried = 0;
  let retried = false; // at most ONE short 429 retry per key, so a big pool stays fast
  for (const model of ordered.slice(0, 6)) {
    tried += 1;
    // eslint-disable-next-line no-await-in-loop
    let r = await callProvider({ key: doc.key, baseUrl, model, userPrompt: "Reply with the word ok.", maxTokens: 5, timeoutMs: 20000 });
    // A per-minute 429 clears in seconds. Retry the SAME model ONCE per key (short
    // wait) so a fresh, healthy key isn't wrongly flagged rate-limited — but only
    // once, so a genuinely spent key doesn't stall the whole run.
    if (!r.ok && isRate(r) && !retried) {
      retried = true;
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(retryWaitMs(null, r.detail) || 3000, 5000));
      // eslint-disable-next-line no-await-in-loop
      r = await callProvider({ key: doc.key, baseUrl, model, userPrompt: "Reply with the word ok.", maxTokens: 5, timeoutMs: 20000 });
    }
    if (r.ok) {
      doc.models = model;
      doc.lastStatus = "ok";
      doc.lastError = "";
      doc.lastCheckedAt = new Date();
      await doc.save();
      return { ok: true, model, tried };
    }
    // 401/403 = the KEY/PROJECT is denied (invalid key, API not enabled, or key
    // restricted). No model will fix that, so stop immediately instead of
    // pointlessly probing the rest — this is the big speed-up for bad keys.
    if (r.status === 401 || r.status === 403) { denied = r; break; }
    if (!limited && isRate(r)) limited = model; // lightest (tried first)
    // eslint-disable-next-line no-await-in-loop
    await sleep(120); // light spacing; the first probe usually already succeeded
  }
  if (denied) {
    doc.lastStatus = "error";
    doc.lastError = `HTTP ${denied.status}: ${(denied.detail || "").slice(0, 150)}`;
    doc.lastCheckedAt = new Date();
    await doc.save();
    return { ok: false, model: "", tried, denied: true };
  }
  if (limited) {
    doc.models = limited;
    // Honest status: the key is valid but couldn't complete the test because it
    // was rate-limited. Matches what the Test button reports.
    doc.lastStatus = "limited";
    doc.lastError = "Valid key set to a light model, but it was rate-limited / out of quota during detection. It should work once quota is available.";
    doc.lastCheckedAt = new Date();
    await doc.save();
    return { ok: true, model: limited, tried, limited: true };
  }
  doc.lastStatus = "error";
  doc.lastError = "No working model found for this key.";
  doc.lastCheckedAt = new Date();
  await doc.save();
  return { ok: false, model: "", tried };
}

// POST /api/ai/keys/:id/auto-model — auto-detect + set a working model on a key.
export async function autoDetectKeyModel(req, res) {
  const doc = await AiKey.findOne({ _id: req.params.id, owner: keyOwner(req) ?? null });
  if (!doc) return res.status(404).json({ message: "Key not found" });
  const result = await autoDetectModel(doc);
  res.json({ ...result, models: doc.models, status: doc.lastStatus, error: doc.lastError });
}

// POST /api/ai/keys/import (admin) — copy Render env-var keys into the DB so they
// become fully manageable (test/edit/delete). Skips keys already imported.
export async function importEnvKeys(req, res) {
  // Env keys belong to the PLATFORM pool (owner null) and this route is
  // admin-only, so scope the de-dupe/order to platform keys.
  const existing = new Set((await AiKey.find({ owner: null }).select("key").lean()).map((k) => (k.key || "").trim()));
  let order = await AiKey.countDocuments({ owner: null });
  let imported = 0;
  for (const p of envProviders()) {
    if (existing.has(p.key)) continue;
    await AiKey.create({
      owner: null,
      label: "Imported from server",
      baseUrl: p.baseUrl,
      models: p.models.join(", "),
      key: p.key,
      enabled: true,
      order: order++,
    });
    imported += 1;
  }
  res.json({ imported });
}

// POST /api/ai/keys/set-enabled-all — enable OR disable every key in the caller's
// pool at once. Body: { enabled: boolean }. Handy to switch everything off and
// then re-enable only the key(s) you actually want to generate with.
export async function setAllKeysEnabled(req, res) {
  const enabled = !!req.body?.enabled;
  const { modifiedCount } = await AiKey.updateMany({ owner: keyOwner(req) ?? null }, { $set: { enabled } });
  res.json({ enabled, updated: modifiedCount });
}

// POST /api/ai/keys/test-all — test every DB key in the caller's pool.
// Free tiers cap requests-per-minute, and keys created under the SAME Google
// account/project share that cap — so testing every key back-to-back makes valid
// keys report "rate-limited". We PACE the tests in small batches with a gap
// between them (spreading requests across the minute), then give any key that
// still came back rate-limited ONE more try after a pause — a 429 means the key
// is VALID but momentarily over quota, so a short wait often lets it turn
// "Active" instead of leaving a misleading wall of "Rate-limited".
export async function testAllKeys(req, res) {
  const keys = await AiKey.find({ owner: keyOwner(req) ?? null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BATCH = 4; // keys tested in parallel per batch
  const GAP_MS = 1500; // pause between batches so we don't burst the per-minute cap
  const runBatched = async (list) => {
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(list.slice(i, i + BATCH).map((doc) => runKeyTest(doc)));
      if (i + BATCH < list.length) await sleep(GAP_MS);
    }
  };
  await runBatched(keys);
  // Second chance for the rate-limited (valid) keys once the per-minute window
  // has had time to refill. Bounded so the request still returns promptly.
  const limited = keys.filter((k) => k.lastStatus === "limited");
  if (limited.length) {
    await sleep(15000);
    await runBatched(limited);
  }
  const stillLimited = keys.filter((k) => k.lastStatus === "limited").length;
  res.json({ tested: keys.length, limited: stillLimited });
}

// POST /api/ai/keys/auto-model-all — like "Test all", but also AUTO-PICKS the
// best working model for EVERY key in the caller's pool, all at once. Each key's
// detection (list its models → live-test best-first → store the one that works)
// runs in PARALLEL so a large pool finishes quickly. Returns a per-key summary.
export async function autoDetectAllKeys(req, res) {
  const keys = await AiKey.find({ owner: keyOwner(req) ?? null });
  // Detect several keys at a time. A narrower fan-out (vs a big burst) keeps us
  // under the free per-minute request cap — important when multiple keys share
  // one Google account/project — so valid keys aren't wrongly flagged
  // rate-limited. Each key's detection is fast (bad keys bail out on 401/403), so
  // this still finishes a large pool quickly.
  const CONCURRENCY = 4;
  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < keys.length) {
      const doc = keys[idx++];
      try {
        const r = await autoDetectModel(doc);
        results.push({ id: doc._id, ok: !!r.ok, model: doc.models, limited: !!r.limited });
      } catch {
        results.push({ id: doc._id, ok: false, model: doc.models });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length || 1) }, worker));
  const ok = results.filter((r) => r.ok).length;
  res.json({ total: keys.length, ok, failed: keys.length - ok, results });
}

// POST /api/ai/keys/:id/models (admin) — ask the provider which models THIS key
// can actually use (OpenAI-compatible /models list). Fixes "404 model not found"
// guesswork by showing valid ids to choose from.
export async function listKeyModels(req, res) {
  const doc = await AiKey.findOne({ _id: req.params.id, owner: keyOwner(req) ?? null });
  if (!doc) return res.status(404).json({ message: "Key not found" });
  const baseUrl = (doc.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  try {
    const resp = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${doc.key}` } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return res.status(resp.status).json({ message: data?.error?.message || `HTTP ${resp.status}` });
    const models = (Array.isArray(data?.data) ? data.data : [])
      .map((m) => String(m?.id || "").replace(/^models\//, "")) // strip Google's "models/" prefix
      .filter(Boolean)
      .sort();
    res.json({ models });
  } catch (e) {
    res.status(502).json({ message: e.message || "Could not list models for this key." });
  }
}

// POST /api/ai/keys/:id/test (admin) — makes a tiny live call to check the key.
export async function testKey(req, res) {
  const doc = await AiKey.findOne({ _id: req.params.id, owner: keyOwner(req) ?? null });
  if (!doc) return res.status(404).json({ message: "Key not found" });
  const ok = await runKeyTest(doc);
  res.json({ ok, status: doc.lastStatus, error: doc.lastError, lastCheckedAt: doc.lastCheckedAt });
}


/* --------------------------- Client AI access & mode --------------------------- */

// GET /api/ai/access — the current user's AI configuration, used to drive the
// client "AI" tab: whether they have access, which pools they may use, their
// chosen mode, how many of their own keys exist, and whether built-in AI is
// actually available. Admins always have full built-in access.
export async function getAiAccess(req, res) {
  const user = req.user;
  if (!user || user.role !== "client") {
    const inbuiltKeys = (await providers(SYSTEM_SCOPE)).length;
    return res.json({ role: user?.role || "guest", access: true, mode: "inbuilt", allowInbuilt: true, allowSelf: false, ownKeys: 0, inbuiltAvailable: inbuiltKeys > 0, inbuiltKeys });
  }
  const scope = resolveScope(user);
  const allowInbuilt = user.aiAllowInbuilt !== false;
  const allowSelf = user.aiAllowSelf !== false;
  const [ownKeys, inbuiltKeys] = await Promise.all([
    AiKey.countDocuments({ owner: user._id }),
    allowInbuilt ? providers(SYSTEM_SCOPE).then((p) => p.length) : Promise.resolve(0),
  ]);
  res.json({
    role: "client",
    access: user.aiAccess === true && !scope.denied,
    mode: scope.denied ? null : scope.mode,
    allowInbuilt,
    allowSelf,
    ownKeys,
    inbuiltAvailable: allowInbuilt && inbuiltKeys > 0,
    inbuiltKeys,
  });
}

// PUT /api/ai/mode — a client picks which pool to use ("inbuilt" | "self"),
// within what the admin allows. No-op for non-clients.
export async function setAiMode(req, res) {
  const user = req.user;
  if (!user || user.role !== "client") return res.status(403).json({ message: "Only client accounts can set an AI mode." });
  if (!user.aiAccess) return res.status(403).json({ message: "AI access is not enabled for your account." });
  const mode = req.body?.mode === "self" ? "self" : "inbuilt";
  if (mode === "self" && user.aiAllowSelf === false) return res.status(400).json({ message: "Your own API keys are not permitted for this account." });
  if (mode === "inbuilt" && user.aiAllowInbuilt === false) return res.status(400).json({ message: "Built-in AI is not permitted for this account." });
  user.aiMode = mode;
  await user.save();
  res.json({ mode: user.aiMode });
}


// ---------------------------------------------------------------------------
// AI "deep check" — match pasted questions to the bank by MEANING, not words.
// The lexical checker (POST /api/questions/check) finds questions that share
// key words. This endpoint asks the model whether a candidate tests the SAME
// underlying fact/concept as the pasted question EVEN WHEN the wording, the
// options, or the whole FORMAT differs (a plain MCQ vs. a matching / pair /
// assertion–reason / statement version of the same content). It is opt-in
// (the admin ticks "Deep check with AI") because it spends AI quota.
// ---------------------------------------------------------------------------
const SEMANTIC_CHECK_SYSTEM =
  "You are a strict exam-question matcher. You are given ONE question a teacher pasted and a numbered list of CANDIDATE questions taken from their question bank. Candidates may be in ANY format: plain MCQ, matching (two columns), pair / pair-count, assertion–reason, statement-based, or table. " +
  "For EACH candidate decide whether it tests the SAME underlying fact, concept or answer as the pasted question — even if the wording, the options, or the entire FORMAT is different. Ignore phrasing, option order and question type; judge ONLY the knowledge being tested. " +
  "Verdicts: \"same\" = it tests the same specific fact/answer (a genuine duplicate of the CONTENT, in any format); \"related\" = same topic and closely connected but a different specific fact; \"different\" = unrelated or only superficially similar. " +
  "Reply with ONLY minified JSON — no prose, no markdown, no code fences — in exactly this shape: {\"matches\":[{\"i\":<candidate number>,\"verdict\":\"same|related|different\"}]}. Include an entry for every candidate you judge \"same\" or \"related\"; you may omit the \"different\" ones.";

// One-line searchable/AI-readable rendering of a bank question's FULL content
// (stem + assertion/reason + both columns + options), truncated for the prompt.
function candidateContent(c) {
  const parts = [
    c.text,
    c.assertion ? `Assertion: ${c.assertion}` : "",
    c.reason ? `Reason: ${c.reason}` : "",
    Array.isArray(c.columnA) && c.columnA.length ? `Column A: ${c.columnA.join("; ")}` : "",
    Array.isArray(c.columnB) && c.columnB.length ? `Column B: ${c.columnB.join("; ")}` : "",
    Array.isArray(c.options) && c.options.length ? `Options: ${c.options.join(" | ")}` : "",
  ].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
}

// Parse the model's verdict JSON robustly (tolerates code fences / stray prose).
// Returns [{ i, verdict }] with i in range and verdict in {same, related}.
function parseSemanticVerdicts(content, maxIndex) {
  if (!content) return [];
  let txt = String(content).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let obj = null;
  try { obj = JSON.parse(txt); } catch { /* fall through */ }
  if (!obj) {
    const s = txt.indexOf("{");
    const e = txt.lastIndexOf("}");
    if (s !== -1 && e > s) { try { obj = JSON.parse(txt.slice(s, e + 1)); } catch { /* ignore */ } }
  }
  const arr = obj && Array.isArray(obj.matches) ? obj.matches : [];
  const out = [];
  const seen = new Set();
  for (const m of arr) {
    const i = Number(m && m.i);
    const v = String((m && m.verdict) || "").toLowerCase();
    if (!Number.isInteger(i) || i < 0 || i >= maxIndex || seen.has(i)) continue;
    if (v !== "same" && v !== "related") continue;
    seen.add(i);
    out.push({ i, verdict: v });
  }
  return out;
}

const semNorm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// POST /api/ai/check-semantic  { content? , stems?[] , model? , mode? }
// Same response shape as POST /api/questions/check, but matches are decided by
// the AI (by meaning, across formats) instead of by shared words.
export async function checkQuestionsSemantic(req, res) {
  const scope = resolveScope(req.user, req.body?.mode);
  if (scope.denied) {
    return res.status(403).json({ message: "AI access is not enabled for your account. Please contact the administrator." });
  }
  const chosen = await resolveModel(String(req.body?.model || "").trim(), scope);
  if (!chosen || !chosen.endpoints.length) {
    return res.status(400).json({
      message: scope.mode === "self"
        ? "No API keys added yet. Add at least one key in the AI tab."
        : "AI is not configured. Add an API key in Admin → AI Keys.",
    });
  }

  const own = ownerFilter(req);
  const provided = Array.isArray(req.body?.stems)
    ? req.body.stems.map((s) => String(s || "").trim()).filter((s) => s.length >= 8).map((s) => ({ stem: s, block: s }))
    : null;
  // AI mode is capped tighter than the lexical checker (each item costs one AI
  // call) so a huge paste can't blow the request timeout or the quota.
  const items = (provided && provided.length ? provided : splitIntoStems(req.body?.content)).slice(0, 25);
  if (!items.length) {
    return res.status(400).json({ message: "Paste at least one question (or upload a file) to check." });
  }

  // For each pasted question: shortlist candidates from the bank with the text
  // index, then let the AI decide which of them are the SAME content.
  const perItem = async ({ stem, block }) => {
    const fullContent = contentOfBlock(block);
    const searchText = (fullContent || stem).slice(0, 400);
    let candidates = [];
    try {
      candidates = await Question.find(
        { $text: { $search: searchText }, ...own },
        { score: { $meta: "textScore" }, text: 1, type: 1, options: 1, columnA: 1, columnB: 1, assertion: 1, reason: 1 }
      ).sort({ score: { $meta: "textScore" } }).limit(12).lean();
    } catch {
      candidates = [];
    }
    if (!candidates.length) {
      // Keyword fallback so a paste still finds candidates when the text index
      // scores nothing (e.g. very short stems).
      const words = [...contentTokens(fullContent || stem)].slice(0, 10).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (words.length) {
        candidates = await Question.find({ text: new RegExp(words.join("|"), "i"), ...own })
          .select("text type options columnA columnB assertion reason").limit(12).lean();
      }
    }
    if (!candidates.length) return { stem, block, matches: [] };

    const list = candidates.map((c, i) => `[${i}] (${c.type || "mcq"}) ${candidateContent(c)}`).join("\n");
    const userPrompt =
      `PASTED QUESTION:\n${String(block || stem).slice(0, 900)}\n\n` +
      `CANDIDATES:\n${list}\n\n` +
      "Return JSON only, using the candidate numbers in [brackets].";
    const r = await callWithFallback({
      endpoints: chosen.endpoints,
      model: chosen.model,
      systemPrompt: SEMANTIC_CHECK_SYSTEM,
      userPrompt,
      maxTokens: 900,
      owner: scope.owner,
    });
    if (!r.ok) return { stem, block, matches: [], error: r.status || 0 };

    const verdicts = parseSemanticVerdicts(r.content, candidates.length);
    const normStem = semNorm(stem);
    const matches = verdicts.map(({ i, verdict }) => {
      const c = candidates[i];
      const isExact = verdict === "same" && normStem.length > 0 && semNorm(c.text) === normStem;
      const status = isExact ? "exact" : verdict === "same" ? "strong" : "related";
      const similarity = isExact ? 100 : verdict === "same" ? 90 : 60;
      return { id: String(c._id), status, similarity };
    });
    // Best first: exact, then same/strong, then related.
    matches.sort((a, b) => b.similarity - a.similarity);
    return { stem, block, matches };
  };

  // Bounded concurrency so we don't fire 25 AI calls at once.
  const CONCURRENCY = 4;
  const scored = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) break;
      scored[idx] = await perItem(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  // Resolve human-readable locations for every matched question in one query.
  const ids = [...new Set(scored.flatMap((s) => s.matches.map((m) => m.id)))];
  const locMap = new Map();
  if (ids.length) {
    const docs = await Question.find({ _id: { $in: ids } })
      .select("text type options correct columnA columnB assertion reason tableRows image explanation difficulty subject quiz session testSeries topic")
      .populate({ path: "subject", select: "name stream", populate: { path: "stream", select: "name" } })
      .populate({ path: "session", select: "title topic", populate: { path: "topic", select: "title" } })
      .populate("quiz", "title")
      .populate("testSeries", "name practice practiceKind")
      .lean();
    for (const d of docs) locMap.set(String(d._id), d);
  }

  const buildMatch = (m) => {
    const d = locMap.get(String(m.id));
    if (!d) return null;
    return {
      id: String(d._id),
      text: d.text,
      type: d.type,
      options: d.options || [],
      correct: d.correct,
      columnA: d.columnA || [],
      columnB: d.columnB || [],
      assertion: d.assertion,
      reason: d.reason,
      tableRows: d.tableRows,
      image: d.image,
      explanation: d.explanation,
      difficulty: d.difficulty,
      location: questionLocation(d),
      status: m.status,
      similarity: m.similarity,
    };
  };

  const summary = { exact: 0, strong: 0, related: 0, none: 0 };
  const results = scored.map((s) => {
    const matches = s.matches.map(buildMatch).filter(Boolean);
    const status = matches[0]?.status || "none";
    summary[status] += 1;
    return {
      question: s.stem,
      yourQuestion: s.block,
      status,
      similarity: matches[0]?.similarity || 0,
      matches,
      match: matches[0] || null,
    };
  });

  const found = summary.exact + summary.strong + summary.related;
  res.json({ total: items.length, found, summary, results, deep: true });
}
