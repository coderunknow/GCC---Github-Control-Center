// Arena Session Bridge — client
// All remote strings are escaped before insertion; no innerHTML with raw data.

const $ = (sel) => document.querySelector(sel);

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showBanner(message, kind) {
  const el = $('#banner');
  if (!message) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('is-warn', kind === 'warn');
}

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('is-active', v.id === `view-${tab.dataset.view}`));
  });
});

// --------------------------------------------------------------------------
// Dashboard
// --------------------------------------------------------------------------
function emptyRow(label) {
  return `<div class="item"><span class="muted">${esc(label)}</span></div>`;
}

async function loadDashboard() {
  const status = $('#dash-status');
  const body = $('#dash-body');
  status.hidden = false;
  status.textContent = 'Loading GitHub data…';

  try {
    const data = await api('/api/dashboard');
    status.hidden = true;
    body.hidden = false;

    $('#dash-repo').textContent = data.queueRepo;

    $('#dash-repos').innerHTML = data.repos.length
      ? data.repos.map((r) => `
        <div class="item">
          <div class="title">
            <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
            ${r.private ? '<span class="pill private">private</span>' : ''}
            ${r.language ? `<span class="pill">${esc(r.language)}</span>` : ''}
          </div>
          <div class="meta">updated ${esc(when(r.updatedAt))} · ★ ${esc(r.stars)} · ${esc(r.openIssues)} open</div>
          ${r.description ? `<p>${esc(r.description)}</p>` : ''}
        </div>`).join('')
      : emptyRow('No repositories returned for this token.');

    $('#dash-pulls').innerHTML = data.pulls.length
      ? data.pulls.map((p) => `
        <div class="item">
          <div class="title">
            <a href="${esc(p.url)}" target="_blank" rel="noopener">#${esc(p.number)} ${esc(p.title)}</a>
            ${p.draft ? '<span class="pill">draft</span>' : ''}
          </div>
          <div class="meta">${esc(p.repo)} · updated ${esc(when(p.updatedAt))}</div>
        </div>`).join('')
      : emptyRow('No open pull requests involving you.');

    $('#dash-issues').innerHTML = data.issues.length
      ? data.issues.map((i) => `
        <div class="item">
          <div class="title">
            <a href="${esc(i.url)}" target="_blank" rel="noopener">#${esc(i.number)} ${esc(i.title)}</a>
          </div>
          <div class="meta">${esc(i.repo)} · ${esc(i.comments)} comments · updated ${esc(when(i.updatedAt))}</div>
        </div>`).join('')
      : emptyRow('No open issues involving you.');

    $('#dash-commits').innerHTML = data.commits.length
      ? data.commits.map((c) => `
        <div class="item">
          <div class="title">
            <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.sha)}</a>
            <span>${esc(c.message)}</span>
          </div>
          <div class="meta">${esc(c.author)} · ${esc(when(c.date))}</div>
        </div>`).join('')
      : emptyRow('No commits in the queue repository.');
  } catch (err) {
    status.hidden = false;
    status.textContent = `Could not load dashboard: ${err.message}`;
  }
}

// --------------------------------------------------------------------------
// Bridge
// --------------------------------------------------------------------------
function renderRequests(list) {
  const el = $('#requests');
  if (!list.length) {
    el.innerHTML = '<div class="item"><span class="muted">Queue is empty.</span></div>';
    return;
  }
  el.innerHTML = list.map((r) => {
    const pill = r.status === 'answered'
      ? '<span class="pill answered">answered</span>'
      : '<span class="pill pending">pending</span>';

    const answer = r.status === 'answered'
      ? r.answer
        ? `<div class="answer"><span class="who">Answered by <strong>${esc(r.answeredBy)}</strong> in the Arena session · ${esc(when(r.answeredAt))}</span>${esc(r.answer)}</div>`
        : `<div class="answer"><span class="who">${esc(r.note || 'No answer recorded.')}</span></div>`
      : '';

    return `
      <div class="item">
        <div class="title">
          ${pill}
          <a href="${esc(r.url)}" target="_blank" rel="noopener">issue #${esc(r.issueNumber)}</a>
          <span class="subtle">${esc(when(r.submittedAt))}</span>
        </div>
        <p>${esc(r.prompt)}</p>
        ${answer}
      </div>`;
  }).join('');
}

async function loadRequests() {
  const el = $('#requests');
  try {
    const data = await api('/api/requests');
    $('#queue-repo').textContent = data.queueRepo;
    renderRequests(data.requests);
  } catch (err) {
    el.innerHTML = `<div class="item"><span class="muted">${esc(err.message)}</span></div>`;
  }
}

$('#request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = $('#form-msg');
  const btn = $('#submit-btn');
  const prompt = $('#prompt').value.trim();
  if (!prompt) return;

  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Enqueuing…';

  try {
    const { request } = await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    msg.className = 'msg ok';
    msg.textContent = `Queued as issue #${request.issueNumber}. The session will process it on its next activation.`;
    $('#prompt').value = '';
    await loadRequests();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#refresh-btn').addEventListener('click', loadRequests);

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
(async function boot() {
  try {
    const health = await api('/api/health');
    if (!health.tokenConfigured) {
      showBanner(
        'GITHUB_TOKEN is not configured on the server. The queue cannot be read or written. ' +
        'Set it in the environment and restart — it is never sent to the browser.',
        'warn'
      );
    }
  } catch { /* health is best-effort */ }

  loadDashboard();
  loadRequests();
  setInterval(loadRequests, 15000);
})();
