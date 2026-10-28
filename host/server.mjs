#!/usr/bin/env node
// Entry point for the Arena host.
//
// Fails closed: without valid credentials the process refuses to start rather
// than serving an unauthenticated console. State is durable on disk, so
// restarting this process never loses a pending request — but note carefully
// that restarting this HTTP server is NOT the same as restarting the AI
// worker. See docs/ARENA_AGENT_CONNECTIVITY.md.

import { loadConfig } from './auth.mjs';
import { Store } from './store.mjs';
import { createHost } from './app.mjs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_FILE = resolve(process.env.HOST_DATA_FILE ?? 'host/data/state.json');
const LEASE_TTL_MS = Number(process.env.LEASE_TTL_MS ?? 5 * 60 * 1000);

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error('\nKhông khởi động host khi chưa có đủ thông tin xác thực.');
  console.error('Đặt APP_PASSWORD, SESSION_SECRET và AGENT_TOKEN (xem .env.example).');
  process.exit(1);
}

const store = new Store(DATA_FILE, { leaseTtlMs: LEASE_TTL_MS });
const server = createHost({ store, config, log: (line) => console.log(line) });

server.listen(PORT, HOST, () => {
  const health = store.workerHealth();
  console.log(`Arena host listening on http://${HOST}:${PORT}`);
  console.log(`State file: ${DATA_FILE}`);
  console.log(`Requests on disk: ${store.all().length} (waiting: ${health.waiting})`);
  console.log('Waiting for requests. Each submission prints NEW_REQUEST seq=<n> id=<uuid>.');
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received — shutting down gracefully.`);
  server.close(() => {
    // Store persists on every mutation, so there is nothing to flush; the
    // file is already consistent.
    console.log('HTTP listener closed. Durable state preserved on disk.');
    process.exit(0);
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
