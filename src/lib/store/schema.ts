/**
 * The whole database. Small on purpose: Bouncer stores who its users are,
 * one row per cold email it handled, and counters. Message bodies stay in
 * Pidgeon and are deleted from there after the retention period.
 */
export const SCHEMA = /* sql */ `
create table if not exists users (
  email        text primary key,
  first_name   text,
  status       text not null default 'pending',   -- pending | verified
  style        smallint not null default 1,       -- 1 polite no · 2 not now · 3 summary first
  pod_id       text,
  identity_id  text,
  address      text unique,                       -- their personal Bouncer address
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);

create table if not exists cases (
  id                text primary key,
  user_email        text not null references users(email) on delete cascade,
  status            text not null,  -- preview | ask | declined | stopped | handed_off | dismissed
  reason            text,           -- why Bouncer asked instead of acting
  sender_email      text not null,  -- the ONLY address Bouncer may write to for this case
  sender_name       text,
  sender_company    text,
  subject           text,
  summary           text,
  source_message_id text not null,  -- the user's forward
  ask_thread_id     text,           -- the thread where Bouncer asked the user
  out_thread_id     text,           -- the thread with the salesperson
  created_at        timestamptz not null default now(),
  declined_at       timestamptz
);
create index if not exists cases_ask_thread on cases (ask_thread_id);
create index if not exists cases_out_thread on cases (out_thread_id);
create index if not exists cases_user_created on cases (user_email, created_at);

-- Every email Bouncer sends. The unique index is the "one decline per thread,
-- at most one please-stop" rule, enforced by the database itself.
create table if not exists sends (
  id          bigserial primary key,
  user_email  text not null,
  case_id     text,
  kind        text not null,  -- decline | stop | to_user
  created_at  timestamptz not null default now()
);
create unique index if not exists sends_once_per_case
  on sends (case_id, kind) where kind in ('decline', 'stop');
create index if not exists sends_user_day on sends (user_email, created_at);

-- People who asked never to hear from Bouncer. Stored as a hash, not the address.
create table if not exists suppressions (
  email_hash  text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists reports (
  id          bigserial primary key,
  email_hash  text,
  note        text,
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
