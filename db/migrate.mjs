#!/usr/bin/env node
// Applies db/schema.sql to the database named by DATABASE_URL.
//
// The schema is idempotent, so re-running is safe. This script refuses to run
// without DATABASE_URL rather than silently doing nothing, and never prints the
// connection string (it may contain a password).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Thiếu DATABASE_URL. Sao chép .env.example thành .env và đặt DATABASE_URL trước khi chạy migrate.');
  process.exit(2);
}

function describe(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return `${parsed.hostname}/${parsed.pathname.replace(/^\//, '')}`;
  } catch {
    return '(không đọc được URL)';
  }
}

console.log(`Đang áp dụng schema cho ${describe(url)} …`);

const sql = postgres(url, { max: 1, connect_timeout: 15 });
try {
  await sql.unsafe(schema);
  const [{ count }] = await sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`;
  console.log(`Xong. ${count} bảng trong schema public.`);
} catch (error) {
  console.error('Áp dụng schema thất bại:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
