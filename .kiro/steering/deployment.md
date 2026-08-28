---
inclusion: always
---

# Auto-deploy on every change

The user wants every requested change (update, add, fix, or modify) to be
**deployed automatically** — no need to ask first.

## How deployment works for this repo

Deployment is driven by GitHub. Both platforms auto-rebuild when `main` is pushed:

- **Frontend** → Vercel (root dir `frontend`)
- **Backend API** → Render (root dir `backend`, see `render.yaml`)

## Procedure after making a change

1. Commit the change on a working branch.
2. Fast-forward / merge it into `main`.
3. Push `main` using the push tool (raw `git push` cannot authenticate through
   the gateway — always use the GitHub power's `push_to_remote`).
4. Report the deployed commit SHA and how to verify:
   - Vercel/Render dashboards show a new deployment for that commit.
   - Backend health check: `https://<render-api>/api/health` → `{"status":"ok"}`.

## Notes

- Render free tier can take a few minutes and may cold-start (~30s) on the
  first request after a deploy.
- Frontend and backend deploy independently — if a change touches both, make
  sure both finish before judging the result.
