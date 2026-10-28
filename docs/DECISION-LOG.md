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
