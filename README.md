# Trung tâm điều khiển GitHub · GitHub Project Control Center

A private, single-user control center for every GitHub repository the authenticated account can
reach: repositories, issues, pull requests, CI, releases, activity, search, notifications,
exports, an auditable report history, and an honest status page.

Interface language: **Vietnamese**. Visual style: dark developer dashboard.

- Decisions and their evidence: [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md)
- Arena agent connectivity: [`docs/ARENA_AGENT_CONNECTIVITY.md`](docs/ARENA_AGENT_CONNECTIVITY.md)
- Arena host (dev1): [`docs/HOST.md`](docs/HOST.md)

---

## Current status — read this first

Version **0.1.0-dev2**. Compiles, lints, and passes its test suite; screens were exercised
against the live GitHub API on 2026-10-28. It is a working development build, not a
production-ready product, and it is **not deployed**.

| Area | Status | Evidence |
| --- | --- | --- |
| Dashboard with real cross-repo counts | **WORKING** | Live run: 33 repositories, exact issue/PR totals via GraphQL; `tests/queries.test.ts` |
| Repository explorer (search, filter, sort, paging, detail tabs) | **WORKING** | Live HTTP smoke: `/repos`, `/repos/coderunknow/Testing?tab=…` |
| Issues & pull requests list/detail | **WORKING** | Live pages for issue #1 and PR #63, including checks, reviews, files, commits |
| CI/CD, releases, commits/activity | **WORKING** | `/actions`, `/releases`, `/activity` |
| Search, notifications | **WORKING** | `/search` (two scoped queries), `/notifications` |
| CSV/JSON/Markdown exports | **WORKING** | Formula-injection-safe CSV with BOM; `tests/csv.test.ts`, `tests/api-export.test.ts` |
| Persistent history + audit log | **CODE VERIFIED, NOT PROVISIONED** | PGlite integration tests (`tests/db.test.ts`, `tests/api-export.test.ts`); no database exists in any environment |
| Postgres schema | **EXECUTED IN TESTS ONLY** | `db/schema.sql` applied to PGlite in tests; never applied to a real server |
| Arena host request/response loop (dev1) | **VERIFIED** | `docs/HOST.md` §7; regression tests still pass |
| Automatic recovery after a turn ends | **BLOCKED** | No supported way to start an Agent Mode turn |
| Webhooks / near-real-time updates | **NOT IMPLEMENTED** | Deliberately absent — no inbound endpoint, so no signature to verify |
| Projects V2 board views | **NOT IMPLEMENTED** | — |
| Production deployment | **NOT DEPLOYED** | Deferred at the user's instruction |

A row marked NOT IMPLEMENTED is a gap, not a hidden failure. There is no placeholder UI that
pretends those features exist, and no sample data anywhere in the interface.

---

## Screens

| Route | What it does |
| --- | --- |
| `/` | Account overview: repository count, exact open issue/PR totals, attention list, recent commits and releases, each with its fetch scope |
| `/repos` | Search, filter by visibility/language, sort, paginate; links to `/repos/[owner]/[repo]` |
| `/repos/[owner]/[repo]` | Repository detail with tabs: overview (commits), issues, pull requests, CI runs, releases |
| `/issues`, `/issues/[owner]/[repo]/[number]` | Issue list and detail with comments, labels, assignees, milestone |
| `/pulls`, `/pulls/[owner]/[repo]/[number]` | PR list and detail: review decision, reviewers, reviews, commits, changed files, check-runs |
| `/actions` | Workflow runs across the most active repositories, with success/failure breakdown |
| `/releases` | Releases across the most active repositories, drafts and prereleases included |
| `/activity` | Recent commits across repositories, plus per-repository failure reporting |
| `/search` | GitHub search over issues, PRs and repositories |
| `/notifications` | Unread notifications, grouped by reason |
| `/reports` | Export catalogue and report history |
| `/health` | Truthful per-component status: token, session, rate limit, database |
| `/api/health` | Unauthenticated liveness/config probe (no secrets) |
| `/api/export/[kind]` | CSV / JSON / Markdown download; kinds: `repos`, `issues`, `pulls`, `actions`, `releases`, `search` |
| `/api/audit` | Recent audit entries; `503` with `available:false` when no database is configured |

### Data honesty rules

These are enforced in code and covered by tests, not just conventions:

1. **No fabricated totals.** A figure derived from one page of results is labelled as a page.
   The dashboard uses per-repository GraphQL counters (`issues(states: OPEN)`,
   `pullRequests(states: OPEN)`) rather than GitHub's `open_issues_count`, which silently
   includes pull requests.
2. **No unscoped search.** A search without a `repo:` qualifier is scoped to the signed-in
   account with `involves:<login>`; without a scope it refuses to run rather than reporting
   GitHub-wide numbers as if they were yours.
3. **URLs come from the payload.** GraphQL only exposes the *API* URL for issues and PRs, so
   the web URL is built from `resourcePath`. Tests assert no `api.github.com` link is rendered.
4. **Missing permission ≠ no data.** A 403 on notifications or check-runs renders a permission
   notice, not an empty list.
5. **Missing database ≠ empty history.** Without `DATABASE_URL`, the UI says the feature is off
   and exports report `x-export-recording: skipped:no-database`.

---

## Architecture

```
Browser ──(signed HttpOnly cookie)──► Next.js (App Router, server components)
                                        │
                                        ├─► GitHub GraphQL/REST  (source of truth)
                                        └─► Postgres             (report history, audit)
```

Every screen is a server component. There is no client-side data fetching, so no GitHub token
and no GitHub response ever reaches the browser bundle; only rendered HTML does.

**GraphQL where it is accurate, REST where it is necessary.** Detail pages need `reviewDecision`,
review threads, changed files and commit lists, which REST does not provide in one call; search
and check-runs are REST-only. Each layer states what it could not fetch.

### Layout

| Path | Purpose |
| --- | --- |
| `app/` | Route tree (screens and API routes) |
| `components/` | `Shell`, shared UI primitives, error notices |
| `lib/github.ts` | Transport: classified errors, retries-free timeouts, pagination, secret scrubbing |
| `lib/queries.ts` | Typed query layer returning `PageInfo { count, truncated, scope, fetchedAt }` |
| `lib/exports.ts` | Export datasets with column whitelists |
| `lib/csv.ts` | CSV escaping (formula-injection safe), JSON/Markdown reports |
| `lib/db/` | Store interface, Postgres implementation, unavailable store, history reads |
| `lib/auth.ts` | Single-user session: HMAC-SHA256 signed cookie, constant-time checks |
| `lib/http.ts` | Proxy-aware origin and Secure-cookie detection |
| `db/schema.sql`, `db/migrate.mjs` | Idempotent Postgres schema and its applier |
| `host/` | dev1 Arena host — unchanged, still covered by its regression tests |
| `tests/` | Vitest suite (150 tests) |
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
repository metadata, contents, issues, pull requests, actions, and — for the notifications
screen — notifications. Use the narrowest scopes that cover the features you enable.

**Never paste the token into this chat, a commit, a query string, or a report.** It belongs in
the server environment only.

### Database (optional)

```bash
export DATABASE_URL=postgres://…
npm run db:migrate        # applies db/schema.sql, idempotent
```

Without `DATABASE_URL` every GitHub screen still works; only report history and the audit log
are disabled, and the UI says so.

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
- **Session cookie.** HttpOnly, SameSite=Lax, 12-hour lifetime, signed with HMAC-SHA256.
  `Secure` is derived from the request (`x-forwarded-proto`), so it is set behind an HTTPS proxy
  and not set over plain HTTP, where the browser would silently drop it.
- **Secrets stay server-side.** `tests/security.test.ts` fails the build if a file that reads
  `GITHUB_TOKEN` is also marked `'use client'`, logs the token, or places it in a URL.
- **Upstream text is scrubbed.** Error messages from GitHub are passed through `scrubSecrets`,
  which redacts `gh*_` / `github_pat_` tokens and `Bearer` values before anything is rendered.
- **Untrusted content.** Titles, bodies and commit messages are rendered as text through React's
  escaping. No `dangerouslySetInnerHTML`; a test enforces the absence.
- **CSV injection.** Cells beginning with `= + - @ \t \r` are prefixed with `'` before export.
- **Read-only.** No code path issues a mutating GitHub request; a test asserts no REST
  `POST/PATCH/PUT/DELETE` exists outside the transport module.
- **Limitation.** Sessions are stateless, so logout clears the cookie but cannot revoke an
  already-issued token; with a 12-hour TTL the exposure window is bounded.

---

## Costs

- GitHub REST/GraphQL calls are free within the account's rate limits; `/health` shows the
  remaining allowance for REST, GraphQL and Search separately.
- No model API is used, so there is no per-request inference cost.
- Hosting is intended for Vercel **Hobby** (free). Hobby has commercial-use restrictions and a
  monthly bandwidth cap.
- Postgres is intended for Supabase free tier. Free projects pause after inactivity.
- **No paid resource, plan upgrade, or domain has been purchased.**

---

## Operations

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (150 tests, includes PGlite integration)
npm run build       # production build
npm start           # serve the production build on :3100
npm run db:migrate  # apply db/schema.sql (requires DATABASE_URL)
```

Smoke test after any deploy:

```bash
curl -s https://<host>/api/health                      # 200; reports config presence only
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/   # 307 to /login
```

---

## Known limitations

1. **Arena agent integration is blocked** — see `docs/ARENA_AGENT_CONNECTIVITY.md`.
2. **No database is provisioned in any environment.** Schema and store are exercised against
   PGlite in tests; a real Postgres server has never been contacted.
3. **Not deployed.** No production URL exists and none will be invented.
4. **No webhooks, and therefore no near-real-time updates.** Every screen is a fresh read of
   GitHub at request time. Webhook signature verification, idempotency keys and replay
   protection are designed in `db/schema.sql` but unimplemented, so nothing here claims
   real-time behaviour.
5. **Projects V2 board views are not implemented** — project items are not fetched.
6. **Search cannot cover "all repositories I can reach".** GitHub search requires a repo or an
   owner/user qualifier; the app therefore scopes to one repository or to issues/PRs involving
   the signed-in account, and says which.
7. **Notifications are the unread page-1 snapshot** (max 50), not a synchronized inbox.
8. **No caching layer**, so each page load calls GitHub. Fine for a single user.
9. **Comment lists are capped** (30 on issues) and the UI states the real total when capped.
