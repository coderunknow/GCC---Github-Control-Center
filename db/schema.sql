-- GitHub Project Control Center — schema
-- Target: PostgreSQL 14+ (Supabase-compatible). Idempotent: safe to re-run.
--
-- Design notes
--  * GitHub is the source of truth. Everything cached here carries
--    `fetched_at` so the UI can state data freshness instead of implying
--    the cache is live.
--  * Idempotency keys on event tables prevent duplicate history rows when a
--    webhook is retried or a poll re-reads the same page.
--  * No secrets are stored. Tokens live only in environment variables.

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Cache of repositories the token can see, refreshed by sync.
create table if not exists repositories (
  id             bigint primary key,              -- GitHub numeric id
  full_name      text not null unique,
  owner          text not null,
  name           text not null,
  description    text,
  is_private     boolean not null default false,
  default_branch text,
  html_url       text not null,
  pushed_at      timestamptz,
  is_tracked     boolean not null default true,
  fetched_at     timestamptz not null default now()
);
create index if not exists repositories_pushed_idx on repositories (pushed_at desc nulls last);

-- One row per GitHub event we have processed (webhook or poll).
create table if not exists github_events (
  id             bigint generated always as identity primary key,
  delivery_id    text unique,                     -- X-GitHub-Delivery when webhook
  event_type     text not null,
  action         text,
  repository     text,
  actor          text,
  source         text not null check (source in ('webhook', 'poll')),
  payload_sha256 text not null,                   -- dedupe for polled events
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  status         text not null default 'received'
                 check (status in ('received', 'processed', 'failed', 'ignored')),
  error          text
);
create index if not exists github_events_received_idx on github_events (received_at desc);
create unique index if not exists github_events_dedupe_idx
  on github_events (event_type, payload_sha256) where delivery_id is null;

-- Notifications surfaced to the user, derived from events.
create table if not exists notifications (
  id           bigint generated always as identity primary key,
  event_id     bigint references github_events (id) on delete set null,
  repository   text,
  kind         text not null,
  title        text not null,
  body         text,
  url          text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists notifications_created_idx on notifications (created_at desc);

-- Synchronisation checkpoints so an interrupted sync resumes rather than restarts.
create table if not exists sync_state (
  resource     text primary key,
  cursor       text,
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  etag         text
);

-- Audit of application operations. Append-only by intent; no update path exists.
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  target      text,
  outcome     text not null check (outcome in ('ok', 'denied', 'failed', 'blocked')),
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_occurred_idx on audit_log (occurred_at desc);

-- Arena request ledger.
--
-- IMPORTANT: a row here records what the USER INTENDED and what the
-- application observed. It is not proof that the Arena agent received or
-- executed anything. `delivery_state` has no 'delivered' or 'running'
-- value on purpose: Arena exposes no supported inbound trigger, so those
-- states cannot honestly be reached.
create table if not exists arena_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  requested_by   text not null,
  title          text not null,
  body           text not null,
  target_session text,                            -- only if a session handle is legitimately known
  delivery_state text not null default 'blocked'
                 check (delivery_state in (
                   'draft',            -- prepared, not submitted anywhere
                   'awaiting_handoff', -- waiting for the human to paste it into Arena
                   'blocked',          -- no supported delivery path exists
                   'failed'
                 )),
  delivery_note  text,
  evidence_url   text
);
create index if not exists arena_requests_created_idx on arena_requests (created_at desc);

-- Generated reports, with a record of what data went into them.
create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   text not null,
  format       text not null check (format in ('csv', 'json', 'markdown')),
  range_from   timestamptz,
  range_to     timestamptz,
  repositories text[] not null default '{}',
  row_count    integer not null default 0,
  sha256       text not null,
  content      text not null,
  incomplete   text[] not null default '{}'
);
create index if not exists reports_created_idx on reports (created_at desc);

-- Retention policy. Default: keep everything until the user deletes it.
insert into app_settings (key, value)
values ('retention', '{"events_days": null, "notifications_days": null, "audit_days": null}'::jsonb)
on conflict (key) do nothing;
