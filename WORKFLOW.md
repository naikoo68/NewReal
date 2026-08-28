# My Study Guide — Workflow & Architecture

A practical map of how the whole app works: the pieces, how a request flows, the
roles, the content model, the API + page routes, and the main user journeys.

---

## 1. Architecture at a glance

```
        ┌─────────────────────────────────────────────┐
        │  Browser (Guest / Student / Client / Admin)  │
        └───────────────┬─────────────────────────────┘
                        │  HTTPS + JWT (Bearer token)
                        ▼
        ┌─────────────────────────────────────────────┐
        │  FRONTEND — React + Vite + Tailwind          │
        │  Hosted on Vercel  (mystudyguideme.vercel.app)│
        │  Hash routing (#/...) so refresh never 404s   │
        └───────────────┬─────────────────────────────┘
                        │  REST calls to /api/*  (fetch, see lib/api.js)
                        ▼
        ┌─────────────────────────────────────────────┐
        │  BACKEND — Node.js + Express                 │
        │  Hosted on Render  (…onrender.com/api)        │
        │  routes → controllers → models (Mongoose)     │
        └───────────────┬─────────────────────────────┘
                        │  Mongoose
                        ▼
                 MongoDB Atlas (database)

  External services the backend calls:
   • Cloudinary  — image/file uploads
   • Razorpay    — client subscription payments
   • Brevo/SMTP  — emails, OTP verification
   • AI providers (Gemini, etc.) — generate / extend / regenerate questions
```

**Note (free tier):** the Render backend sleeps after ~15 min idle; the first
request wakes it (~60–90s). The frontend retries while it wakes.

---

## 2. How one request flows

1. You act in the browser → the frontend calls an API URL (e.g. `POST /api/auth/login`).
2. The request sends your **JWT** (saved in the browser after login). The backend
   `protect` / `authorize` middleware reads it to know **who you are** and your **role**.
3. Route → controller → reads/writes **MongoDB** → returns JSON.
4. The frontend renders it. All auth is stateless (JWT), so any page can be refreshed.

Key files: `frontend/src/lib/api.js` (fetch wrapper + token + retry),
`frontend/src/services/index.js` (all API calls grouped by feature),
`backend/src/app.js` (registers every route group).

---

## 3. Roles

| Role     | What they do |
|----------|--------------|
| Guest    | Landing/about/contact, take a **public shared test** link (no account). |
| Student  | Take quizzes & tests, view dashboard, analytics, leaderboard, study material. |
| Client   | Private **"My Practice"** space — own quizzes/tests, own AI keys, self-serve subscription. |
| Admin    | Full control: content, tests, users, clients, AI, branding, coupons, payments, notices. |

Roles come from the `User.role` field; routes are gated by `ProtectedRoute`
(frontend) and `authorize()` (backend).

---

## 4. Content model (hierarchy)

```
Quizzes:      Stream → Subject → Topic → Session → Quiz → Question
Test Series:  Exam → Post → Test → Question   (Test has per-subject sections/subjectPlan)
My Practice:  Practice Stream → Practice Subject → (Topic) → My Quiz / My Test → Question
Study Material: Institution → Subject → Class → Files
```

A **Question** can belong to a quiz, a session, a subject, or a testSeries, and
carries: `type` (mcq / matching / statement / pair / pairselect / assertion /
table), `options`, `correct`, `explanation`, `optionExplanations`, plus
type-specific fields (`columnA`/`columnB`, `assertion`/`reason`, `tableRows`).
Math is written as LaTeX between `$...$`.

---

## 5. Backend API map (`/api/...`)

| Route group        | Purpose |
|--------------------|---------|
| `/auth`            | Register, login, OTP verify, Google, forgot-password, plans |
| `/` (content)      | Streams, subjects, topics, sessions, quizzes, questions (+ bulk, duplicates) |
| `/quiz/:id/submit` | Submit & grade a quiz attempt |
| `/tests`           | Test series: list, get, submit, questions, populate, public share link, access |
| `/practice`        | "My Practice": streams/subjects/topics/items, browse, my-items, play |
| `/exams`, `/posts` | Test-series hierarchy (Exam → Post) |
| `/ai`              | AI: generate, extract, notes, extend-explanation(s), regenerate-question, keys, access |
| `/users`           | Admin user management, access control |
| `/me/dashboard`, `/leaderboard`, `/admin/analytics`, `/admin/performance` | Analytics |
| `/study`           | Study material (institutions → subjects → classes → files) |
| `/documents`       | Standalone text documents (PDF/doc text extraction store) |
| `/upload`          | Cloudinary file upload |
| `/settings`        | Site branding & theme (public read, admin write) |
| `/notices`         | Scrolling notice board |
| `/messages`, `/feedback` | Contact inbox & student feedback |
| `/coupons`, `/payments`, `/subscriptions` | Discounts + Razorpay checkout + client upgrade/renew |
| `/setup`           | One-time bootstrap (auto-disabled after first admin) |
| `/health`          | Status + deployed `version` (open in a browser to verify a deploy) |

---

## 6. Frontend page map (hash routes)

**Public / student**
- `#/` Home · `#/about` · `#/contact`
- `#/quiz` → `#/quiz/stream/:streamId` → `#/quiz/:subjectId` → `.../:topicId` → `.../:sessionId` → `.../:quizId` (play) → `.../result`
- `#/test-series` → `#/test-series/:examId` → `#/test-series/:examId/:postId`
- `#/test-series/attempt/:testId` — full-screen test interface
- `#/public/test/:token` — public shared test (no login)
- `#/practice`, `#/practice/:kind/...` — browse My Quiz / My Test
- `#/study/...` — study material
- `#/login`, `#/register`, `#/client/register`, `#/forgot-password`
- `#/dashboard` — student dashboard (protected)

**Client**
- `#/client` — "My Practice" workspace (role: client)

**Admin** (`#/admin`, role: admin) — child pages:
`content`, `tests`, `practice`, `migration`, `clients`, `coupons`, `study`,
`feedback`, `users`, `performance`, `messages`, `notices`, `ai-generator`,
`documents`, `notes`, `pdf-builder`, `ai-keys`, `customization`.

---

## 7. Main user journeys

**Student takes a test**
`open test → questions load (subject order + question order + options reshuffled
per attempt) → answer → submit → graded by question _id → result + review
(review shown in the same order/options you saw)`.

**Admin builds content**
`create quiz/test → add questions via: Manual · Bulk CSV · AI Generate · Import
from web/docs · Pick from bank`. Per question in **View all**: **↻ Regenerate**
(rebuild options/answer to fit the stem, fix math rendering), **📋 Add to test**
(copy into a Test Series or My Test). Per row: **✨ Extend** (enrich + verify the
answer). Bulk **Extend Explanations** enriches every question in a quiz/test.

**Client (self-service)**
Logs in → `#/client` → builds and takes their **own** private quizzes/tests;
can use built-in AI or their own AI keys. Everything scoped to their `owner` id.

---

## 8. AI question pipeline

- **Generate / Extract** run as background **jobs**; the client polls for progress.
- Work is split into small batches and spread across **all configured API keys in
  parallel** (one worker per key), so many keys = faster and higher combined quota.
- Every question is **self-verified**: numericals are solved with the correct
  **formula step-by-step**, matching/pair/statement answers are checked item by
  item, math is wrapped in **LaTeX (`$...$`)**, and the marked answer must match
  the working.
- **Extend** enriches explanations (and fixes a wrong numerical answer);
  **Regenerate** rebuilds options/answer to fit the question. Both keep the
  structured data (columns/table) in their own fields, never in the stem.
- Free-tier keys hit rate limits (429); bulk jobs process **least-recently-updated
  first**, so clicking again continues with the not-yet-done questions.

---

## 9. Repo layout

```
backend/
  src/
    app.js            # express app, registers all routes, /api/health
    routes/*.js       # one file per feature → maps URLs to controllers
    controllers/*.js  # request handlers (business logic)
    models/*.js       # Mongoose schemas (User, Question, TestSeries, Attempt, …)
    middleware/       # auth (protect/authorize), error handling
    config/           # db, cloudinary, mailer, razorpay
frontend/
  src/
    App.jsx           # all page routes (hash router)
    pages/            # admin/, client/, quiz/, testseries/, practice/, study/, auth/
    components/       # shared UI (QuestionView, MathText, modals, layout, …)
    services/index.js # all API calls, grouped by feature
    lib/api.js        # fetch wrapper (base URL, JWT, cold-start retry)
    context/          # Auth, Theme, Settings, Zoom providers
```

---

## 10. How to verify what's deployed

- Open `https://<your-render-app>.onrender.com/api/health` — the `version` and
  `features` fields show exactly which backend build is live.
- The frontend auto-deploys from Vercel on each push to `main`; the backend
  auto-deploys from Render. Both track the `main` branch.
