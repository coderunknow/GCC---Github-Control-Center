# Arena Host — architecture, operation, and verified limits

The host is a small HTTP service that lets a human submit a request in a browser and have
the **exact running Arena Agent Mode session** answer it. It uses only Arena's supported
tools: `start_process` to run the service, and `get_process_output` with
`wait_for: "log"` as a genuine blocking wait that holds the agent's turn open.

There is no model API, no second agent, no browser automation, and no private endpoint.

---

## 1. The boundary that matters: host vs. worker

These are two different things and they fail independently.

| | Host | Worker (Agent Mode turn) |
| --- | --- | --- |
| What it is | the Node process on port 4000 | the agent loop issuing tool calls |
| Survives a turn ending? | **Yes** — observed across multiple turn boundaries | **No** |
| Survives a process restart? | No, but its state does | n/a |
| Can be started by an external event? | Yes (systemd, restart policy, a person) | **No supported mechanism** |

**Restarting the HTTP server does not restart the AI worker.** A restarted host will hold
requests faithfully and answer nothing until a turn is open again.

---

## 2. Architecture

```
browser ──(signed HttpOnly cookie)──► host :4000 ──► state.json  (atomic, fsynced)
                                          │
Agent Mode turn ──(x-agent-token)────────┘
   │
   └── get_process_output(wait_for="log", wait_pattern="NEW_REQUEST seq=N …")
          │
          ├─ matches  → read payload, answer, resume waiting
          └─ timeout  → (180s max) re-arm. A timeout is not an error.
```

The wake-up signal is a line on the host's stdout:

```
NEW_REQUEST seq=4 id=34e80cd8-a54a-4057-9354-8990c894e1b9
ANSWER_RECEIVED seq=4 id=34e80cd8-a54a-4057-9354-8990c894e1b9
```

Because `get_process_output` returns the **tail** of the log, the pattern must include a
monotonic `seq=N`. A bare `NEW_REQUEST` pattern matches an old line and returns immediately,
producing a hot loop.

---

## 3. Request lifecycle

```
pending ──claim──► claimed ──answer──► completed
   ▲                  │
   │                  ├──fail──► failed
   └──reclaim (lease expired)──► (back to pending)
```

| State | Meaning |
| --- | --- |
| `pending` | accepted, durable, nobody working on it |
| `claimed` | a worker holds a lease on it |
| `completed` | answered; terminal |
| `failed` | worker reported an error; terminal |
| `interrupted` | recorded when a lease expired mid-flight; reclaimed to `pending` |

**Ownership is enforced, not advisory.** `claim` fails with `409` if another live worker
holds the lease. `answer` requires the caller to still hold the claim. This is what stops
two workers processing one request.

**Completion is idempotent.** Replaying an identical answer returns `200` with
`idempotent: true`. A *different* answer for a completed request returns `409` and the
stored answer is never rewritten — history cannot be forged by a retry.

---

## 4. Recovery

A request that arrives while no turn is open stays `pending` on disk. When a worker becomes
active again it calls:

```
GET /api/worker/recover      → { waiting: [...], lastSeq, worker: {...} }
```

That checkpoint is everything a replacement worker needs: the unconsumed requests, the
sequence counter, and whether a STOP was previously requested.

`GET /api/worker/state` reports a computed health value:

| `state` | Condition |
| --- | --- |
| `active` | a heartbeat arrived within the lease TTL |
| `recover_required` | work is waiting and no live worker exists |
| `idle` | nothing waiting and no live worker |

`recover_required` is the honest post-turn-termination state. Arena provides no supported
way for the host to clear it automatically — see §7.

---

## 5. Security

| Control | Implementation |
| --- | --- |
| Human auth | password → HMAC-SHA256 signed cookie, `HttpOnly`, `SameSite=Lax`, 12h TTL |
| Worker auth | `x-agent-token` header; never in a URL |
| Fail closed | the process **refuses to start** without `APP_PASSWORD` (≥8), `SESSION_SECRET` (≥16), `AGENT_TOKEN` (≥16) |
| CSRF | `Origin` checked on every mutating request that carries a cookie |
| Brute force | login throttled per source address (8 attempts / 15 min) |
| Input | JSON validated; body capped at 32 KiB (`413`), prompt 3–8000 chars (`400`) |
| Errors | 5xx returns a generic message; internals are never echoed |
| Secrets | never logged, never returned; covered by tests |

Two credential classes exist because the human and the worker must not share one. A leaked
session cookie cannot drive the worker API, and a leaked agent token cannot read the UI.

**Known limitation:** sessions are stateless, so logout clears the cookie but cannot revoke
an already-issued token. Staleness is bounded by the 12-hour TTL.

---

## 6. Operating the host

```bash
# required
export APP_PASSWORD="$(openssl rand -base64 18)"
export SESSION_SECRET="$(openssl rand -base64 48)"
export AGENT_TOKEN="$(openssl rand -base64 32)"

# optional
export PORT=4000
export HOST_DATA_FILE=host/data/state.json
export LEASE_TTL_MS=300000

node host/server.mjs
```

State lives in one JSON document written with write → fsync → atomic rename, so a crash
leaves either the old or the new document, never a torn one. `host/data/` is gitignored.

**Graceful shutdown:** `SIGTERM`/`SIGINT` closes the listener and exits. Nothing needs
flushing because every mutation is already durable.

**Crash recovery:** start the host again. Pending and completed requests are re-read from
disk; monotonic sequence numbering continues from where it stopped.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| process exits immediately | missing/short credentials | read the error; it names each variable |
| worker gets `401` | wrong `AGENT_TOKEN`, or cookie used on the worker API | use the right credential class |
| worker gets `409` on claim | another live worker holds the lease | expected; wait or shorten `LEASE_TTL_MS` |
| hot loop, waits return instantly | `wait_pattern` lacks `seq=N` | include the sequence number |
| requests sit `pending` | no turn is open | this is the documented platform limit, not a bug |

---

## 7. Verified limits

Established by execution on 2026-10-28, not by inference:

| Claim | Evidence |
| --- | --- |
| A wait timeout does not indicate failure | `get_process_output(wait_timeout=5)` → `wait_result: "timeout"`, host still `running` and healthy |
| A request can arrive while the worker is blocked | `wait_result: "satisfied"` immediately after a submission |
| The host survives a turn ending | the v1 host was still serving 5 requests at the start of a later turn |
| Host state survives a process restart | completed request and its answer re-read after `SIGTERM` + restart |
| The worker does **not** survive a turn ending | requests submitted between turns stayed `pending` (measured 264s) |
| **No supported way to start a turn exists** | Arena documents no scheduler, webhook, or session API; `api.arena.ai` is inference-only |

**The limit, stated plainly:** the loop lives only while a turn is open. Nothing in Arena's
supported surface can open one. Automatic recovery after turn termination is therefore
**BLOCKED**, and the smallest supported recovery procedure is a human sending any message
to the session — which starts a turn, after which `/api/worker/recover` resumes the backlog.

A human prompt is not automatic recovery, and this document does not call it that.
