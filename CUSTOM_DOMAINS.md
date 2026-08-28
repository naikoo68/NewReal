# Custom Domains for Institutes (Phase 6)

Each institute (tenant) can be reached in three ways, resolved by the backend
from the request host (sent by the browser as `X-Tenant-Host`):

1. **Subdomain** — `institute.<ROOT_DOMAIN>` (works out of the box once
   `ROOT_DOMAIN` is set and a wildcard DNS record `*.<ROOT_DOMAIN>` points at the
   frontend host).
2. **Custom domain** — the institute's own domain (e.g. `exam.brightfuture.com`).
3. **Default** — the platform's apex domain falls back to the default tenant.

## Setting a custom domain (super-admin)

Admin → **Institutes** → open an institute → **Add custom domain** → enter the
domain and save. This maps the domain to that institute in the database
(`Tenant.customDomain`, unique per institute) and the backend immediately serves
that host as the institute.

> The platform's own `ROOT_DOMAIN` (and its subdomains) can't be used as a
> custom domain.

## What the institute must do (DNS + hosting)

Mapping the domain in the app is only half of it — the domain must actually
route to the platform and be served with SSL:

1. **DNS:** point the domain at the platform frontend host.
   - Subdomain (e.g. `exam.brightfuture.com`) → **CNAME** to `app.<ROOT_DOMAIN>`
     (or whatever your frontend host expects).
   - Apex/root (e.g. `brightfuture.com`) → an **A / ALIAS** record per your host's
     instructions.
2. **Frontend host (e.g. Vercel):** add the domain to the project so it's issued
   an SSL certificate. Until the host serves the domain over HTTPS, browsers
   can't reach it.
3. Once DNS + SSL are live, visiting the custom domain loads that institute's
   branded space automatically.

## Notes

- Custom-domain mapping is managed by the **super-admin** (trusted). In-app DNS
  ownership verification is intentionally not required — a domain only reaches
  the platform if its DNS is pointed here and the host serves it, both of which
  require control of the domain.
- Removing a custom domain: open the institute, clear the field, and save.
