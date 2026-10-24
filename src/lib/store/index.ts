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

export type Style = 1 | 2 | 3;

export interface User {
  email: string;
  firstName: string | null;
  status: "pending" | "verified";
  style: Style;
  podId: string | null;
  identityId: string | null;
  address: string | null;
}

export type CaseStatus = "preview" | "ask" | "declined" | "stopped" | "handed_off" | "dismissed";

export interface Case {
  id: string;
  userEmail: string;
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

export type SendKind = "decline" | "stop" | "to_user";

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/* Row mappers: snake_case in the database, camelCase in the code. */

type Row = Record<string, unknown>;

function toUser(row: Row): User {
  return {
    email: row.email as string,
    firstName: (row.first_name as string) ?? null,
    status: row.status as User["status"],
    style: Number(row.style) as Style,
    podId: (row.pod_id as string) ?? null,
    identityId: (row.identity_id as string) ?? null,
    address: (row.address as string) ?? null,
  };
}

function toCase(row: Row): Case {
  return {
    id: row.id as string,
    userEmail: row.user_email as string,
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
  senderName: "sender_name",
  senderCompany: "sender_company",
  subject: "subject",
  summary: "summary",
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

    /* ── Users ─────────────────────────────────────────────── */

    async getUser(email: string): Promise<User | null> {
      const [row] = await sql.query("select * from users where email = $1", [email]);
      return row ? toUser(row) : null;
    },

    async getUserByAddress(address: string): Promise<User | null> {
      const [row] = await sql.query("select * from users where address = $1", [address]);
      return row ? toUser(row) : null;
    },

    async addPendingUser(email: string, firstName: string | null): Promise<User> {
      await sql.query(
        `insert into users (email, first_name) values ($1, $2)
         on conflict (email) do update set first_name = coalesce(users.first_name, excluded.first_name)`,
        [email, firstName],
      );
      return (await this.getUser(email))!;
    },

    async verifyUser(email: string, style: Style): Promise<void> {
      await sql.query(
        `update users set status = 'verified', style = $2, verified_at = coalesce(verified_at, now())
         where email = $1`,
        [email, style],
      );
    },

    async setStyle(email: string, style: Style): Promise<void> {
      await sql.query("update users set style = $2 where email = $1", [email, style]);
    },

    async setPod(email: string, podId: string): Promise<void> {
      await sql.query("update users set pod_id = $2 where email = $1", [email, podId]);
    },

    async setAddress(email: string, identityId: string, address: string): Promise<void> {
      await sql.query("update users set identity_id = $2, address = $3 where email = $1", [
        email,
        identityId,
        address,
      ]);
    },

    async addressTaken(address: string): Promise<boolean> {
      const rows = await sql.query("select 1 from users where address = $1", [address]);
      return rows.length > 0;
    },

    async deleteUser(email: string): Promise<void> {
      await sql.query("delete from users where email = $1", [email]);
    },

    async verifiedUsers(): Promise<User[]> {
      const rows = await sql.query("select * from users where status = 'verified' order by email");
      return rows.map(toUser);
    },

    /* ── Cases: one per forwarded cold email ───────────────── */

    async createCase(input: {
      userEmail: string;
      status: CaseStatus;
      reason?: string | null;
      senderEmail: string;
      senderName: string | null;
      senderCompany: string | null;
      subject: string | null;
      summary: string | null;
      sourceMessageId: string;
    }): Promise<Case> {
      const id = randomUUID();
      await sql.query(
        `insert into cases (id, user_email, status, reason, sender_email, sender_name,
                            sender_company, subject, summary, source_message_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          input.userEmail,
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
      return (await this.getCase(id))!;
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

    async caseBySource(userEmail: string, sourceMessageId: string): Promise<Case | null> {
      const [row] = await sql.query(
        "select * from cases where user_email = $1 and source_message_id = $2",
        [userEmail, sourceMessageId],
      );
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

    async declinesSince(userEmail: string, since: Date): Promise<number> {
      const [row] = await sql.query<{ n: string }>(
        "select count(*) as n from cases where user_email = $1 and declined_at >= $2",
        [userEmail, since.toISOString()],
      );
      return Number(row?.n ?? 0);
    },

    /* ── Sends: the ledger behind every cap ────────────────── */

    /**
     * Records a send before it happens. Returns false when this case already
     * had one of this kind: the database refuses a second decline or a second
     * please-stop, whatever the code above it does.
     */
    async claimSend(userEmail: string, caseId: string | null, kind: SendKind): Promise<boolean> {
      const rows = await sql.query(
        `insert into sends (user_email, case_id, kind) values ($1, $2, $3)
         on conflict do nothing returning id`,
        [userEmail, caseId, kind],
      );
      return rows.length > 0;
    },

    /** Undo a claim when the send itself failed, so a retry can run. */
    async releaseSend(caseId: string, kind: SendKind): Promise<void> {
      await sql.query("delete from sends where case_id = $1 and kind = $2", [caseId, kind]);
    },

    async thirdPartySendsToday(now: Date, userEmail?: string): Promise<number> {
      const params: unknown[] = [startOfUtcDay(now).toISOString()];
      let filter = "";
      if (userEmail) {
        params.push(userEmail);
        filter = "and user_email = $2";
      }
      const [row] = await sql.query<{ n: string }>(
        `select count(*) as n from sends
         where kind in ('decline', 'stop') and created_at >= $1 ${filter}`,
        params,
      );
      return Number(row?.n ?? 0);
    },

    async userMailToday(userEmail: string, now: Date): Promise<number> {
      const [row] = await sql.query<{ n: string }>(
        `select count(*) as n from sends where kind = 'to_user' and user_email = $1 and created_at >= $2`,
        [userEmail, startOfUtcDay(now).toISOString()],
      );
      return Number(row?.n ?? 0);
    },

    /* ── Suppression and reports ───────────────────────────── */

    async isSuppressed(email: string): Promise<boolean> {
      const rows = await sql.query("select 1 from suppressions where email_hash = $1", [hashEmail(email)]);
      return rows.length > 0;
    },

    async suppress(email: string): Promise<void> {
      await sql.query("insert into suppressions (email_hash) values ($1) on conflict do nothing", [
        hashEmail(email),
      ]);
    },

    async addReport(email: string, note: string): Promise<void> {
      await sql.query("insert into reports (email_hash, note) values ($1, $2)", [
        hashEmail(email),
        note.slice(0, 2000),
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
