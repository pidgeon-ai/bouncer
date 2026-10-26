/**
 * The whole database. Small on purpose: one row per cold email Bouncer
 * handled, the owner's chosen style, and counters. Message bodies stay in
 * Pidgeon and are deleted from there after the retention period.
 */
export const SCHEMA = /* sql */ `
-- The owner's choices, e.g. style = '2' after they email Bouncer "2".
create table if not exists settings (
  key    text primary key,
  value  text not null
);

create table if not exists cases (
  id                text primary key,
  status            text not null,  -- ask | declined | stopped | handed_off | dismissed
  reason            text,           -- why Bouncer asked instead of acting
  sender_email      text not null,  -- the ONLY address Bouncer may write to for this case
  sender_name       text,
  sender_company    text,
  subject           text,
  summary           text,
  source_message_id text not null unique,  -- the owner's forward
  ask_thread_id     text,           -- the thread where Bouncer asked the owner
  out_thread_id     text,           -- the thread with the salesperson
  created_at        timestamptz not null default now(),
  declined_at       timestamptz
);
create index if not exists cases_ask_thread on cases (ask_thread_id);
create index if not exists cases_out_thread on cases (out_thread_id);

-- Every email Bouncer sends. The unique index is the "one decline per thread,
-- at most one please-stop" rule, enforced by the database itself.
create table if not exists sends (
  id          bigserial primary key,
  case_id     text,
  kind        text not null,  -- decline | stop | to_owner
  created_at  timestamptz not null default now()
);
create unique index if not exists sends_once_per_case
  on sends (case_id, kind) where kind in ('decline', 'stop');
create index if not exists sends_day on sends (created_at);

-- People who asked never to hear from this Bouncer. Stored as a hash, not the address.
create table if not exists suppressions (
  email_hash  text primary key,
  created_at  timestamptz not null default now()
);

-- Webhook deliveries already handled, so a retry does nothing twice.
create table if not exists processed_events (
  id          text primary key,
  created_at  timestamptz not null default now()
);

-- Pidgeon message ids Bouncer touched, so they can be deleted on schedule.
create table if not exists mail_refs (
  message_id  text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists ai_usage (
  day            date primary key,
  calls          integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0
);
`;
