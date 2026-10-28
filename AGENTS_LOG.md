# AGENTS_LOG.md — implementation record: activities, verification, blockers, evidence

## 2026-10-28

### Activities

1. Inspected the repository: single `README.md` (`# Testing`, 10 bytes), one commit `926515c`,
   no branches with prior work, no stashes, no ignored files.
2. Investigated Arena connectivity across six candidate mechanisms (see
   `docs/ARENA_AGENT_CONNECTIVITY.md`).
3. Built `poc/` — a durable queue in GitHub Issues, drained by the real session — and ran it.
4. Measured sandbox network reach, GitHub credential capabilities, Vercel account state, and
   Supabase project state.
5. Built the Next.js application foundation: schema, auth, GitHub client, overview, health page,
   auth API routes, middleware, tests.

### Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** (exit 0) |
| Production build | `npm run build` | **PASS** — 7 routes compiled |
| Unit tests | `npx vitest run` | **PASS** — 11/11 |
| Unauthenticated `/` | `curl` | **307** → `/login` |
| Unauthenticated `/api/*` | `curl` | **401** |
| Wrong password | `curl -X POST /api/login` | **303** → `/login?error=1`, no cookie |
| Correct password | `curl -X POST /api/login` | **303** → `/`, session cookie set |
| Authenticated overview | `curl -b jar /` | **200**, real repositories rendered |
| Public health | `curl /api/health` | **200**, `arena_direct_connectivity: "blocked"` |
| Queue end to end | issue #1 → session → answer → site | **VERIFIED** |

### Blockers

| Blocker | Cause | Remediation |
| --- | --- | --- |
| Arena direct/unattended delivery | No supported inbound trigger exists | Requires an Arena platform capability; see DEC-006 |
| Database | No project provisioned (both Supabase projects paused); user deferred | Supply `DATABASE_URL` for a Postgres 14+ instance and run `db/schema.sql` |
| Production deployment | Deferred by user until a build is worth deploying | Create a Vercel project, set env vars, deploy |
| Local DB-path testing | Sandbox cannot reach Supabase | Test with an in-process Postgres (PGlite) and verify the deployed instance separately |

### Not verified, and therefore not claimed

- Any database-backed code path (no database exists).
- Any webhook, signature verification, polling reconciliation, or notification flow (not built).
- CI/CD, Projects V2, search, and export features (not built).
- The deployed application (not deployed).

## 2026-10-28 — v0.1.0-dev1 release increment

### Activities

1. Established repository identity before editing: `coderunknow/Testing`, default branch
   `main` at `926515c`, working branch `arena/ccae96b1-testing`, no tags, no releases, no
   PRs, no CI workflows, no readable branch protection, viewer permission ADMIN.
2. Investigated post-turn recovery against Arena's real tool surface.
3. Rewrote `host/` into `store.mjs` + `auth.mjs` + `app.mjs` + `server.mjs`.
4. Added `tests/host.test.ts` (25 tests) and a regression test for the duplicate-route bug.
5. Corrected `docs/ARENA_AGENT_CONNECTIVITY.md`; added `docs/HOST.md`; appended to
   `DESIGN_LOG.md`; updated `README.md` and `.env.example`.
6. Bumped `package.json` and `package-lock.json` to `0.1.0-dev1`; added `CHANGELOG.md` and
   `.github/workflows/ci.yml`.

### Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | see final report |
| Tests | `npx vitest run` | **36/36 PASS** |
| Build | `npm run build` | **PASS** |
| Wait timeout is not failure | `get_process_output(wait_timeout=5)` | `wait_result: "timeout"`, host still `running` |
| Request arrives while blocked | `get_process_output(wait_for=log)` | `wait_result: "satisfied"` |
| Claim ownership | second worker claim | `HTTP 409` |
| Idempotent replay | identical answer resent | `200`, `idempotent: true` |
| Host state survives restart | `SIGTERM` → restart | completed request and answer re-read |
| Host survives turn boundary | v1 host inspected in a later turn | 5/5 requests intact |
| Graceful shutdown | `SIGTERM` | listener closed, state preserved |

### Blockers

| Blocker | Cause | Status |
| --- | --- | --- |
| Automatic reactivation after a turn ends | Arena exposes no scheduler, webhook, or session API; there is no tool that can start a turn | **BLOCKED** — platform limitation |
| Context exhaustion recovery | Requires a new session; Arena offers no context transfer | **NOT TESTED** (not reproduced; would burn the live session) |
| Postgres-backed features | No `DATABASE_URL`; user deferred provisioning | **BLOCKED by decision** |

### Not claimed

Automatic recovery is not implemented and is not claimed. A human-sent message is a manual
recovery step, not automation, and is labelled as such everywhere it appears.

---

## 2026-10-28 — v0.1.0-dev2 (GitHub Project Control Center)

### Scope decision

The governing request was to build `v0.1.0-dev2` as a *working* control center — explicitly not
a version bump, a cosmetic change, or placeholder pages. Priority order applied: original
specification §1–16 and §17, then security/correctness/data constraints, then complete real
user flows, then UX, then docs/version/CI.

### Activities

1. **Preflight.** Branch `arena/e9f2eef2-testing` from `origin/main` at `2c520c4`; tags:
   `v0.1.0-dev1` only; working tree clean; baseline `tsc --noEmit` clean and **36/36** tests
   passing.
2. **Specification re-read.** §4 (repository coverage), §5.1–5.5 (dashboard), §6 (search,
   notifications, reports) read verbatim from `google_drive/PROMPT 1`. §17 exists only in
   conversation, not in the file — disclosed in the report.
3. **Library layer.** Rewrote `lib/github.ts` (classified `GitHubError`, `rest`,
   `restPaginated`, `graphql`, rate-limit buckets, `scrubSecrets`), added `lib/queries.ts`,
   `lib/csv.ts`, `lib/format.ts`, `lib/exports.ts`, `lib/http.ts`, and `lib/db/*`.
4. **Screens.** Built 21 routes: overview, repository explorer and detail tabs, issue and PR
   list/detail, CI, releases, activity, search, notifications, reports, health, plus the export,
   audit and health APIs.
5. **Tests.** 150 total (was 36). New coverage: transport errors and pagination, secret
   scrubbing, payload mapping, search scoping, CSV injection, export integrity, PGlite store and
   route tests, proxy/redirect handling, structural boundary checks.
6. **Live verification.** Production build served on `:3100` with a real GitHub token; every
   screen returned `200` with live data; exports returned real files; `/api/audit` returned
   `503` as designed without a database.

### Defects found and fixed during this increment

Each was found by a test or a live check, not by inspection:

| # | Defect | Found by | Fix |
| --- | --- | --- | --- |
| 1 | Dashboard reported 59,107,643 open issues (all of GitHub) | Live page render | Scoped GraphQL aliases; unscoped search now refused |
| 2 | `open_issues_count` includes PRs | Code review while writing the count test | Replaced as the issue source; fallback labelled |
| 3 | Issue/PR links pointed at `api.github.com` | URL assertion test | `resourcePath`-derived web URLs |
| 4 | Every check-run classified `UNKNOWN` | Mapping test | Case-normalised classifier |
| 5 | `/search` returned HTTP 422 for "all" | Live page render | One scoped query per type |
| 6 | `reports.kind` missing from the schema | PGlite integration test | Column plus forward migration |
| 7 | `.` and `..` accepted as owner/repository | Export test | Explicit segment rejection |
| 8 | Login redirect pointed at `0.0.0.0` behind a proxy | Live login with headers | Proxy-aware `publicOrigin` |
| 9 | Missing PR returned 200 + error banner | Live 404 check | GraphQL "Could not resolve" → `not_found` → 404 |

### Verification status

| Check | Result |
| --- | --- |
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — 150/150, 10 files |
| `npm run build` | **PASS** — 21 routes |
| Live HTTP smoke (real GitHub) | **PASS** — 15 routes, `200`, no error banners except a genuine failing check |
| CSV/JSON export, live | **PASS** — real rows, BOM present, `skipped:no-database` |
| Database flows | **PASS against PGlite**; **UNTESTED against real Postgres** (none provisioned) |
| Deployment | **NOT DONE** — prohibited this increment |

### Not done

No merge, tag, GitHub Release, deployment, database provisioning, paid resource, or permission
change was performed. Webhooks, Projects V2 views, and any claim of near-real-time behaviour
remain unimplemented and are stated as such in `README.md`.
