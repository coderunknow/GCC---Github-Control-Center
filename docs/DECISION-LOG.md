# Decision & Uncertainty Log

**Designated decision log** for branch `arena/ccae96b1-testing`.
**Opened:** 2026-10-28 · **Append-only:** record new entries below; never rewrite or delete earlier ones.

This file exists so that unresolved questions, the evidence behind them, and the user's
decisions are auditable. Every entry carries exactly one status:

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Established by direct evidence or a successful test. |
| **UNVERIFIED** | Plausible, but not yet established by sufficient evidence. |
| **BLOCKED** | Cannot proceed on the affected requirement: a capability, permission, decision, or dependency is missing. |
| **USER DECISION REQUIRED** | Multiple materially different approaches remain; picking one without clarification would risk violating intent. |
| **APPROVED DEVIATION** | The user has explicitly accepted a documented departure from the original requirement. |

A proposal, a planned test, or an unexecuted action is never recorded as VERIFIED.

---

## DEC-001 — The preceding requirement set is absent from this session and this repository

**Status: BLOCKED**

**Question.** The instruction received references "all preceding requirements" and
"every existing user requirement and non-negotiable constraint", and is numbered as
Section 17 (Clarification, Uncertainty, and User-Intent Safeguards). No Sections 1–16,
no product description, and no acceptance criteria are present in this conversation or
in the repository.

**Evidence collected (2026-10-28).**

- Repository contents are a single file, `README.md`, whose entire body is `# Testing`
  (10 bytes).
- Git history is one commit: `926515c Initial commit`. Branch
  `arena/ccae96b1-testing` was created from that same commit, so it contains no
  additional work.
- No other local or remote branches, no tags, no stashes, no Git LFS objects, no ignored
  or untracked files.
- No specification, design document, issue, or prompt history in the workspace.

**Consequence.** There is no application to continue. Any user interface, data model,
or feature written now would be an invention rather than an implementation of the
user's requirements, and would be presented as work on a product that was never
described.

**What remained verifiable.** Section 17.5 states the most important unresolved
architectural question explicitly — whether a deployed website can submit requests to
the *exact* existing Arena.ai agent, "and preferably the same session" — so that
question was investigated independently below (DEC-002). No application code was
written, because no requirement exists from which to derive it.

**Blocking input needed.** The requirement set, or an explicit statement of the product
to build.

---

## DEC-002 — Can a deployed website submit requests to the exact Arena.ai agent, and the same session?

**Status: BLOCKED** (for the exact-agent and same-session requirements)
**Status: USER DECISION REQUIRED** (for which alternative, if any, is acceptable)

This is the constraint Section 17.5 forbids resolving silently. It was investigated
before asking, per Section 17.2.

### Verified findings

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | Arena operates a publicly documented inference gateway at `https://api.arena.ai`, authenticated with an Arena API key created at `https://platform.arena.ai/dashboard/keys`. It is OpenAI/Anthropic wire-compatible. | Official docs page `https://platform.arena.ai/docs/claude-code` |
| 2 | The gateway endpoints are live and demand a bearer token; unauthenticated calls are rejected with a structured error rather than a 404. | `GET https://api.arena.ai/v1/models` → `{"error":{"code":"missing_or_invalid_bearer_token",...}}`; same for `POST /v1/chat/completions` |
| 3 | The documented purpose of that gateway is **model inference for coding clients** (Claude Code, Claude Desktop), with models such as `coding-router-preview` selected per workspace/key. | `https://platform.arena.ai/docs/claude-code` |
| 4 | Arena's public Help Center contains no developer API section: its collections are How To (19 articles), Policies (5), Experiments (2), Troubleshooting (10). No article documents an Agent Mode, session, thread, or conversation API. | `https://help.arena.ai/` and `https://help.arena.ai/collections/2377350852-how_to` |
| 5 | `docs.arena.ai` does not resolve to a documentation site. `platform.arena.ai` itself is behind WorkOS single sign-on. | Direct requests |
| 6 | Arena's Terms of Use **prohibit programmatic access to the service**, with a narrow exception for public search-engine crawlers. | Terms of Use (Last Updated 2026-02-23), §5: "(vi) access the Services through programmatic or automated means or automatically query the Services, (vii) use any manual or automated software, devices or other processes (including but not limited to spiders, robots, scrapers, crawlers, avatars, data mining tools, or the like) to 'scrape', extract, or download data…" |
| 7 | The same section prohibits causing or authorizing others to access the Service, and mirroring/hosting/distributing it. | Terms of Use §5(i): "(i) license, sell, rent, lease, transfer, assign, reproduce, mirror, distribute, host, otherwise commercially exploit, or cause, authorize, or pay others to access the Service…" |
| 8 | Arena's user-facing guidance describes Agent Mode as a feature of the `arena.ai/agent` web application with a per-session workspace; changes are delivered to the user via GitHub branch/PR, not via an API. | `https://help.arena.ai/articles/5432423882-how-to-use-agent-mode`, `https://help.arena.ai/articles/1655691990-how-to-use-coding-in-agent-mode` |

### What is therefore established

- **VERIFIED:** There is a supported, credentialed Arena API — but it serves **model
  inference**, and its documented clients are coding tools. It is not documented as a
  way to reach Agent Mode.
- **VERIFIED:** No documented mechanism exists to address **this** Agent Mode session,
  or any specific existing conversation, from outside `arena.ai`.
- **VERIFIED:** Reaching the session by driving the `arena.ai` web application with
  stored session cookies would breach Terms of Use §5(vi)/(vii), and would additionally
  place the user's account credentials in a server that third parties can reach.
- **UNVERIFIED:** Whether Arena grants partner/enterprise access to Agent Mode or
  session-level APIs. No such program is publicly documented; this is *unknown*, not
  proven to be impossible.
- **UNVERIFIED:** Whether the commercial gateway exposes any agentic/session semantics
  beyond single-turn inference. It could not be tested without a key.

### The material distinction that must not be blurred

An API-key-backed chat is **a different agent**. It would answer with whatever model the
key selects, with no access to this session's history, tools, sandbox, repository
context, or the work already in progress. Labeling it "the Arena agent" would present a
capability the deployed site does not have. Section 17.5 forbids exactly this
substitution being made silently.

### Options, with real consequences

| Option | What the deployed site would actually do | Compliant? | Preserves the exact agent/session? |
| --- | --- | --- | --- |
| **A. Launch/hand-off** — site links into `arena.ai/agent`, optionally deep-links to a conversation; the user sends prompts in Arena itself | Shows real session state it can read without logging in (public content, or content the user pastes); every prompt is sent by the human inside Arena | Yes | **Yes** — but the site cannot submit prompts on its own |
| **B. Arena-issued API key** — site calls `api.arena.ai` with a server-side key | A genuine, working chatbot powered by Arena's gateway | Yes, via sanctioned key (subject to key/workspace restrictions) | **No** — different agent, no session history or tools; needs a key and may incur usage cost |
| **C. Third-party model API** — e.g. an OpenAI-compatible provider | A working chatbot | Depends on provider | **No** — replaces Arena entirely; unapproved cost and integration |
| **D. Browser automation of `arena.ai`** using the user's stored session | Site submits prompts into the real session | **No** — breaches ToS §5(vi)/(vii); requires storing the user's session credentials server-side; every visitor would act as the user's account | Partially, at the cost of the above |
| **E. Wait / pursue official access** — keep the capability BLOCKED pending an Arena-provided integration | The rest of the product can be built; this one feature stays stubbed and visibly marked unavailable | Yes | Unknown until access exists |

**Recommendation.** Option **A** for the website, recorded as an **APPROVED DEVIATION**
only if the user accepts it, because it is the only option that keeps the real agent and
real session while remaining compliant — at the cost that the site cannot itself submit
prompts. Option **D** should be rejected: it trades the user's credentials and the ToS
for a feature. Option **B** is defensible *only* if the user explicitly reclassifies the
requirement as "an Arena-powered assistant" rather than "the same agent and session".

### Awaiting

The user's decision on Option A–E. Until then, every requirement depending on
programmatic access to the agent/session is **BLOCKED**, and no substitute has been
built.

---

## DEC-003 — Application stack and deployment target

**Status: UNVERIFIED (proposed default, not yet confirmed)**

No existing convention exists in the repository to inherit (see DEC-001), so a default
is proposed rather than assumed silently:

- TypeScript throughout; Next.js (App Router) with route handlers acting as the only
  server-side place a credential could live.
- Deployed via the Vercel connector already enabled for this session; repository is
  `coderunknow/Testing`.
- No secret is ever shipped to the browser; any key is read from server-side environment
  variables.

This is a reversible technical default and will not be treated as a product decision.
It will be superseded by whatever the requirement set specifies. It is recorded here so
that the choice is visible rather than implicit.

---

## Actions deliberately NOT taken in this entry

- No application was scaffolded. With no requirements, UI structure, data model, and
  feature set would all be guesses (Section 17.6).
- No workaround was built for the agent connection. Choosing one unilaterally is
  precisely the failure mode Section 17.5 names.
- No credentials were requested, stored, or used. No cost-incurring API was called.
- Nothing was committed to `main`; all work stays on `arena/ccae96b1-testing`.

## Verification evidence log

| Date | Action | Result |
| --- | --- | --- |
| 2026-10-28 | Inspected repository, branches, tags, stashes, ignored files | Single 10-byte README, single commit, empty working tree |
| 2026-10-28 | `GET https://api.arena.ai/v1/models` | Live endpoint; requires bearer token |
| 2026-10-28 | `POST https://api.arena.ai/v1/chat/completions` | Live endpoint; requires bearer token |
| 2026-10-28 | Fetched `https://platform.arena.ai/docs/claude-code` | Official Arena API docs; inference gateway + key issuance |
| 2026-10-28 | Enumerated `help.arena.ai` collections and articles | No developer/agent/session API documentation |
| 2026-10-28 | Fetched Arena Terms of Use | §5(vi)/(vii) prohibit programmatic access and scraping |
| 2026-10-28 | Fetched `https://docs.arena.ai/` | Does not resolve |

---

## DEC-004 — Durable queue consumed by the exact session (the user's fourth approach)

**Status: VERIFIED** for the transport · **BLOCKED** for unattended consumption
**Date:** 2026-10-28 · **Approved by user:** yes, as an investigation with a PoC if feasible

### What was asked

Build a durable request queue that the website writes to, which the *exact existing*
Arena Agent Mode session consumes through a supported tool / connector / polling
mechanism, using its own context. Verify it works without a model API, another agent,
undocumented endpoints, or browser automation. Determine whether the same session can
process requests while the user is away, the browser is closed, or the current task has
finished. Build a PoC only if feasible, and prove end to end that a request submitted
from the website was actually processed by the exact session.

### What was built

`poc/` — a zero-dependency Node server plus a session-side transport script. The queue
is stored in GitHub Issues; answers are committed to `queue/results/<request_id>.json`.
See `poc/README.md`.

### Evidence: VERIFIED end to end

| Step | Result |
| --- | --- |
| `POST /api/requests` from the website API | Issue [#1](https://github.com/coderunknow/Testing/issues/1) created, `request_id 3f57a364-15db-4374-a04f-c2b96bd73c37`, 11:19:27Z |
| `node poc/drain.mjs list` in this session | Returned that request |
| Session writes an answer | Contained facts only this session held: the sandbox TLS-intercept workaround, the transient list lag, measured network reach, branch and commit count |
| `node poc/drain.mjs answer 1 …` | Wrote and pushed `queue/results/3f57a364-….json` |
| `GET /api/requests` | Site returned the answer, `status: "answered"`, `answeredBy: "arena-agent-mode-session"` |

Also verified independently: the GitHub dashboard view renders real account data
(repositories, open PRs, open issues, recent commits).

### Constraints discovered by measurement

1. **Sandbox network allowlist.** `api.github.com` → 200; `example.com`, `supabase.com`,
   `vercel.com` → connection failed. A queue on a general-purpose database is unreachable
   from the consumer side, so GitHub is the only viable store for this design.
2. **Credential is an App installation token.** Create/read issues ✅; comment and close
   issues ❌ (`403 Resource not accessible by integration`); `git push` ✅. The answer
   channel was therefore designed around a committed result file, with comments attempted
   best-effort and reported honestly on failure rather than treated as success.
3. **Transient read-after-write lag.** The first `drain.mjs list` seconds after issue
   creation returned "No pending requests"; a retry returned it. Consumers must tolerate
   this and must not treat an empty read as terminal.

### The blocker: no supported trigger

Arena documents no scheduler, webhook, cron, or polling mechanism that starts an Agent
Mode turn without a user message. A turn begins with a human message and ends with the
agent's reply ("When the task is complete, provide your feedback to continue"). The
sandbox is long-lived *within* a turn; nothing documented lets it start the next one.

Consequence, stated plainly: the queue is real and durable, and the exact session does
consume it — **on its next activation by a human**, not while the user is away. Latency
is unbounded. This is not equivalent to an API-backed service and must not be described
as one.

### Session-lifetime findings

- Agent Mode is a long-running thread ("sometimes over hundreds of turns") with built-in
  conversation compaction, so the same session can be reused for a long time. (VERIFIED,
  Arena Help Center)
- A session that hits its token limit can only continue in a **new** session, and no
  context transfer exists between sessions. (VERIFIED)
- Arena states the orchestrator model may be switched automatically mid-session to avoid
  a broken state. Therefore "the exact agent" can only be guaranteed as the same
  **thread**, not as the same underlying model. (VERIFIED, and material to the wording of
  the original requirement)
- A daily usage limit applies and resets after 24 hours. (VERIFIED)

### Security, privacy, cost

- The PoC has **no authentication**: anyone with the preview URL can submit and read.
  This must be fixed before any real deployment.
- The queue repository is **public**, so request text and answers are world-readable.
- The token is server-side only and never reaches the browser; remote strings are escaped.
- No model API, so no per-request inference cost. GitHub API use is free within rate
  limits. The session's own usage counts against the user's Arena daily limit like any
  other message.

### Question this leaves open

Human-activated drain is the only variant that could be verified. If the product
requires unattended processing, that requirement remains **BLOCKED** and needs a
supported trigger from Arena, or an explicit decision to accept a different mechanism
(which would no longer be the same agent).

---

## DEC-005 — Credential scopes for a real deployment

**Status: VERIFIED (measurement) / UNVERIFIED (the user's actual environment)**

Measured capabilities of the sandbox credential are recorded in DEC-004. For a real
deployment, least privilege implies two separate credentials:

| Side | Needs |
| --- | --- |
| Website → queue | `issues: write` (create/read issues) on one repository |
| Session → answers | `contents: write`, `issues: read` |

Neither may be shipped to the browser. Whether the user can provision these is
**unverified**; it depends on their GitHub account type and on wanting a public or
private queue repository.

---

## DEC-006 — User decision: unattended processing is a hard requirement

**Status: BLOCKED** · **Date:** 2026-10-28 · **Decided by user:** yes

### The decision

Asked whether human-activated drain is an acceptable deployment model for the site, the user
selected **"It must be unattended"**: keep the queue and the infrastructure, but treat
unattended processing as a hard requirement; document precisely what Arena would need to
provide rather than fake it.

### Consequence

- The GitHub queue from DEC-004 is **not** accepted as satisfying the requirement. It stays as
  an investigation artifact and as infrastructure, but it must not be presented as the agent
  integration.
- The Arena request feature in the application is **BLOCKED** and is rendered as blocked in the
  UI, naming the missing capability.
- No substitute agent, model API, or browser automation will be introduced to close the gap.

### What Arena would need to provide (the exact missing capability)

A supported way to **start an Agent Mode turn from an external event** — an inbound trigger,
webhook, polled inbox, or session-scoped API — targeting a specific existing session, with an
identity handle for that session and a documented delivery acknowledgement. Everything else is
already feasible and was demonstrated: durable queue, connectors, persistence, identity, result
retrieval. Only the trigger is missing.

If Arena ships such a capability, the queue already in `poc/` becomes the delivery mechanism
with no redesign; only the drain trigger changes.

---

## DEC-007 — Environment capabilities for hosting and persistence

**Status: VERIFIED (measured) / USER DECISION REQUIRED (resource use)**

Probed because §10 requires a real production deployment and §11 a persistent database, and
both depend on what the account actually has.

| Capability | Finding | Status |
| --- | --- | --- |
| Vercel account | Team "coderunknow's projects", plan **Hobby** (free). Connector can create projects, deploy file-based builds, set env vars, manage domains. | **VERIFIED** |
| Vercel deployment protection | `ssoProtection: all_except_custom_domains` — deployments are protected unless served on a custom domain. Relevant to public access. | **VERIFIED** |
| Supabase organization | One org, `akefxrfemfvxvetsmnuz` | **VERIFIED** |
| Supabase projects | Two exist, both **INACTIVE (paused)**: `nryjatuhyqlhltftznhm` (ap-northeast-1) and `zpjytemhwprepninzlgc` (ap-southeast-1) | **VERIFIED** |
| Sandbox → Supabase | **Unreachable.** `supabase.com` connection failed; the sandbox allowlist covers only GitHub and package registries. Therefore a locally-run app cannot exercise a Supabase database; only the deployed app can. | **VERIFIED** |
| Sandbox → Vercel URL | **Unreachable** from bash for the same reason. Unauthenticated page fetches can still be made through the platform's own page-fetch tool, and build logs are available through the Vercel connector. | **VERIFIED** |
| GitHub credential | GitHub App installation token. Contents, Actions runs, pulls, releases, rate_limit, and GraphQL all OK. Cannot comment on issues, close issues, or list installation repositories. Repository enumeration works via `/user/repos`. | **VERIFIED** |

### Why this needs the user

Restoring a paused Supabase project changes the user's infrastructure and may affect their plan
or usage. Creating an additional project does the same. Neither is authorized yet, and §10
forbids creating billable resources without approval.

### Recommendation

Neither existing project should be commandeered blindly: `zpjytemhwprepninzlgc` is named
"my new game" and `nryjatuhyqlhltftznhm` is "coderunknow's Project", so repurposing either
risks destroying unrelated work. The cleanest option is a **new dedicated free-tier project**
for this application. Restoring an existing one is acceptable only if the user confirms it
holds nothing they need. Either way the choice is the user's, because it touches their
infrastructure.

### Testing consequence, stated up front

Because the sandbox cannot reach Supabase, database-backed paths cannot be verified locally.
Verification will therefore rely on: unit tests against a local in-process database, plus
post-deployment smoke tests of the real deployment through the platform page-fetch tool and the
Vercel connector's build logs. Any path that cannot be exercised that way will be reported as
**BLOCKED/UNTESTED**, never as passing.

---

## DEC-008 — Observation: sandbox liveness across turns

**Status: UNVERIFIED** · **Date:** 2026-10-28

To test whether background work could substitute for a missing trigger, a 10-second-interval
heartbeat process was started in the sandbox and left running across turns.

**Observed:** the process was still alive on the next turn, and its log spanned the idle gap
(11:21:37Z → 11:33:45Z). But it produced only **12 entries in ~12 minutes**, far below the 72
expected from a 10-second interval. That is consistent with the sandbox being suspended or
heavily throttled between turns rather than running continuously.

**What this does not establish:** either direction. It neither proves continuous background
execution nor proves suspension. Confirming it would need a longer, instrumented run.

**Why it does not change the verdict:** even a continuously running sandbox process could only
execute deterministic code. It cannot start an Agent Mode turn or invoke the orchestrator, so
it cannot deliver DEC-006's requirement regardless of liveness. The automation gap in §4 of
`docs/ARENA_AGENT_CONNECTIVITY.md` stands independently of this observation.

---

## DEC-009 — Dashboard counts come from GraphQL aliases, not Search

**Status: IMPLEMENTED** · **Date:** 2026-10-28 · **Version:** 0.1.0-dev2

**Problem found during live testing.** The overview called `/search/issues` with
`is:issue state:open` and no owner qualifier. GitHub searched all of GitHub and returned
**59,107,643** open issues, which the dashboard displayed as the account's total. The same bug
affected pull requests (**90,964,480**).

**Options considered.**

1. Sum `open_issues_count` from `/user/repos`. Rejected: GitHub includes pull requests in that
   count, so the number would be wrong in a different, less visible way.
2. Sum `open_issues_count` minus a pull-request count per repository. Rejected: requires two
   requests per repository and still cannot exclude draft-only states reliably.
3. One `/search/issues` request per repository. Rejected: GitHub's search limit is 30 requests
   per minute; a 33-repository account would exhaust it on a single page load.
4. **Chosen:** one GraphQL request using field aliases, asking `issues(states: OPEN)` and
   `pullRequests(states: OPEN)` per repository, chunked at 40 repositories per request.

**Result.** Exact per-repository totals in two requests for a 33-repository account. When an
alias comes back `null` the UI says *"một số repo không trả lời"* instead of quietly summing a
smaller set.

**Consequence for search screens.** GitHub search cannot express "all repositories I can reach".
A query with no `repo:`, `user:` or `org:` qualifier searches all of GitHub, so `buildIssueQuery`
now scopes to `involves:<login>` when no repository is chosen and **throws** when there is no
scope to apply. Screens state which scope is active.

---

## DEC-010 — Web URLs from `resourcePath`, never from GraphQL `url`

**Status: IMPLEMENTED** · **Date:** 2026-10-28 · **Version:** 0.1.0-dev2

GraphQL returns `url` for issues and pull requests as `https://api.github.com/repos/…` — an API
endpoint, not a page a person can read. Tests caught this by asserting a real URL and receiving
an API one.

The specification forbids hand-assembling GitHub URLs, so the fix does not concatenate
`owner/name/number`. Instead the query now also requests **`resourcePath`** — a payload field
such as `/o/r/pull/42` — and the web URL is `https://github.com` + that path. The helper
validates the path shape and rejects `..`, falling back to the API URL if it is unexpected.

A test asserts the derived URL, and a live check greps the rendered detail pages for
`api.github.com`: the count is zero.

---

## DEC-011 — Degrade honestly when `DATABASE_URL` is absent

**Status: IMPLEMENTED** · **Date:** 2026-10-28 · **Version:** 0.1.0-dev2

Two failure modes were rejected:

- **Silent no-op.** Writing history to nowhere and returning success would let the user believe
  a report was recorded.
- **Hard dependency.** Refusing to render the dashboard without a database would make an
  optional component mandatory.

**Chosen behaviour.** `getStore()` returns an `UnavailableStore` whose reads return empty and
whose writes **throw**. Exports still download, but set `x-export-recording:
skipped:no-database`, so the omission is visible in the response itself. `/api/audit` returns
`503` with `available:false` — an empty `200` would be indistinguishable from "nothing has
happened yet". `/reports` and `/health` state that history is off.

The same code path runs against PGlite in tests, so the SQL under test is the SQL that would run
in production.

---

## DEC-012 — Drop `arena_direct_connectivity` from `/api/health`

**Status: IMPLEMENTED** · **Date:** 2026-10-28 · **Version:** 0.1.0-dev2

`/api/health` reported `arena_direct_connectivity: "blocked"` — a constant string, not a
measurement. A health check that returns a hard-coded verdict invites the reader to treat it as
evidence that a probe ran. The field was removed.

The endpoint now reports only what it can determine without a network call: whether auth is
configured, whether a GitHub token exists, the database backend, and the version. Liveness
probes should be cheap and honest; the connectivity question is documented in
`docs/ARENA_AGENT_CONNECTIVITY.md`, where its evidence lives.
