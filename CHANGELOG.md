# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-dev1] — 2026-10-28

First development prerelease. **Not production-ready.** It establishes a verified,
hardened foundation rather than a complete product.

### Added

- **Arena host** (`host/`) — an HTTP console that lets a human submit a request in a
  browser and have the exact running Arena Agent Mode session answer it, using only
  supported Arena tools: `start_process`, and `get_process_output` with
  `wait_for: "log"` as the blocking wait that holds the turn open.
- **Durable request store** — single JSON document written with write → fsync → atomic
  rename. A crash leaves the previous or the new document, never a torn one. Pending
  requests and monotonic sequence numbers survive a process restart.
- **Enforced worker ownership** — claim leases with TTL. A second worker receives `409`
  while a lease is live; expired leases are reclaimed so a replacement worker can continue.
- **Idempotent completion** — replaying an identical answer returns `200` with
  `idempotent: true`; a *different* answer for a completed request returns `409` and the
  stored answer is never rewritten.
- **Recovery checkpoint** — `GET /api/worker/recover` returns everything a newly activated
  worker needs to resume an abandoned backlog.
- **Honest worker health** — `active` / `recover_required` / `idle`, computed from observed
  heartbeat and queue state rather than asserted.
- **STOP control** — an explicit control request plus a `stopRequested` flag the worker can
  read between waits.
- **GitHub Project Control Center foundation** — Next.js 15.5.28 (patched; `15.5.4` carries
  CVE-2025-66478) + TypeScript, single-user HMAC-signed session auth, one-GraphQL-query
  cross-repository overview, and an integration health page.
- **Documentation** — `docs/HOST.md` (architecture, lifecycle, recovery, security, operations)
  and a corrected `docs/ARENA_AGENT_CONNECTIVITY.md`.

### Changed

- **`docs/ARENA_AGENT_CONNECTIVITY.md` §4 and §7 rewritten.** The earlier verdict that the
  integration was categorically blocked was wrong: it conflated "no external scheduler can
  start a turn" (still true) with "the agent cannot receive requests" (false). An
  agent-held blocking wait removes the need for an external trigger. The revision history in
  that file records what changed and why.
- Integration health now reports Arena connectivity as working-with-a-limitation rather than
  blocked outright.

### Security

- The host **fails closed**: it refuses to start without `APP_PASSWORD` (≥8 chars),
  `SESSION_SECRET` (≥16) and `AGENT_TOKEN` (≥16), rather than serving an unauthenticated
  console.
- Two separated credential classes: a human session cookie (HMAC-SHA256, `HttpOnly`,
  `SameSite=Lax`, 12 h TTL) and a worker token header. A leaked cookie cannot drive the
  worker API; a leaked worker token cannot read the UI.
- `Origin` verification on cookie-bearing mutations (CSRF), login rate limiting (8 attempts
  per 15 minutes), 32 KiB body cap, input validation, and generic 5xx messages.
- Secrets are never logged, returned, committed, or placed in URLs. Covered by tests.
- The unauthenticated prototype that accepted public submissions has been removed.

### Tests

- **36 automated tests, all passing** (`npx vitest run`; 2 files). Covers authentication
  failure modes, forged cookies, login throttling, the full request lifecycle, claim
  ownership, lease reclamation, idempotent and conflicting replays, durability across host
  restart, monotonic sequencing, worker health, STOP control, and secret leakage.

### Known limitations

- **Automatic recovery after the turn ends is BLOCKED.** The agent loop exists only while a
  turn is open, and Arena exposes no supported way to start one. Requests submitted while no
  turn is active stay `pending` until a human sends any message to the session. This is a
  platform limitation, not an implementation gap, and is **not** claimed as automation.
- **Per-call wait ceiling of 180 seconds.** Longer waits require repeated calls.
- **The session is the same thread, not a guaranteed same model.** Arena may switch the
  orchestrator mid-session for reliability.
- **Context exhaustion** cannot be recovered in place; Arena requires a new session with no
  context transfer. Not reproduced in testing.
- **Postgres-backed features are not implemented.** The schema exists; history, notifications,
  and audit logging are inactive without `DATABASE_URL`.
- **Not deployed.** No production URL exists.
- CI/CD pages, Projects V2, search, webhooks, and exports are not implemented.

### Not included

No binary artifacts are produced by this project, so no checksums are published.

[0.1.0-dev1]: https://github.com/coderunknow/Testing/releases/tag/v0.1.0-dev1
