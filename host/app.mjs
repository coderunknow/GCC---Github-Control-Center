// HTTP surface for the Arena host.
//
// Exported as a factory so tests can bind an ephemeral port and drive it with
// real HTTP requests. Nothing here imports the server entry point.

import { createServer } from 'node:http';
import {
  LoginThrottle,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  agentTokenMatches,
  createSessionToken,
  parseCookies,
  passwordMatches,
  verifySessionToken,
} from './auth.mjs';

const MAX_BODY = 32 * 1024;
const MAX_PROMPT = 8000;
const MIN_PROMPT = 3;
const MAX_ANSWER = 20000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body quá lớn');
    chunks.push(chunk);
  }
  if (!chunks.length) throw new HttpError(400, 'body rỗng');
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'JSON phải là một object');
    }
    return parsed;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'JSON không hợp lệ');
  }
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body quá lớn');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/** Rejects cross-site mutations. Cookie auth alone is not CSRF protection. */
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // same-origin form posts from the built-in page
  const host = req.headers.host;
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, 'origin không khớp');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(403, 'origin không hợp lệ');
  }
}

function publicRequest(record) {
  return {
    id: record.id,
    seq: record.seq,
    prompt: record.prompt,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    answeredAt: record.answeredAt,
    answeredBy: record.answeredBy,
    answer: record.answer,
    error: record.error,
    attempts: record.attempts,
    control: record.control,
  };
}

function renderPage() {
  return `<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arena Host · Phiên Agent</title>
<style>
:root{--bg:#0b0f14;--surface:#121820;--surface2:#171f29;--line:#232d3a;--text:#e6edf3;--muted:#8b98a8;--accent:#5b8def;--good:#3fb950;--warn:#d29922;--bad:#f85149}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);z-index:5}
.brand{display:flex;gap:10px;align-items:center;font-weight:650}
.mark{width:10px;height:10px;border-radius:3px;background:var(--accent);box-shadow:0 0 0 4px rgba(91,141,239,.15)}
main{max-width:940px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:20px;margin:0 0 6px}
.lede{color:var(--muted);margin:0 0 18px;font-size:14px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:18px}
textarea{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;resize:vertical}
button{background:var(--accent);color:#08111f;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line);font-weight:500}
button:disabled{opacity:.55;cursor:not-allowed}
.row{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
.msg{font-size:13.5px;min-height:20px;margin:8px 0 0}
.msg.err{color:#ffb3ae}.msg.ok{color:#7ee787}
.item{border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--surface2);margin-bottom:10px}
.item .top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;justify-content:space-between}
.pill{font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.pending{color:#f0c674;border-color:rgba(210,153,34,.45)}
.pill.claimed{color:#79c0ff;border-color:rgba(121,192,255,.45)}
.pill.completed{color:#7ee787;border-color:rgba(63,185,80,.45)}
.pill.failed,.pill.interrupted{color:#ffb3ae;border-color:rgba(248,81,73,.45)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted)}
.q{margin:8px 0 0;white-space:pre-wrap}
.a{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);white-space:pre-wrap;color:#cfd9e4}
.a .who{display:block;color:var(--muted);font-size:12px;margin-bottom:6px}
.empty{color:var(--muted);text-align:center;padding:14px}
.login{max-width:360px;margin:8vh auto 0}
input[type=password]{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit}
.badge{font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line)}
.badge.active{color:#7ee787;border-color:rgba(63,185,80,.5)}
.badge.recover_required{color:#ffb3ae;border-color:rgba(248,81,73,.5)}
.badge.idle{color:#8b98a8}
</style></head><body>
<header>
  <div class="brand"><span class="mark"></span> Arena Host · phiên Agent đang chạy</div>
  <div style="display:flex;gap:10px;align-items:center">
    <span class="badge" id="badge">…</span>
    <button class="ghost" id="logout" type="button">Đăng xuất</button>
  </div>
</header>
<main>
  <h1>Gửi yêu cầu tới phiên Agent hiện tại</h1>
  <p class="lede">Yêu cầu được lưu bền vững trên đĩa và do chính phiên Arena Agent Mode xử lý. Không qua API mô hình, không qua agent khác.</p>

  <div class="panel" id="console" hidden>
    <form id="f">
      <textarea id="p" rows="4" required minlength="3" maxlength="8000" placeholder="Nhập yêu cầu… (gõ STOP để dừng vòng chờ)"></textarea>
      <div class="row">
        <button id="send" type="submit">Gửi yêu cầu</button>
        <button type="button" class="ghost" id="stop">Yêu cầu dừng</button>
        <span class="msg" id="m"></span>
      </div>
    </form>
  </div>

  <div class="panel" id="loginpanel">
    <form id="lf" class="login">
      <h2 style="font-size:16px;margin:0 0 10px">Đăng nhập</h2>
      <label for="pw" class="mono">Mật khẩu</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <div class="row"><button type="submit">Đăng nhập</button></div>
      <p class="msg err" id="lm"></p>
    </form>
  </div>

  <div class="panel" id="listpanel" hidden>
    <div class="row" style="justify-content:space-between;margin-top:0">
      <strong style="font-size:14px">Yêu cầu</strong>
      <span class="mono" id="count"></span>
    </div>
    <div id="list" style="margin-top:12px"></div>
  </div>
</main>
<script>
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=i=>{if(!i)return'';const d=new Date(i);return isNaN(d)?'':d.toLocaleTimeString('vi-VN')};
const LABEL={pending:'đang chờ',claimed:'đang xử lý',completed:'đã trả lời',failed:'thất bại',interrupted:'bị ngắt'};
let authed=false;

async function api(path,opts){const r=await fetch(path,{cache:'no-store',...opts});const d=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,data:d}}

async function refresh(){
  const h=await api('/api/worker/state');
  if(h.status===401){showLogin();return}
  authed=true;showConsole();
  const b=document.getElementById('badge');b.textContent=h.data.state;b.className='badge '+h.data.state;
  const r=await api('/api/requests');
  if(!r.ok)return;
  const reqs=r.data.requests;
  document.getElementById('count').textContent=reqs.filter(x=>x.status==='completed').length+'/'+reqs.length+' đã trả lời';
  const list=document.getElementById('list');
  list.innerHTML=reqs.length?reqs.slice().reverse().map(x=>\`
    <div class="item"><div class="top">
      <span><span class="pill \${x.status}">\${LABEL[x.status]||x.status}</span>
      <span class="mono"> \${esc(x.id).slice(0,8)} · #\${x.seq}\${x.control?' · lệnh điều khiển':''}</span></span>
      <span class="mono">\${esc(when(x.createdAt))}</span></div>
      <p class="q">\${esc(x.prompt)}</p>
      \${x.answer?\`<div class="a"><span class="who">\${esc(x.answeredBy||'arena-session')} · \${esc(when(x.answeredAt))}</span>\${esc(x.answer)}</div>\`:''}
      \${x.error?\`<div class="a"><span class="who">lỗi</span>\${esc(x.error)}</div>\`:''}
    </div>\`).join(''):'<div class="empty">Chưa có yêu cầu nào.</div>';
}

function showLogin(){document.getElementById('loginpanel').hidden=false;document.getElementById('console').hidden=true;document.getElementById('listpanel').hidden=true}
function showConsole(){document.getElementById('loginpanel').hidden=true;document.getElementById('console').hidden=false;document.getElementById('listpanel').hidden=false}

document.getElementById('lf').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const r=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
  if(r.ok){document.getElementById('pw').value='';refresh()}else{document.getElementById('lm').textContent=r.data.error||'đăng nhập thất bại'}
});

document.getElementById('f').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.getElementById('p'),msg=document.getElementById('m'),btn=document.getElementById('send');
  const prompt=box.value.trim();if(!prompt)return;
  btn.disabled=true;msg.className='msg';msg.textContent='đang gửi…';
  const r=await api('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
  if(r.ok){msg.className='msg ok';msg.textContent='đã gửi · #'+r.data.request.seq;box.value='';await refresh()}
  else{msg.className='msg err';msg.textContent=r.data.error||'lỗi'}
  btn.disabled=false;
});

document.getElementById('stop').addEventListener('click',async()=>{
  const r=await api('/api/control/stop',{method:'POST'});
  const msg=document.getElementById('m');
  msg.className=r.ok?'msg ok':'msg err';
  msg.textContent=r.ok?'đã yêu cầu dừng vòng chờ':'lỗi: '+(r.data.error||r.status);
});

document.getElementById('logout').addEventListener('click',async()=>{
  await api('/api/logout',{method:'POST'});authed=false;showLogin();
});

refresh();setInterval(refresh,3000);
</script></body></html>`;
}

/**
 * @param {{
 *   store: import('./store.mjs').Store,
 *   config: ReturnType<typeof import('./auth.mjs').loadConfig>,
 *   throttle?: LoginThrottle,
 *   log?: (line: string) => void,
 * }} deps
 *   `log` receives the NEW_REQUEST / ANSWER_RECEIVED lines the agent's
 *   blocking `get_process_output` wait matches on. It is injectable so tests
 *   stay quiet.
 */
export function createHost({ store, config, throttle = new LoginThrottle(), log = () => {} }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    const cookies = parseCookies(req.headers.cookie);
    const isHuman = verifySessionToken(cookies[SESSION_COOKIE], config.secret);
    const isWorker = agentTokenMatches(req.headers['x-agent-token'], config.agentToken);

    const requireHuman = () => {
      if (!isHuman) throw new HttpError(401, 'yêu cầu đăng nhập');
    };
    const requireWorker = () => {
      if (!isWorker) throw new HttpError(401, 'sai hoặc thiếu x-agent-token');
    };

    try {
      // -- public ---------------------------------------------------------
      if (path === '/' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(renderPage());
        return;
      }

      if (path === '/api/health' && method === 'GET') {
        const health = store.workerHealth();
        json(res, 200, {
          ok: true,
          host: 'arena-native-host',
          workerState: health.state,
          waiting: health.waiting,
          completed: health.completed,
          total: store.all().length,
        });
        return;
      }

      if (path === '/api/login' && method === 'POST') {
        checkOrigin(req);
        const key = req.socket.remoteAddress ?? 'unknown';
        const gate = throttle.check(key);
        if (!gate.allowed) throw new HttpError(429, 'quá nhiều lần đăng nhập, thử lại sau');
        const body = await readJson(req);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!passwordMatches(password, config.password)) {
          throttle.record(key);
          throw new HttpError(401, 'mật khẩu không đúng');
        }
        throttle.reset(key);
        const token = createSessionToken(config.secret);
        res.setHeader(
          'Set-Cookie',
          `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${
            process.env.NODE_ENV === 'production' ? '; Secure' : ''
          }`,
        );
        json(res, 200, { ok: true });
        return;
      }

      if (path === '/api/logout' && method === 'POST') {
        checkOrigin(req);
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        json(res, 200, { ok: true });
        return;
      }

      // -- human ----------------------------------------------------------
      if (path === '/api/worker/state' && method === 'GET') {
        // Reachable by the human (to display health) and by the worker (to
        // check whether a STOP was requested between waits).
        if (!isHuman && !isWorker) throw new HttpError(401, 'yêu cầu đăng nhập');
        json(res, 200, { ...store.workerHealth(), events: isHuman ? store.events(20) : undefined });
        return;
      }

      if (path === '/api/requests' && method === 'GET') {
        requireHuman();
        json(res, 200, { requests: store.all().map(publicRequest) });
        return;
      }

      if (path === '/api/requests' && method === 'POST') {
        requireHuman();
        checkOrigin(req);
        const body = await readJson(req);
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (prompt.length < MIN_PROMPT) throw new HttpError(400, `prompt quá ngắn (tối thiểu ${MIN_PROMPT} ký tự)`);
        if (prompt.length > MAX_PROMPT) throw new HttpError(400, `prompt quá dài (tối đa ${MAX_PROMPT} ký tự)`);
        const record = store.create(prompt, 'web');
        log(`NEW_REQUEST seq=${record.seq} id=${record.id}`);
        json(res, 201, { request: publicRequest(record) });
        return;
      }

      if (path === '/api/control/stop' && method === 'POST') {
        requireHuman();
        checkOrigin(req);
        const record = store.create('STOP', 'control');
        log(`NEW_REQUEST seq=${record.seq} id=${record.id} control=stop`);
        json(res, 201, { request: publicRequest(record), note: 'STOP đã được ghi nhận cho worker' });
        return;
      }

      const one = path.match(/^\/api\/requests\/([0-9a-f-]{36})$/i);
      if (one && method === 'GET') {
        requireHuman();
        const record = store.get(one[1]);
        if (!record) throw new HttpError(404, 'không tìm thấy yêu cầu');
        json(res, 200, { request: publicRequest(record) });
        return;
      }

      // -- worker ---------------------------------------------------------
      if (path === '/api/worker/heartbeat' && method === 'POST') {
        requireWorker();
        const body = await readJson(req).catch(() => ({}));
        const workerId = typeof body.workerId === 'string' && body.workerId ? body.workerId : 'arena-worker';
        json(res, 200, { ok: true, ...store.heartbeat(workerId) });
        return;
      }

      if (path === '/api/worker/recover' && method === 'GET') {
        requireWorker();
        json(res, 200, store.recoveryCheckpoint());
        return;
      }

      if (path === '/api/worker/claim' && method === 'POST') {
        requireWorker();
        const body = await readJson(req);
        if (typeof body.id !== 'string') throw new HttpError(400, 'thiếu id');
        const workerId = typeof body.workerId === 'string' && body.workerId ? body.workerId : 'arena-worker';
        const result = store.claim(body.id, workerId);
        if (!result.ok) {
          json(res, result.code, { error: result.error, request: result.request ? publicRequest(result.request) : null });
          return;
        }
        json(res, 200, { request: publicRequest(result.request) });
        return;
      }

      if (path === '/api/worker/answer' && method === 'POST') {
        requireWorker();
        const body = await readJson(req);
        if (typeof body.id !== 'string') throw new HttpError(400, 'thiếu id');
        const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
        if (!answer) throw new HttpError(400, 'thiếu answer');
        if (answer.length > MAX_ANSWER) throw new HttpError(400, `answer quá dài (tối đa ${MAX_ANSWER} ký tự)`);
        const workerId = typeof body.workerId === 'string' && body.workerId ? body.workerId : 'arena-worker';
        const result = store.complete(body.id, workerId, answer);
        if (!result.ok) {
          json(res, result.code, { error: result.error, request: result.request ? publicRequest(result.request) : null });
          return;
        }
        log(`ANSWER_RECEIVED seq=${result.request.seq} id=${result.request.id}`);
        json(res, 200, { request: publicRequest(result.request), idempotent: Boolean(result.idempotent) });
        return;
      }

      if (path === '/api/worker/fail' && method === 'POST') {
        requireWorker();
        const body = await readJson(req);
        if (typeof body.id !== 'string') throw new HttpError(400, 'thiếu id');
        const workerId = typeof body.workerId === 'string' && body.workerId ? body.workerId : 'arena-worker';
        const result = store.fail(body.id, workerId, typeof body.error === 'string' ? body.error : 'không rõ lỗi');
        if (!result.ok) {
          json(res, result.code, { error: result.error, request: result.request ? publicRequest(result.request) : null });
          return;
        }
        json(res, 200, { request: publicRequest(result.request) });
        return;
      }

      throw new HttpError(404, 'không tìm thấy');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'lỗi máy chủ';
      // Never echo unhandled internals; 5xx reports a generic message.
      json(res, status, { error: status >= 500 ? 'lỗi máy chủ nội bộ' : message });
    }
  });

  return server;
}
