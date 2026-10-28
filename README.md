# Trung tâm điều khiển GitHub · GitHub Project Control Center

A private, single-user control center for every GitHub repository the authenticated account can
reach: repositories, issues, pull requests, CI, releases, activity, search, notifications,
exports, an auditable task history, and an honest status for the Arena.ai agent integration.

Interface language: **Vietnamese**. Visual style: dark developer dashboard.

- Decisions and their evidence: [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md)
- Arena agent connectivity (Phase Zero): [`docs/ARENA_AGENT_CONNECTIVITY.md`](docs/ARENA_AGENT_CONNECTIVITY.md)

---

## Current status — read this first

The specification is large. This repository contains a verified foundation, not a finished
product. Nothing below is claimed as done unless it was executed.

| Area | Status | Evidence |
| --- | --- | --- |
| Arena direct-session integration | **BLOCKED** | `docs/ARENA_AGENT_CONNECTIVITY.md`; no supported inbound trigger exists |
| Durable queue drained by the real session | **VERIFIED** (investigation artefact only) | `poc/`, issue [#1](https://github.com/coderunknow/Testing/issues/1) |
| Next.js + TypeScript foundation | **VERIFIED** | `npm run build` succeeds |
| Single-user authenticated session | **VERIFIED** | 11 passing tests; unauthenticated `/` → 307, `/api/*` → 401 |
| Cross-repository overview (repos, issues, PRs, releases, commits) | **VERIFIED** | Rendered live GitHub data for the real account |
| Integration health page | **VERIFIED** | `/health` reports each component truthfully |
| Postgres schema | **WRITTEN, NOT EXECUTED** | `db/schema.sql` — no database is provisioned yet |
| Issues / PR detail views, Projects V2, CI/CD pages, search, webhooks, exports, audit writes | **NOT IMPLEMENTED** | — |
| Production deployment | **NOT DEPLOYED** | Deferred at the user's instruction |

A row marked NOT IMPLEMENTED is a gap, not a hidden failure. There is no placeholder UI that
pretends those features exist.

---

## Architecture

```
Browser ──(signed HttpOnly cookie)──► Next.js (App Router, server components)
                                        │
                                        ├─► GitHub GraphQL/REST  (source of truth)
                                        └─► Postgres              (cache, history, audit)
```

**Why GraphQL for the overview.** A cross-repository summary costs one request instead of one
per repository, which matters against GitHub's rate limits.

**GitHub is the source of truth.** Anything cached locally carries `fetched_at` so the UI can
state freshness instead of implying the cache is live.

**The Arena request ledger has no `delivered` or `running` state on purpose.** Arena exposes no
supported inbound trigger, so those states could not be reached honestly. The schema makes the
dishonest claims unrepresentable rather than merely discouraged.

### Layout

| Path | Purpose |
| --- | --- |
| `app/` | Routes: overview, `/health`, `/login`, auth API |
| `components/Shell.tsx` | Shared chrome and navigation |
| `lib/auth.ts` | Single-user session: HMAC-SHA256 signed cookie, constant-time checks |
| `lib/github.ts` | GitHub client (GraphQL overview, REST rate limit) |
| `db/schema.sql` | Idempotent Postgres schema |
| `middleware.ts` | Deny-by-default route protection |
| `tests/` | Vitest suite |
| `poc/` | Arena queue proof of concept — **not** part of the app |

---

## Setup

```bash
npm install
cp .env.example .env      # then fill in the values
npm run dev               # http://localhost:3100
```

Generate secrets — do not reuse passwords:

```bash
openssl rand -base64 24   # APP_PASSWORD
openssl rand -base64 48   # SESSION_SECRET
```

`GITHUB_TOKEN` is a GitHub App installation token or a fine-grained PAT with read access to
repository metadata, contents, issues, pull requests, actions, and projects. Use the narrowest
scopes that cover the features you enable.

**Never paste the token into this chat, a commit, a query string, or a report.** It belongs in
the server environment only.

### Sandbox note

Inside the Arena sandbox, Node's CA store rejects the injected TLS interception while `curl`
accepts it, so outbound `fetch` fails with `unable to verify the first certificate`. Point Node
at the system trust store rather than disabling verification:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt npm run dev
```

A normal deployment does not need this.

---

## Security

- **Deny by default.** `middleware.ts` protects every route; only `/login`, `/api/login`, and
  `/api/health` are public, each because it must be.
- **Fail closed.** Without `APP_PASSWORD` and a `SESSION_SECRET` of at least 16 characters, every
  login is refused. An unconfigured app never becomes an open app.
- **Session cookie.** HttpOnly, SameSite=Lax, `Secure` in production, 12-hour lifetime, signed
  with HMAC-SHA256. Tampering, expiry, and wrong-secret signatures are covered by tests.
- **Secrets stay server-side.** No token is referenced in any client component; the health
  endpoint reports whether configuration exists, never what it is.
- **No secrets in history.** `poc/` is the only code that takes a token, and it reads from the
  environment only.
- **Untrusted content.** Repository names, issue titles, PR titles and commit messages come from
  GitHub and are rendered as text through React's escaping. No `dangerouslySetInnerHTML` is used.
- **Limitation.** Sessions are stateless, so logout clears the cookie but cannot revoke an
  already-issued token; with a 12-hour TTL the exposure window is bounded. A server-side session
  table is the upgrade path.

---

## Costs

- GitHub REST/GraphQL calls are free within the account's rate limits; the health page shows the
  remaining allowance.
- No model API is used, so there is no per-request inference cost.
- Hosting is intended for Vercel **Hobby** (free). Hobby has commercial-use restrictions, a
  monthly bandwidth cap, and serves deployments under SSO protection unless a custom domain is
  attached — relevant for how the app is reached.
- Postgres is intended for Supabase free tier. Free projects pause after inactivity; a paused
  project must be restored before the app can use it.
- **No paid resource, plan upgrade, or domain has been purchased.**

---

## Operations

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # production build
npm start           # serve the production build on :3100
```

Smoke test after any deploy:

```bash
curl -s https://<host>/api/health   # expect 200 and arena_direct_connectivity: "blocked"
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/   # expect 307 to /login
```

### Database

`db/schema.sql` is idempotent and safe to re-run. Apply it with `psql "$DATABASE_URL" -f db/schema.sql`
or paste it into the Supabase SQL editor. Default retention keeps everything until deleted;
`app_settings.retention` is where a policy would be set once retention jobs exist.

---

## Known limitations

1. **Arena agent integration is blocked** — see `docs/ARENA_AGENT_CONNECTIVITY.md`.
2. **No database provisioned**, so history, notifications, and audit logging are off. The app
   degrades honestly: it says so on `/health` rather than failing.
3. **Not deployed.** No production URL exists and none will be invented.
4. **CI/CD, Projects V2, search, webhooks, and exports are not implemented yet.**
5. **No caching layer**, so the overview calls GitHub on every load. Fine for a single user;
   the schema exists to add caching without redesign.
