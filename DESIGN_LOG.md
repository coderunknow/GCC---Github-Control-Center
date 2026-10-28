# DESIGN_LOG.md — append-only design history

## User Intent

Build a **GitHub Project Control Center**: a Vietnamese-language, dark-mode developer dashboard
covering every repository the authenticated account can reach — issues, pull requests and
reviews, CI/CD, commits, releases, activity — with search, notifications, exports, persistent
history, and approval gates. Deploy it to a stable production host.

The original requirement also demanded that requests submitted through the deployed app reach
**the exact existing Arena Agent Mode agent, preferably the same session**, without substituting
another agent or model API. That requirement was explicitly ranked above cosmetic features.

The user later clarified two decisive points:

- **Unattended processing is a hard requirement**, not a nice-to-have. A queue that only drains
  when a human nudges the session does not satisfy it.
- **Defer infrastructure**: build database-agnostic, test against an in-process database, supply
  `DATABASE_URL` at deploy time. **Deploy only once there is a build worth deploying.**

## Implementation History

| Date | Change |
| --- | --- |
| 2026-10-28 | Repository found empty (`README.md` = `# Testing`, one commit). Recorded in DEC-001. |
| 2026-10-28 | Investigated Arena connectivity; found a documented inference gateway but no Agent Mode/session API, and a Terms of Use that prohibits programmatic access. DEC-002. |
| 2026-10-28 | Built and executed a GitHub-issue-backed queue drained by the real session. Verified end to end. DEC-004. |
| 2026-10-28 | User rejected human-activated drain as sufficient (DEC-006). Wrote the Phase-Zero report. |
| 2026-10-28 | Probed hosting/DB capabilities: Vercel Hobby usable, two Supabase projects paused, sandbox reaches only GitHub. DEC-007. |
| 2026-10-28 | Built the Next.js + TypeScript foundation: schema, auth, GitHub client, overview, health, tests. Build and 11 tests pass. |

## Decisions & Lessons

**GitHub as the queue store was forced by measurement, not preference.** The sandbox reaches
`api.github.com` (200) and fails to connect to `supabase.com`, `vercel.com`, and `example.com`.
Any queue on a general-purpose database would be unreachable from the consumer side.

**Answer channel chosen around the credential's real limits.** The sandbox token is a GitHub App
installation token: it creates and reads issues, but returns 403 for comments and closes. Rather
than pretend those writes succeeded, answers are committed as `queue/results/*.json` and comment
failures are reported. Verify capabilities before designing around them.

**Empty read ≠ empty queue.** The first drain seconds after issue creation returned "No pending
requests"; a retry found it. Consumers must retry rather than conclude the queue is empty.

**Encode honesty in the schema.** `arena_requests.delivery_state` has no `delivered` or `running`
value, so a false claim is unrepresentable rather than merely discouraged.

**Next.js version.** `15.5.4` carries CVE-2025-66478 (flagged by npm). Upgraded to the patched
backport `15.5.28` rather than jumping a major version mid-build.

**Fail closed on missing configuration.** An app with no `APP_PASSWORD` treats every request as
unauthenticated, so a misconfigured deployment is locked rather than open.

**Sandbox TLS.** Node's bundled CA store rejects the sandbox's TLS interception; `curl` accepts
it. Use `NODE_EXTRA_CA_CERTS`, never `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### 2026-10-28 — v0.1.0-dev1: turn recovery investigation and host hardening

**User Intent (this increment).** Restore request processing after the Agent Mode worker
stops, harden the prototype, and ship a professional development prerelease. Automatic
post-termination recovery is the stated goal; the user explicitly required that it not be
faked if the platform does not support it.

**Implementation History.**

1. Re-verified the corrected mechanism: the agent itself holds the turn open via
   `get_process_output(wait_for: "log")`. An *external* trigger is unnecessary; the earlier
   "categorically blocked" verdict was withdrawn as wrong.
2. Rewrote the host: durable atomic store, claim leases, idempotent completion, recovery
   checkpoint, computed worker health, STOP control, separated human/worker credentials,
   fail-closed startup, CSRF and throttling.
3. Added 25 host integration tests over real HTTP; suite is now 36 tests.
4. Corrected `docs/ARENA_AGENT_CONNECTIVITY.md`, added `docs/HOST.md`, bumped to
   `0.1.0-dev1`, added `CHANGELOG.md` and a CI workflow.

**Decisions & Lessons.**

- **The blocking wait is the whole mechanism.** The previous analysis searched for a way to
  *start* a turn and concluded nothing worked. The mistake was assuming requests must be
  pushed in from outside; they can instead be pulled by an agent that is already running and
  simply does not end its turn.
- **Chose write→fsync→atomic-rename over `node:sqlite`.** `node:sqlite` is available in Node
  22 but emits an experimental-API warning; a document store is stable, dependency-free, and
  auditable at this volume.
- **Ownership had to be enforced, not documented.** `answer` now requires holding the claim;
  without that, "one worker per request" was only a convention.
- **Two defects were found by running the thing, not by reading it:** malformed JSON returned
  `500` instead of `400`, and `/api/worker/state` was registered twice so the human-only copy
  shadowed the worker copy and returned `401` to a valid worker. Both now have regression
  tests. Neither was visible in a build or a typecheck.
- **A test failed for a good reason.** A 2-character prompt was rejected by a 3-character
  minimum — the API was right and the fixture was wrong. Fixed the fixture, not the rule.
- **Host survival ≠ worker survival.** Demonstrated directly: the v1 host kept serving five
  requests across a turn boundary while the worker was absent. These must never be described
  with one word.

---

## v0.1.0-dev2 — design of the control center screens

### What changed in intent

dev1 delivered a verified foundation with three screens. dev2 had to make the product *usable*:
real flows for repositories, issues, pull requests, CI, releases, activity, search,
notifications and exports. That forced three design questions.

### 1. Where does a number come from, and how is its scope shown?

Every count on screen has a stated origin. `lib/queries.ts` returns `PageInfo { count, truncated,
scope, fetchedAt }` alongside data, and pages render `scope` verbatim under the table. Where a
scope cannot be computed honestly — "all repositories this token can reach" is not expressible
in GitHub search — the page narrows the question (one repository, or issues involving you) and
says which question it answered.

Rejected: a single aggregate GraphQL query for the dashboard. It looks elegant and produces
numbers whose coverage is invisible; the aliased-counter approach can state exactly which
repositories answered.

### 2. Server components everywhere, filters as GET forms

No client-side data fetching means no token in the browser, no hydration of GitHub payloads, and
a page that can be smoke-tested with `curl`. Filters, sorting and pagination are ordinary form
submissions and links, which also makes every screen state a shareable URL. The cost is a full
round trip per filter change — acceptable for a single-user tool read from GitHub on every load.

### 3. Failure has more than one shape

The interface distinguishes, in separate components:

- **not configured** — no `GITHUB_TOKEN` at all; tells you what to set;
- **not permitted** — 403; names the scope to add and links GitHub's documentation;
- **not found** — 404; real status code and a page explaining rename/delete/private;
- **rate limited** — shows when the quota resets;
- **no data** — an empty repository, an empty search, a project with no releases;
- **database off** — export works, history is off, and the export response says so.

A single "something went wrong" box would collapse six different remedies into none.

### 4. Read-only is a design constraint, not an omission

No screen offers approve, merge, comment, re-run or create. The CI page says a green run is not
merge readiness; the PR page shows GitHub's own `reviewDecision` and says the app draws no
conclusion from one check. Every action link leads to GitHub, where the user's own permissions
and audit trail apply.

### 5. The database is optional by design

`getStore()` returns either a Postgres-backed store or an `UnavailableStore` whose writes throw.
Pages branch on `available`, not on a try/catch, so "history is off" is a normal state rather
than an exception path. Because the same `SqlStore` runs against PGlite in tests, the SQL that
is tested is the SQL that would run in production.
