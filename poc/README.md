# Arena Session Bridge — proof of concept

A durable request queue that a website writes to, drained by the **exact existing
Arena Agent Mode session** using only supported surfaces: no model API, no second
agent, no undocumented endpoints, no browser automation.

## Architecture

```
  browser
     │  POST /api/requests
     ▼
  this server ──────────────► GitHub Issues            (durable queue)
                              title: [arena-bridge] …
                                     │
                                     │  node poc/drain.mjs list
                                     ▼
                          Arena Agent Mode session     (this conversation)
                          answers using existing context
                                     │  node poc/drain.mjs answer <n> <file>
                                     ▼
                              queue/results/<request_id>.json   (committed)
                                     │
     browser  ◄──────────────────────┘   GET /api/requests
```

Two views ship in one server:

| Route | Purpose |
| --- | --- |
| `/` → **GitHub dashboard** | Independent of the bridge: repositories, open PRs, open issues, recent commits for the signed-in account. |
| `/` → **Session bridge** | Enqueue a request, watch its status, read the session's answer. |

## Why GitHub hosts the queue

Measured from inside the Arena sandbox on 2026-10-28:

| Host | Result |
| --- | --- |
| `api.github.com` | **200** |
| `example.com` | connection failed |
| `supabase.com` | connection failed |
| `vercel.com` | connection failed |

The sandbox can only reach GitHub (and package registries). A queue on a
general-purpose database would be unreachable from the consumer side. GitHub Issues
is durable, ordered, inspectable, and reachable by both the website and the session.

## Verified end to end

1. `POST /api/requests` from the site → issue
   [#1](https://github.com/coderunknow/Testing/issues/1) created
   (`request_id 3f57a364-…`, 2026-10-28T11:19:27Z).
2. `node poc/drain.mjs list` in the session → returned that request.
3. The session wrote an answer containing facts only this session knew — the sandbox
   TLS-interception workaround, the transient list lag, the measured network reach,
   branch name and commit count.
4. `node poc/drain.mjs answer 1 …` → wrote `queue/results/3f57a364-….json`, committed
   and pushed it.
5. `GET /api/requests` → the site rendered the answer, `status: "answered"`,
   `answeredBy: "arena-agent-mode-session"`.

## What this does NOT prove — the precise blocker

**The session cannot drain the queue while the user is away.**

Arena documents no scheduler, webhook, cron, or polling trigger that starts an Agent
Mode turn on its own. A turn begins when a human sends a message and ends when the
agent replies ("when the task is complete, provide your feedback to continue"). So:

- Requests are durable and survive closing the browser. ✅
- The same session can process them later, with its full context. ✅
- They are processed **the next time the session is activated by a human**, not
  continuously. ❌

Latency is therefore unbounded: a request waits until someone sends *any* message in
this conversation. This is a real queue with real durability and a real consumer — it
is **not** an autonomous agent, and it is not equivalent to an API-backed service.
Do not describe it as one.

Two further caveats about "the exact agent":

- Arena states the orchestrator model may be switched automatically mid-session for
  reliability. "The exact agent" means the same **thread**, not a guaranteed same
  underlying model.
- A session that hits its token limit can only continue in a new session, and Arena
  offers no context transfer between sessions. Agent Mode has built-in compaction,
  which makes this less likely but not impossible.

## Credential reality

The credential available inside this sandbox is a GitHub App installation token. What
it can actually do was measured, not assumed:

| Operation | Result |
| --- | --- |
| Create issue | ✅ |
| Read issues | ✅ |
| Comment on issue | ❌ `403 Resource not accessible by integration` |
| Close issue | ❌ `403 Resource not accessible by integration` |
| `git push` | ✅ |

That is why answers are committed as `queue/results/<request_id>.json` rather than
posted as comments. The agent attempts the comment and the close, reports a 403
honestly, and never treats a failed write as success.

For a real deployment, two tokens with least privilege:

- **Website → queue:** create/read issues (`issues: write` on one repository) — or
  contents:write if you prefer a commit-based queue.
- **Session → answers:** write contents (`contents: write`), read issues.

## Security warnings — read before deploying

- **The proof of concept has no authentication.** Anyone who has the preview URL can
  submit requests and read every answer. Add auth before exposing it.
- **The queue repository is public.** Request text and answers are world-readable.
  Do not put secrets, credentials, or private data in a request.
- **The token never reaches the browser.** It is read from the server environment and
  used only server-side. Remote strings are escaped before rendering.
- Rate limits are the only write throttle; there is no per-user quota.

## Costs

- No model API, so no per-request inference cost.
- GitHub Issues and Contents API calls are free within normal rate limits
  (5,000 requests/hour authenticated).
- The session's own usage counts against the user's Arena daily usage limit, exactly
  as any other message would. No additional charge is incurred by the bridge.

## Running it

```bash
GITHUB_TOKEN=<token> \
QUEUE_REPO=<owner>/<repo> \
QUEUE_BRANCH=<branch holding queue/results> \
PORT=3000 \
node poc/server.mjs
```

Note: inside the Arena sandbox, Node's bundled CA store rejects the sandbox's TLS
interception and `fetch` fails with `unable to verify the first certificate`, while
`curl` succeeds. Point Node at the system trust store rather than disabling
verification:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt node poc/server.mjs
```

This is a sandbox-specific workaround; a normal deployment does not need it.

Draining, from the session:

```bash
node poc/drain.mjs list
node poc/drain.mjs answer <issueNumber> <answerFile> [--no-push]
```

## Files

| File | Role |
| --- | --- |
| `server.mjs` | Zero-dependency HTTP server: dashboard API, queue API, static files |
| `public/index.html` | Two-view shell |
| `public/app.js` | Client rendering (all remote strings escaped) |
| `public/styles.css` | Styling |
| `drain.mjs` | Session-side transport: list pending, persist an answer |

## Status

`VERIFIED` as a demonstration of the transport. `BLOCKED` on unattended consumption,
pending a supported trigger. See `docs/DECISION-LOG.md` DEC-004.
