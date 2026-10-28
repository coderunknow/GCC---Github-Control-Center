// Durable request store with explicit lifecycle and worker leases.
//
// Durability model: the authoritative state lives in a single JSON document
// written with write → fsync → atomic rename on every mutation. A crash
// therefore leaves either the previous or the new complete document, never a
// torn one. Volume is one request at a time from one user, so a document store
// is simpler and more auditable than a database, and adds no dependency.
//
// Lifecycle:
//
//   pending ──claim──▶ claimed ──complete──▶ completed
//      ▲                  │
//      │                  └──fail──▶ failed
//      │
//      └──reclaim (lease expired)── interrupted
//
// `interrupted` exists because a worker can vanish mid-request. Reclaiming an
// expired lease moves the request back to `pending` so a replacement worker can
// pick it up; the attempt counter and last worker id are kept as evidence.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUS = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
});

const MAX_EVENTS = 500;

function nowIso() {
  return new Date().toISOString();
}

export class Store {
  /**
   * @param {string} filePath
   * @param {{ leaseTtlMs?: number }} [options]
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.leaseTtlMs = options.leaseTtlMs ?? 5 * 60 * 1000;
    this.state = {
      version: 1,
      lastSeq: 0,
      requests: [],
      worker: { id: null, lastHeartbeatAt: null, stopRequested: false },
      events: [],
    };
    this.#load();
  }

  #load() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.requests)) {
        this.state = parsed;
      }
    } catch (err) {
      // A missing file is a fresh install. A corrupt file is not — fail loudly
      // rather than silently discarding a user's request history.
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    }
  }

  /** Atomic, fsynced write. Either the old document or the new one survives. */
  #persist() {
    const tmp = `${this.filePath}.tmp`;
    const data = Buffer.from(JSON.stringify(this.state, null, 2), 'utf8');
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  #record(type, detail = {}) {
    this.state.events.push({ at: nowIso(), type, ...detail });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
  }

  // -- requests -------------------------------------------------------------

  /**
   * @param {string} prompt
   * @param {string} source
   */
  create(prompt, source = 'web', approval = null) {
    this.state.lastSeq += 1;
    const record = {
      id: randomUUID(),
      seq: this.state.lastSeq,
      prompt,
      source,
      status: STATUS.PENDING,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      claimedBy: null,
      leaseExpiresAt: null,
      attempts: 0,
      answer: null,
      answeredAt: null,
      answeredBy: null,
      error: null,
      control: /^STOP$/i.test(prompt.trim()),
      // Who proved they were authorised to submit this, if anyone.
      // null means the request arrived through an unauthenticated channel and
      // must never be read as approval for an irreversible action.
      approval,
    };
    this.state.requests.push(record);
    this.#record('request.created', { id: record.id, seq: record.seq });
    this.#persist();
    return record;
  }

  get(id) {
    return this.state.requests.find((r) => r.id === id) ?? null;
  }

  all() {
    return this.state.requests;
  }

  byStatus(...statuses) {
    return this.state.requests.filter((r) => statuses.includes(r.status));
  }

  /**
   * Claim a request for a worker. Fails if another live worker holds it, which
   * is what prevents two workers processing the same request concurrently.
   */
  claim(id, workerId) {
    const record = this.get(id);
    if (!record) return { ok: false, code: 404, error: 'không tìm thấy yêu cầu' };

    const leaseLive =
      record.status === STATUS.CLAIMED &&
      record.leaseExpiresAt &&
      new Date(record.leaseExpiresAt).getTime() > Date.now();

    if (leaseLive && record.claimedBy !== workerId) {
      return { ok: false, code: 409, error: 'yêu cầu đang được worker khác xử lý', request: record };
    }
    if (record.status === STATUS.COMPLETED) {
      return { ok: false, code: 409, error: 'yêu cầu đã hoàn tất', request: record };
    }
    if (record.status === STATUS.FAILED) {
      return { ok: false, code: 409, error: 'yêu cầu đã thất bại', request: record };
    }

    record.status = STATUS.CLAIMED;
    record.claimedBy = workerId;
    record.leaseExpiresAt = new Date(Date.now() + this.leaseTtlMs).toISOString();
    record.attempts += 1;
    record.updatedAt = nowIso();
    this.#record('request.claimed', { id, workerId, attempt: record.attempts });
    this.#persist();
    return { ok: true, request: record };
  }

  /**
   * Complete a request. Requires the caller to hold the claim, so ownership is
   * real rather than advisory. Idempotent for the same worker and identical
   * answer; a different answer is rejected so a replay cannot rewrite history.
   */
  complete(id, workerId, answer) {
    const record = this.get(id);
    if (!record) return { ok: false, code: 404, error: 'không tìm thấy yêu cầu' };

    if (record.status === STATUS.COMPLETED) {
      if (record.answer === answer) {
        return { ok: true, request: record, idempotent: true };
      }
      return { ok: false, code: 409, error: 'yêu cầu đã hoàn tất với nội dung khác', request: record };
    }
    if (record.status === STATUS.FAILED) {
      return { ok: false, code: 409, error: 'yêu cầu đã thất bại, không thể hoàn tất', request: record };
    }
    if (record.status !== STATUS.CLAIMED) {
      return { ok: false, code: 409, error: 'yêu cầu chưa được claim bởi worker này', request: record };
    }
    if (record.claimedBy !== workerId) {
      return { ok: false, code: 409, error: 'lease thuộc worker khác', request: record };
    }

    record.status = STATUS.COMPLETED;
    record.answer = answer;
    record.answeredAt = nowIso();
    record.answeredBy = workerId;
    record.updatedAt = nowIso();
    record.leaseExpiresAt = null;
    if (record.control) this.state.worker.stopRequested = true;

    this.#record('request.completed', { id, workerId, seq: record.seq });
    this.#persist();
    return { ok: true, request: record };
  }

  fail(id, workerId, error) {
    const record = this.get(id);
    if (!record) return { ok: false, code: 404, error: 'không tìm thấy yêu cầu' };
    if (record.status === STATUS.COMPLETED) {
      return { ok: false, code: 409, error: 'yêu cầu đã hoàn tất', request: record };
    }
    record.status = STATUS.FAILED;
    record.error = error;
    record.updatedAt = nowIso();
    record.leaseExpiresAt = null;
    this.#record('request.failed', { id, workerId, error });
    this.#persist();
    return { ok: true, request: record };
  }

  /**
   * Reclaim requests whose worker lease expired. This is the recovery hook: a
   * replacement worker can resume work the previous one abandoned.
   */
  reclaimExpired() {
    const reclaimed = [];
    const now = Date.now();
    for (const record of this.state.requests) {
      if (record.status !== STATUS.CLAIMED) continue;
      if (!record.leaseExpiresAt) continue;
      if (new Date(record.leaseExpiresAt).getTime() > now) continue;
      record.status = STATUS.PENDING;
      record.claimedBy = null;
      record.leaseExpiresAt = null;
      record.updatedAt = nowIso();
      reclaimed.push(record.id);
      this.#record('request.reclaimed', { id: record.id, seq: record.seq });
    }
    if (reclaimed.length) this.#persist();
    return reclaimed;
  }

  // -- worker ---------------------------------------------------------------

  heartbeat(workerId) {
    this.state.worker.id = workerId;
    this.state.worker.lastHeartbeatAt = nowIso();
    this.#persist();
    return this.workerHealth();
  }

  /**
   * Worker health, computed from observable state rather than asserted.
   *
   * `active`          a heartbeat arrived within the lease TTL
   * `recover_required` work is waiting and no live worker exists — this is the
   *                    post-turn-termination condition Arena gives no supported
   *                    way to clear automatically
   * `idle`            no waiting work and no live worker
   */
  workerHealth() {
    this.reclaimExpired();
    const waiting = this.byStatus(STATUS.PENDING).length;
    const last = this.state.worker.lastHeartbeatAt;
    const live = Boolean(last) && Date.now() - new Date(last).getTime() < this.leaseTtlMs;

    let state;
    if (live) state = 'active';
    else if (waiting > 0) state = 'recover_required';
    else state = 'idle';

    return {
      state,
      waiting,
      claimed: this.byStatus(STATUS.CLAIMED).length,
      completed: this.byStatus(STATUS.COMPLETED).length,
      failed: this.byStatus(STATUS.FAILED).length,
      lastHeartbeatAt: last,
      workerId: this.state.worker.id,
      stopRequested: this.state.worker.stopRequested,
      leaseTtlMs: this.leaseTtlMs,
    };
  }

  /** Everything a freshly activated worker needs to continue. */
  recoveryCheckpoint() {
    this.reclaimExpired();
    return {
      waiting: this.byStatus(STATUS.PENDING).map((r) => ({
        id: r.id,
        seq: r.seq,
        prompt: r.prompt,
        createdAt: r.createdAt,
        attempts: r.attempts,
      })),
      lastSeq: this.state.lastSeq,
      worker: {
        id: this.state.worker.id,
        lastHeartbeatAt: this.state.worker.lastHeartbeatAt,
        stopRequested: this.state.worker.stopRequested,
      },
    };
  }

  clearStop() {
    this.state.worker.stopRequested = false;
    this.#persist();
  }

  events(limit = 100) {
    return this.state.events.slice(-limit);
  }
}
