import { createHash, randomUUID } from "node:crypto";

import { SCHEMA } from "./schema";

/**
 * Bouncer's data, behind one small interface.
 *
 * Written against a two-method SQL executor, so the same code runs on
 * Postgres in production (`postgres` driver) and on PGlite in local dev and
 * the tests. No ORM: the queries are the documentation.
 */

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}

/** 1 polite no · 2 not now, try next quarter · 3 ask me first. */
export type Style = 1 | 2 | 3;

export type CaseStatus = "ask" | "declined" | "stopped" | "handed_off" | "dismissed";

export interface Case {
  id: string;
  status: CaseStatus;
  reason: string | null;
  senderEmail: string;
  senderName: string | null;
  senderCompany: string | null;
  subject: string | null;
  summary: string | null;
  sourceMessageId: string;
  askThreadId: string | null;
  outThreadId: string | null;
  createdAt: Date;
}

export type SendKind = "decline" | "stop" | "to_owner";

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

type Row = Record<string, unknown>;

function toCase(row: Row): Case {
  return {
    id: row.id as string,
    status: row.status as CaseStatus,
    reason: (row.reason as string) ?? null,
    senderEmail: row.sender_email as string,
    senderName: (row.sender_name as string) ?? null,
    senderCompany: (row.sender_company as string) ?? null,
    subject: (row.subject as string) ?? null,
    summary: (row.summary as string) ?? null,
    sourceMessageId: row.source_message_id as string,
    askThreadId: (row.ask_thread_id as string) ?? null,
    outThreadId: (row.out_thread_id as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

const CASE_COLUMNS: Record<string, string> = {
  status: "status",
  reason: "reason",
  askThreadId: "ask_thread_id",
  outThreadId: "out_thread_id",
};

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function createStore(sql: Sql) {
  return {
    async migrate() {
      await sql.exec(SCHEMA);
    },

    /* ── The owner's style ─────────────────────────────────── */

    async style(fallback: Style): Promise<Style> {
      const [row] = await sql.query<{ value: string }>("select value from settings where key = 'style'");
      const value = Number(row?.value);
      return value === 1 || value === 2 || value === 3 ? value : fallback;
    },

    async setStyle(style: Style): Promise<void> {
      await sql.query(
        `insert into settings (key, value) values ('style', $1)
         on conflict (key) do update set value = excluded.value`,
        [String(style)],
      );
    },

    /* ── Cases: one per forwarded cold email ───────────────── */

    async createCase(input: {
      status: CaseStatus;
      reason?: string | null;
      senderEmail: string;
      senderName: string | null;
      senderCompany: string | null;
      subject: string | null;
      summary: string | null;
      sourceMessageId: string;
    }): Promise<Case | null> {
      const id = randomUUID();
      const rows = await sql.query(
        `insert into cases (id, status, reason, sender_email, sender_name,
                            sender_company, subject, summary, source_message_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (source_message_id) do nothing returning id`,
        [
          id,
          input.status,
          input.reason ?? null,
          input.senderEmail,
          input.senderName,
          input.senderCompany,
          input.subject,
          input.summary,
          input.sourceMessageId,
        ],
      );
      return rows.length ? this.getCase(id) : null; // null: this forward was already handled
    },

    async getCase(id: string): Promise<Case | null> {
      const [row] = await sql.query("select * from cases where id = $1", [id]);
      return row ? toCase(row) : null;
    },

    async caseByAskThread(threadId: string): Promise<Case | null> {
      const [row] = await sql.query(
        "select * from cases where ask_thread_id = $1 order by created_at desc limit 1",
        [threadId],
      );
      return row ? toCase(row) : null;
    },

    async caseByOutThread(threadId: string): Promise<Case | null> {
      const [row] = await sql.query("select * from cases where out_thread_id = $1", [threadId]);
      return row ? toCase(row) : null;
    },

    async updateCase(
      id: string,
      patch: Partial<Pick<Case, "status" | "reason" | "askThreadId" | "outThreadId">>,
    ): Promise<void> {
      const entries = Object.entries(patch).filter(([key]) => key in CASE_COLUMNS);
      if (entries.length === 0) return;
      const sets = entries.map(([key], i) => `${CASE_COLUMNS[key]} = $${i + 2}`);
      if (patch.status === "declined") sets.push("declined_at = coalesce(declined_at, now())");
      await sql.query(`update cases set ${sets.join(", ")} where id = $1`, [
        id,
        ...entries.map(([, value]) => value),
      ]);
    },

    async declinesSince(since: Date): Promise<number> {
      const [row] = await sql.query<{ n: string }>("select count(*) as n from cases where declined_at >= $1", [
        since.toISOString(),
      ]);
      return Number(row?.n ?? 0);
    },

    /* ── Sends: the ledger behind every cap ────────────────── */

    /**
     * Records a send before it happens. Returns false when this case already
     * had one of this kind: the database refuses a second decline or a second
     * please-stop, whatever the code above it does.
     */
    async claimSend(caseId: string | null, kind: SendKind): Promise<boolean> {
      const rows = await sql.query(
        "insert into sends (case_id, kind) values ($1, $2) on conflict do nothing returning id",
        [caseId, kind],
      );
      return rows.length > 0;
    },

    /** Undo a claim when the send itself failed, so a retry can run. */
    async releaseSend(caseId: string, kind: SendKind): Promise<void> {
      await sql.query("delete from sends where case_id = $1 and kind = $2", [caseId, kind]);
    },

    async sendsToday(now: Date, kinds: SendKind[]): Promise<number> {
      const [row] = await sql.query<{ n: string }>(
        "select count(*) as n from sends where kind = any($1) and created_at >= $2",
        [kinds, startOfUtcDay(now).toISOString()],
      );
      return Number(row?.n ?? 0);
    },

    /* ── Suppression ───────────────────────────────────────── */

    async isSuppressed(email: string): Promise<boolean> {
      const rows = await sql.query("select 1 from suppressions where email_hash = $1", [hashEmail(email)]);
      return rows.length > 0;
    },

    async suppress(email: string): Promise<void> {
      await sql.query("insert into suppressions (email_hash) values ($1) on conflict do nothing", [
        hashEmail(email),
      ]);
    },

    /* ── Webhook de-duplication ────────────────────────────── */

    /** True the first time an event id is seen; false on a redelivery. */
    async firstDelivery(eventId: string): Promise<boolean> {
      const rows = await sql.query(
        "insert into processed_events (id) values ($1) on conflict do nothing returning id",
        [eventId],
      );
      return rows.length > 0;
    },

    async forgetDelivery(eventId: string): Promise<void> {
      await sql.query("delete from processed_events where id = $1", [eventId]);
    },

    /* ── Retention ─────────────────────────────────────────── */

    async rememberMessages(ids: string[]): Promise<void> {
      for (const id of ids) {
        await sql.query("insert into mail_refs (message_id) values ($1) on conflict do nothing", [id]);
      }
    },

    async messagesOlderThan(cutoff: Date, limit = 500): Promise<string[]> {
      const rows = await sql.query<{ message_id: string }>(
        "select message_id from mail_refs where created_at < $1 order by created_at limit $2",
        [cutoff.toISOString(), limit],
      );
      return rows.map((r) => r.message_id);
    },

    async forgetMessages(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await sql.query("delete from mail_refs where message_id = any($1)", [ids]);
    },

    /** Deletes cases (names, subjects, summaries) and old bookkeeping past the cutoff. */
    async purgeOlderThan(cutoff: Date): Promise<void> {
      const at = cutoff.toISOString();
      await sql.query("delete from cases where created_at < $1", [at]);
      await sql.query("delete from processed_events where created_at < $1", [at]);
      await sql.query("delete from sends where created_at < $1", [at]);
    },

    /* ── Model budget ──────────────────────────────────────── */

    async aiCallsToday(now: Date): Promise<number> {
      const [row] = await sql.query<{ calls: number }>("select calls from ai_usage where day = $1", [
        startOfUtcDay(now).toISOString().slice(0, 10),
      ]);
      return Number(row?.calls ?? 0);
    },

    async recordAiCall(now: Date, inputTokens: number, outputTokens: number): Promise<void> {
      await sql.query(
        `insert into ai_usage (day, calls, input_tokens, output_tokens) values ($1, 1, $2, $3)
         on conflict (day) do update set calls = ai_usage.calls + 1,
           input_tokens = ai_usage.input_tokens + excluded.input_tokens,
           output_tokens = ai_usage.output_tokens + excluded.output_tokens`,
        [startOfUtcDay(now).toISOString().slice(0, 10), inputTokens, outputTokens],
      );
    },
  };
}

export type Store = ReturnType<typeof createStore>;
