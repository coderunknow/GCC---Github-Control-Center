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

**BLOCKED.**

| Question | Answer | Evidence |
| --- | --- | --- |
| Can a request be delivered while the agent is idle? | No | A turn begins with a user message and ends with the agent's reply. Arena's own copy: "When the task is complete, provide your feedback to continue or choose 'keep working.'" |
| While the browser is closed? | Only if a turn is already running. No new turn can start | Same; the sandbox lives inside a turn |
| Is there asynchronous or durable execution across turns? | No documented mechanism | No scheduler, cron, webhook, or queue-consumer trigger exists in any Arena documentation |
| Is there a documented inbound integration? | No | Help Center contains no developer/API section |

The precise missing capability: **Arena exposes no supported way to start an Agent Mode turn
from an external event.** Everything downstream of that — durable queue, connectors,
persistence, identity, result retrieval — is feasible and was demonstrated.

This is a platform limitation, not an implementation defect, and it cannot be worked around
without violating the requirement (browser automation, credential reuse, or a substitute
model).

---

## 5. Compliance review

| Prohibited technique | Used? |
| --- | --- |
| Reverse-engineering / calling private Arena endpoints | **No** |
| Extracting or reusing cookies, tokens, or session secrets | **No** |
| Scraping or automating Arena's chat interface | **No** |
| Circumventing access controls | **No** |
| Substituting another model or agent | **No** |
| Claiming delivery without evidence | **No** — every claim above cites a check |

Arena's Terms of Use §5 additionally prohibits programmatic access to the service
("(vi) access the Services through programmatic or automated means…") and scraping, with an
exception only for public search engines. The queue design deliberately touches only GitHub,
so it does not invoke that clause.

---

## 6. Session continuity and availability limits

| Property | Finding | Status |
| --- | --- | --- |
| Session longevity | Long-running thread, "sometimes over hundreds of turns" | **VERIFIED** (Help Center) |
| Context growth | Conversation compaction is built in for Agent Mode | **VERIFIED** |
| Token limit | Reaching it ends the session; continuation requires a **new** session, with no context transfer | **VERIFIED** |
| Orchestrator model stability | Arena may switch the orchestrator mid-session for reliability | **VERIFIED** — therefore "the exact agent" is guaranteed only as the same **thread**, not the same model |
| Daily usage limit | Applies to all users; resets after 24 hours | **VERIFIED** |

---

## 7. Conclusion and required application behaviour

Direct, unattended delivery to this session is **BLOCKED**. Per §1.4 and §7 of the
specification, the application must therefore:

1. **Not** present a chat interface that appears to deliver requests to the agent.
2. **Not** expose an endpoint that stores a message and implies it was forwarded.
3. Show the Arena agent workspace as **BLOCKED**, with the exact missing capability named.
4. Optionally offer an explicitly labelled **manual handoff** — prepared request text the user
   copies into this session themselves. This must be described as manual, never as delivery.
5. Never route requests to a substitute agent.

The durable ledger may still be implemented — it is genuinely useful for capturing intent,
status, and history — but a ledger row is **not** evidence that an agent task is running, and
the UI must say so.

**Recommendation.** Treat direct connectivity as a platform gap and re-test if Arena ships an
inbound trigger or session API. Meanwhile, the queue from `poc/` is the closest verified
mechanism and remains honestly labelled "human-activated".
