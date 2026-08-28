# Deploying My Study Guide (Real Mode)

This guide publishes the **full application**: a live backend API + MongoDB database, and the frontend connected to it. You'll deploy three things:

1. **Database** → MongoDB Atlas (free)
2. **Backend API** → Render (free)
3. **Frontend** → Vercel (free)

Do them in this order.

---

## 1. Database — MongoDB Atlas

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Create a free **M0** cluster.
3. **Database Access** → add a user (username + password). Save them.
4. **Network Access** → Add IP → **Allow access from anywhere** (`0.0.0.0/0`).
5. **Connect → Drivers** → copy the connection string and insert your password and database name:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/mystudyguide?retryWrites=true&w=majority
   ```

---

## 2. Backend API — Render

1. Sign up at [render.com](https://render.com) with GitHub.
2. **New → Web Service** → connect the **My-Study-Guide** repo.
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add **Environment Variables** (Advanced → Add Environment Variable):

   | Key | Value |
   |-----|-------|
   | `MONGO_URI` | your Atlas connection string |
   | `JWT_SECRET` | any long random text |
   | `JWT_EXPIRES_IN` | `7d` |
   | `CLIENT_URL` | your Vercel URL (add after step 3, e.g. `https://mystudyguideme.vercel.app`) |
   | `NODE_ENV` | `production` |

5. Click **Create Web Service**. When it's live you'll get a URL like
   `https://my-prep-mart-api-39nk.onrender.com`.
6. Test it: open `https://my-prep-mart-api-39nk.onrender.com/api/health` → should show `{"status":"ok"}`.

### Seed the database (one time)
In Render → your service → **Shell** tab, run:
```bash
npm run seed
```
This creates sample data + the accounts:
- Admin: `admin@mystudyguide.com` / `admin123`
- Student: `student@mystudyguide.com` / `student123`

> ⚠️ Change the admin password after first login in production.

---

## 3. Frontend — Vercel

1. Sign up at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project** → import **My-Study-Guide**.
3. Configure:
   - **Root Directory:** `frontend`
   - Framework Preset: **Vite** (auto-detected)
4. Add an **Environment Variable**:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://my-prep-mart-api-39nk.onrender.com/api` |

5. Click **Deploy**. You'll get a URL like `https://mystudyguideme.vercel.app`.

### Final step — connect CORS
Go back to **Render → Environment** and set `CLIENT_URL` to your exact Vercel URL, then save (the service redeploys). This allows the browser to call the API.

---

## You're live! 🎉

- Visit your Vercel URL.
- Log in as the seeded student or admin, or register a new account.
- Quizzes, test series, dashboard analytics, leaderboard and the admin panel now read/write the real database.

## Notes & tips

- **Free Render services sleep** after inactivity; the first request may take ~30s to wake. That's normal on the free tier.
- **Image uploads (Cloudinary)** and **Google login** are optional. To enable them, add the matching keys from `backend/.env.example` to Render and configure Google OAuth.
- **Local development:** run the backend (`npm run dev` in `backend`) and frontend (`npm run dev` in `frontend`) with `VITE_API_URL=http://localhost:5000/api`. See `backend/README.md` for the API reference.


---

## Automatic deployments (every push goes live)

Both hosts are connected to this GitHub repo, so **every push to the `main` branch redeploys automatically** — no manual step. This is native Git integration; you don't need any deploy tokens or scripts in the repo.

### How it flows
```
git push  ->  GitHub (main)  ->  CI build check (.github/workflows/ci.yml)
                                   |
                                   +--> Vercel  rebuilds & deploys the frontend
                                   +--> Render  rebuilds & deploys the backend
```

### Verify it's enabled
- **Vercel** → Project → **Settings → Git**: the repo is connected and **Production Branch** is `main`. Every push to `main` publishes to production; pushes to other branches / PRs get a **Preview** URL automatically.
- **Render** → Web Service → **Settings**: **Auto-Deploy** is `Yes` and the branch is `main`. Each push triggers a new deploy.

### Safety net (CI)
`.github/workflows/ci.yml` runs on every push and PR to `main`:
- **Frontend:** `npm ci` → `npm run lint` → `npm run build`
- **Backend:** `npm ci` → syntax-check all source files

If the build fails, you'll see a red check on the commit/PR before (or alongside) the deploy — so you catch breakage early instead of shipping it.

### Optional: only rebuild what changed
By default both services rebuild on *any* push, even a docs-only change.
- **Vercel** → Settings → Git → **Ignored Build Step**: `git diff --quiet HEAD^ HEAD -- frontend` (skips the build when nothing under `frontend/` changed).
- **Render** → Settings → **Build Filters**: set included path to `backend/**`.

### Notes
- The existing `npm-publish-github-packages.yml` workflow only runs on GitHub *releases* (publishing an npm package) and is unrelated to the Vercel/Render deploys above.
- `keep-alive.yml` pings the backend every 10 minutes so the free Render instance doesn't sleep — it does **not** deploy anything.


---

## Keeping the backend awake (fixing "the website won't load")

**Symptom:** you open the site after a while and it hangs, shows a spinner, or won't log in — then works if you wait ~30–60s and refresh.

**Cause:** the free Render backend **sleeps after ~15 minutes** of no traffic. The first request has to wake it, which takes ~30–60s (a "cold start"). While it wakes, the app looks broken.

### Why the built-in keep-alive isn't enough
`keep-alive.yml` is set to ping every 5 minutes, **but GitHub throttles scheduled workflows on free/idle repos** — in practice they fire only every ~45–60 minutes. Since Render sleeps after 15 minutes, the backend still falls asleep between pings. GitHub's own docs warn that `schedule` timing is best-effort and often delayed.

### Recommended fix — UptimeRobot (free, reliable)
Set up an external monitor that pings the health endpoint every 5 minutes. Unlike GitHub's scheduler, it actually runs on time.

1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free plan is enough).
2. **Add New Monitor:**
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** My Study Guide API
   - **URL:** `https://my-prep-mart-api-39nk.onrender.com/api/health`
   - **Monitoring Interval:** 5 minutes
3. (Optional) Add your email under **Alert Contacts** so you're notified the moment the API goes down.

That's it — the backend stays warm 24/7 and cold-start "not loading" disappears. UptimeRobot also becomes your outage alarm.

> The GitHub `keep-alive.yml` can stay as a backup; it doesn't hurt.

### Is it the backend or the database?
Open `https://my-prep-mart-api-39nk.onrender.com/api/health` in a browser and read the JSON:

| What you see | Meaning |
|---|---|
| `{"status":"ok","db":"connected","dbOk":true,...}` and it loads quickly | Backend **and** database are healthy. |
| It takes ~30–60s, then shows `"status":"ok"` | Cold start — the backend was asleep (set up UptimeRobot above). |
| `{"status":"degraded","db":"disconnected"...}` or `"db":"unreachable"` (HTTP 503) | Backend is up but **can't reach MongoDB Atlas** — check that the Atlas cluster isn't **paused** (free clusters pause after ~60 days idle) or over its 512 MB storage limit, and that Network Access still allows `0.0.0.0/0`. |
| Page never responds / connection error | The **backend itself is down** — check the Render dashboard logs. |
| The Vercel page is blank white but the health URL above works | Frontend deploy problem — check the latest Vercel deployment logs. |

> The `/api/health` endpoint now reports the real database status (`db` / `dbOk`) and returns HTTP **503** when the database is unreachable, so UptimeRobot and this table can tell backend-down from database-down.
