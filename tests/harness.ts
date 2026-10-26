/**
 * A test double for Pidgeon, faithful where it matters to Bouncer:
 * threads (a send with in_reply_to lands in that message's thread),
 * Idempotency-Key (a repeat returns the first result and sends nothing),
 * hand-off. Plus real Postgres (PGlite) for the store.
 */

import type { Classifier, FollowUpKind, ForwardVerdict } from "@/lib/classify";
import { createBouncer, type WebhookEvent } from "@/lib/bouncer";
import { loadConfig, type Config } from "@/lib/config";
import type { InboundMessage, MailPort, OutboundEmail, SentEmail } from "@/lib/mail/port";
import { createStore, type Sql } from "@/lib/store";
import { pglite } from "@/lib/store/connect";
import { cleanFirstName } from "@/lib/templates";

export interface Sent extends OutboundEmail {
  id: string;
  threadId: string;
}

export function fakePidgeon() {
  const messages = new Map<string, InboundMessage>();
  const attachments = new Map<string, Uint8Array>();
  const outbox: Sent[] = [];
  const forwards: { messageId: string; to: string; text: string; id: string }[] = [];
  const handOffs: { threadId: string; reason: string }[] = [];
  const deleted: string[] = [];
  const idempotency = new Map<string, { body: string; result: SentEmail }>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  function threadOf(messageId: string | undefined): string {
    if (messageId) {
      const inbound = messages.get(messageId);
      if (inbound) return inbound.threadId;
      const sent = outbox.find((m) => m.id === messageId);
      if (sent) return sent.threadId;
    }
    return nextId("thread");
  }

  const mail: MailPort = {
    async getMessage(id) {
      const message = messages.get(id);
      if (!message) throw new Error(`no such message ${id}`);
      return structuredClone(message);
    },
    async downloadAttachment(id) {
      const bytes = attachments.get(id);
      if (!bytes) throw new Error(`no such attachment ${id}`);
      return bytes;
    },
    async send(email) {
      if (!email.idempotencyKey) throw new Error("every send needs an Idempotency-Key");
      const body = JSON.stringify({ ...email, idempotencyKey: undefined });
      const seen = idempotency.get(email.idempotencyKey);
      if (seen) {
        if (seen.body !== body) throw new Error("409: Idempotency-Key reused with a different request");
        return seen.result;
      }
      const sent: Sent = { ...email, id: nextId("out"), threadId: threadOf(email.inReplyTo) };
      outbox.push(sent);
      idempotency.set(email.idempotencyKey, { body, result: { id: sent.id, threadId: sent.threadId } });
      return { id: sent.id, threadId: sent.threadId };
    },
    async forward(input) {
      const seen = idempotency.get(input.idempotencyKey);
      if (seen) return seen.result;
      const id = nextId("fwd");
      forwards.push({ ...input, id });
      const result = { id, threadId: nextId("thread") };
      idempotency.set(input.idempotencyKey, { body: "", result });
      return result;
    },
    async handOff(threadId, reason) {
      handOffs.push({ threadId, reason });
    },
    async deleteMessages(ids) {
      deleted.push(...ids);
      for (const id of ids) messages.delete(id);
    },
  };

  /** Mail arriving at one of Bouncer's addresses, as Pidgeon would deliver it. */
  function deliver(input: {
    to?: string;
    from: string;
    fromName?: string;
    subject?: string;
    text: string;
    replyText?: string;
    inReplyTo?: string;
    dmarc?: string | null;
    spf?: string | null;
    dkim?: string | null;
    firewall?: "clean" | "suspicious";
    headers?: Record<string, string>;
    attachment?: { filename: string; contentType: string; content: string };
    test?: boolean;
  }): { message: InboundMessage; event: WebhookEvent } {
    const id = nextId("in");
    const to = input.to ?? BOUNCER;
    const attachmentList = [];
    if (input.attachment) {
      const attachmentId = nextId("att");
      attachments.set(attachmentId, new TextEncoder().encode(input.attachment.content));
      attachmentList.push({ id: attachmentId, filename: input.attachment.filename, contentType: input.attachment.contentType });
    }
    const message: InboundMessage = {
      id,
      threadId: threadOf(input.inReplyTo),
      identity: to,
      from: { email: input.from, name: input.fromName ?? null },
      to: [{ email: to, name: null }],
      cc: [],
      subject: input.subject ?? "",
      text: input.text,
      replyText: input.replyText ?? input.text,
      headers: input.headers ?? {},
      authentication: {
        dmarc: input.dmarc === undefined ? "pass" : input.dmarc,
        spf: input.spf === undefined ? "pass" : input.spf,
        dkim: input.dkim === undefined ? "pass" : input.dkim,
      },
      firewall: {
        verdict: input.firewall ?? "clean",
        signals: input.firewall === "suspicious" ? [{ kind: "assistant_directive", detail: "addresses an AI" }] : [],
        cleanText: input.replyText ?? input.text,
      },
      attachments: attachmentList,
      test: input.test ?? false,
    };
    messages.set(id, message);
    const event: WebhookEvent = {
      id: nextId("evt"),
      type: "message.received",
      data: { message_id: id, thread_id: message.threadId, identity: to, from: input.from, from_self: false },
    };
    return { message, event };
  }

  return { mail, outbox, forwards, handOffs, deleted, deliver };
}

/**
 * A classifier you can read: markers in the text decide.
 *   forward: "[warm]" → not_cold, "[unsure]" → unsure, otherwise cold_sales.
 *   follow-up: "[ooo]" → auto_reply, "[question]" → genuine_reply,
 *              "[unsure]" → unsure, otherwise sequence_bump.
 */
export function scriptedClassifier(overrides: Partial<ForwardVerdict> = {}): Classifier & { calls: number } {
  const classifier = {
    calls: 0,
    async forward(input: { subject: string; body: string; senderName: string | null; senderEmail: string }) {
      classifier.calls++;
      const text = `${input.subject} ${input.body}`;
      const kind = text.includes("[warm]") ? "not_cold" : text.includes("[unsure]") ? "unsure" : "cold_sales";
      return {
        kind,
        senderFirstName: cleanFirstName(input.senderName),
        senderCompany: input.senderEmail.endsWith("@acme.com") ? "Acme" : null,
        summary: "Wants a 15-minute call about their platform",
        ...overrides,
      } as ForwardVerdict;
    },
    async followUp(input: { subject: string; body: string }): Promise<FollowUpKind> {
      classifier.calls++;
      const text = `${input.subject} ${input.body}`;
      if (text.includes("[ooo]")) return "auto_reply";
      if (text.includes("[question]")) return "genuine_reply";
      if (text.includes("[unsure]")) return "unsure";
      return "sequence_bump";
    },
  };
  return classifier;
}

/* One in-process Postgres per test file, emptied before each harness: starting PGlite is the slow part. */
let database: Promise<Sql> | undefined;
function sharedDatabase(): Promise<Sql> {
  database ??= pglite();
  return database;
}
async function truncateAll() {
  const sql = await sharedDatabase();
  await sql.exec(
    "truncate settings, cases, sends, suppressions, processed_events, mail_refs, ai_usage restart identity cascade",
  );
}

export async function harness(options: { config?: Partial<Config>; classifier?: Classifier; now?: Date } = {}) {
  const config: Config = {
    ...loadConfig({}),
    address: BOUNCER,
    ownerEmail: OWNER,
    ownerName: "Patrick",
    pidgeonApiKey: "pgn_live_unit_test_not_real",
    linkSecret: "test-link-secret",
    webhookSecret: "test-webhook-secret",
    cronSecret: "test-cron-secret",
    ...options.config,
  };
  const store = createStore(await sharedDatabase());
  await store.migrate();
  await truncateAll();
  const pidgeon = fakePidgeon();
  // The database stamps rows with its own now(), so the test clock starts at the real one.
  let now = options.now ?? new Date();
  const classifier = options.classifier ?? scriptedClassifier();
  const deps = { mail: pidgeon.mail, store, config, classifier, now: () => now };
  const bouncer = createBouncer(deps);

  return {
    config,
    store,
    pidgeon,
    bouncer,
    deps,
    classifier,
    setNow(date: Date) {
      now = date;
    },
    /** Deliver and process in one step, like a webhook would. */
    async receive(input: Parameters<typeof pidgeon.deliver>[0]) {
      const delivered = pidgeon.deliver(input);
      await bouncer.handleEvent(delivered.event);
      return delivered;
    },
    /** Everything sent to one address. */
    to(address: string) {
      return pidgeon.outbox.filter((m) => m.to === address);
    },
    /** Everything sent to anyone other than these addresses. */
    sentToAnyoneBut(...allowed: string[]) {
      return pidgeon.outbox.filter((m) => !allowed.includes(m.to));
    },
  };
}

export const OWNER = "patrick@example.com";
export const BOUNCER = "bouncer-patrick@pidgeon.email";
export const SALES = "mark@acme.com";

export function gmailForward(input: { fromName?: string; from?: string; subject?: string; body?: string; note?: string } = {}) {
  return [
    input.note ?? "",
    "",
    "---------- Forwarded message ---------",
    `From: ${input.fromName ?? "Mark Smith"} <${input.from ?? SALES}>`,
    "Date: Thu, 23 Oct 2026 at 10:02",
    `Subject: ${input.subject ?? "Quick question about your pipeline"}`,
    `To: Patrick <${OWNER}>`,
    "",
    input.body ?? "Hi Patrick, I noticed you're hiring. Worth a quick call to show you our platform? Mark",
  ].join("\n");
}
