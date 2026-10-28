# Arena Agent Connectivity — Phase Zero Feasibility Report

**Date:** 2026-10-28
**Scope:** §1 of the specification — determine whether a deployed application can submit
requests to *this exact* Arena.ai Agent Mode agent, preferably the same session, using only
supported mechanisms.
**Governing constraint:** no model API, no second agent, no undocumented endpoints, no
browser automation, no credential extraction.

Statuses: **VERIFIED** = proven by direct evidence · **UNVERIFIED** = plausible, not proven ·
**BLOCKED** = cannot proceed; a required capability does not exist or is unavailable.

---

## 1. The exact existing agent and session

| Property | Value | Status |
| --- | --- | --- |
| Product | Arena.ai Agent Mode (`arena.ai/agent`) | **VERIFIED** — the running environment is Agent Mode; its tool surface (bash, files, web fetch, connectors) matches Arena's published description |
| Agent identity | A single orchestrator model chosen at session start, not revealed by Arena | **VERIFIED** that it is not disclosed; see the caveat in §6 |
| Session identifier | **Not exposed to the agent.** No session ID, URL, or handle is available in the execution environment | **VERIFIED** (absence) |
| Session URL | **Not available legitimately.** Nothing in the environment or platform documentation provides a stable address for this conversation | **BLOCKED** |
| Working branch | `arena/ccae96b1-testing` in `coderunknow/Testing` | **VERIFIED** |

No secrets are reproduced in this document. No cookies, tokens, or internal endpoints were
collected, and none were used.

---

## 2. Candidate mechanisms examined

| # | Mechanism | Official documentation | Can it reach *this* session? |
| --- | --- | --- | --- |
| 1 | Arena API gateway (`api.arena.ai`, OpenAI/Anthropic-compatible) | `platform.arena.ai/docs/claude-code` | **No.** It is documented as a model-inference gateway for coding clients (Claude Code / Claude Desktop, models such as `coding-router-preview`). It starts new inference calls; it has no session or conversation concept. Using it would also be exactly the "model API" the requirement forbids. |
| 2 | Inbound trigger / webhook / scheduler | None published | **No.** No such capability is documented anywhere in Arena's Help Center. |
| 3 | Connectors (GitHub, Supabase, Notion, Linear, Drive, Gmail, Slack-class) | `help.arena.ai/articles/6934758149` | **Outbound only.** The agent *calls out* to connected services during a turn. They do not carry messages *in* to a session. |
| 4 | Agent Mode session API (sessions, threads, messages) | None published | **No.** No article in the How To (19), Policies (5), Experiments (2), or Troubleshooting (10) collections documents one. |
| 5 | Durable queue in a connected service, polled by the session | Indirectly — connectors exist | **Partially.** Proven below: the session *can* consume a queue, but only when a turn is running. |
| 6 | Session link / copied prompt / deep link | n/a | **Rejected as a substitute.** The specification explicitly forbids equating these with delivery. |

`docs.arena.ai` does not resolve. `platform.arena.ai` is behind WorkOS single sign-on.

---

## 3. Delivery experiment — the durable queue

A working proof of concept was built and executed (`poc/`, see `poc/README.md`).

**Design.** A website writes requests to GitHub Issues; the session reads them and records
answers as committed JSON. GitHub was chosen because it is the only durable store reachable
from *both* sides — measured from the sandbox: `api.github.com` → 200, while `example.com`,
`supabase.com`, and `vercel.com` all failed to connect.

**Execution.**

| Step | Evidence | Status |
| --- | --- | --- |
| Request submitted from the website | Issue [#1](https://github.com/coderunknow/Testing/issues/1), `request_id 3f57a364…`, 2026-10-28T11:19:27Z | **VERIFIED** |
| Session read the queue | `drain.mjs list` returned the request | **VERIFIED** |
| Session produced the answer *with its own context* | The answer contained the sandbox TLS-intercept workaround, the observed read-after-write lag, measured network reach, branch name, and commit count — none of which exist in the queue payload | **VERIFIED** |
| Answer persisted | `queue/results/3f57a364….json` committed and pushed | **VERIFIED** |
| Website retrieved and rendered it | `GET /api/requests` → `status: "answered"`, `answeredBy: "arena-agent-mode-session"` | **VERIFIED** |

**What this proves.** A deployed application can hand work to the exact existing agent, and
that agent's existing context is genuinely applied. No model API, no second agent, no
undocumented endpoint, no browser automation.

**What this does not prove.** That the agent receives anything on its own initiative. The
request above was consumed because a human message activated the session. Read carefully:
the queue is durable and the consumer is the real session — the *trigger* is human.

---

## 4. Behaviour when the browser is closed or the agent is idle

> **Superseded 2026-10-28.** This section previously concluded that delivery was
> categorically blocked because no *external* trigger exists. That reasoning was wrong: an
> external trigger is not required, because **the agent itself can hold its turn open** with
> a blocking `get_process_output` wait. The verdict below is the corrected one.

**What was corrected.** The original analysis conflated two separate claims:

- *"No external scheduler can start an Agent Mode turn."* — still true, still **VERIFIED**.
- *"Therefore the agent cannot receive requests."* — **false**, and now disproven by
  execution.

| Question | Corrected answer | Status |
| --- | --- | --- |
| Can a request reach the session while a turn is open? | Yes — the agent blocks on `get_process_output` and a submission releases the wait | **VERIFIED** (multiple requests, no intervening chat message) |
| Can it receive requests while the *agent* is idle? | Yes, but they wait: the host stores them and the worker answers on its next activation | **VERIFIED** |
| Can a new turn start from an external event? | No supported mechanism exists | **BLOCKED** |
| Does the loop survive the turn ending? | No | **VERIFIED** (nothing blocks; latency measured at 264s) |

An external trigger is unnecessary for the working design; what is missing is only the
ability to **start** a turn without a human. Those are different gaps and must not be
merged into one claim.

---

## 5. Compliance review

| Prohibited technique | Used? |
| --- | --- |
| Reverse-engineering / calling private Arena endpoints | **No** |
| Extracting or reusing cookies, tokens, or session secrets | **No** |
| Scraping or automating Arena's chat interface | **No** |
| Circumventing access controls | **No** |
| Substituting another model or agent | **No** |
| Claiming delivery without evidence | **No** — every claim cites an executed check |

The host touches only its own local state and GitHub; it does not invoke Arena endpoints, so
the Terms of Use §5 restriction on programmatic access is not engaged by this design.

---

## 6. Session continuity and availability limits

| Property | Finding | Status |
| --- | --- | --- |
| Session longevity | Long-running thread, "sometimes over hundreds of turns" | **VERIFIED** (Help Center) |
| Context growth | Conversation compaction is built in for Agent Mode | **VERIFIED** |
| Token limit | Reaching it ends the session; continuation requires a **new** session, with no context transfer | **VERIFIED** |
| Orchestrator model stability | Arena may switch the orchestrator mid-session for reliability | **VERIFIED** — "the exact agent" is guaranteed only as the same **thread** |
| Per-call wait ceiling | 180 s per `get_process_output` call | **VERIFIED** (tool contract, exercised) |
| Daily usage limit | Applies to all users; resets after 24 hours | **VERIFIED** |

---

## 7. Conclusion and required application behaviour

**What now works:** a human can submit requests in a browser and the exact running session
answers them through a supported blocking wait, with durable state, enforced ownership,
idempotent completion, and no substitution of the model.

**What remains BLOCKED:** automatic reactivation after the turn ends. The only supported
recovery is a human starting a turn, after which the persisted backlog is drained. This is
documented as a known limitation of the prerelease and is **not** claimed as automation.

The application therefore must, and now does:

1. Present the host as a working console rather than a "blocked" placeholder.
2. Report worker health honestly, including `recover_required`.
3. Never route requests to a substitute agent or fabricate responses.
4. Document the manual recovery step and why it is required.

See `docs/HOST.md` for the architecture, lifecycle, security, and operational procedure.

---

## 8. Revision history

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-28 | Created | Initial Phase Zero investigation |
| 2026-10-28 | §4 and §7 rewritten; §5–§8 renumbered | The original "categorically blocked" verdict was wrong. An agent-held blocking wait removes the need for an external trigger. Corrected by execution evidence, not by re-reading documentation. |
