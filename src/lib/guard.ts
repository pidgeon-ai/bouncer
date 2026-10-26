/**
 * The gate every outgoing email goes through. If you fork Bouncer to build a
 * different agent, this is the file to keep.
 *
 * Nothing else in the codebase calls `mail.send` or `mail.forward`.
 *
 *  sendToStranger — a decline or a please-stop, to the salesperson.
 *    · The recipient is not a parameter. It is the sender of the email the
 *      owner forwarded, read from the case — so Bouncer cannot be talked into
 *      writing to anyone else.
 *    · Never to a suppressed address, never to the owner, Bouncer itself or
 *      a robot address.
 *    · At most one decline and one please-stop per case — enforced by a
 *      unique index in the database, not just by this code.
 *    · A daily cap.
 *
 *  sendToOwner / forwardToOwner — anything to the person Bouncer works for.
 *    · Capped per day, so a flood of inbound mail can't become a flood of
 *      notifications.
 *
 * Every send carries a deterministic Idempotency-Key, so a webhook retry
 * never sends twice.
 */

import type { Config } from "./config";
import type { MailPort, SentEmail } from "./mail/port";
import type { Case, Store } from "./store";

export interface GuardDeps {
  mail: MailPort;
  store: Store;
  config: Config;
  now: () => Date;
}

export type Refusal = "bad_recipient" | "suppressed" | "daily_cap" | "already_sent";

export type Outcome = { ok: true; sent: SentEmail } | { ok: false; refusal: Refusal };

const VALID_EMAIL = /^[^\s@<>()",;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Addresses Bouncer must never write to on the owner's behalf. */
export function isForbiddenRecipient(email: string, config: Pick<Config, "address" | "ownerEmail">): boolean {
  const to = email.trim().toLowerCase();
  if (!VALID_EMAIL.test(to)) return true;
  if (to === config.ownerEmail || to === config.address) return true;
  if (/^(mailer-daemon|postmaster|abuse|noreply|no-reply|do-not-reply|donotreply)@/.test(to)) return true;
  return false;
}

export async function sendToStranger(
  deps: GuardDeps,
  input: { case: Case; kind: "decline" | "stop"; subject: string; text: string; inReplyTo?: string },
): Promise<Outcome> {
  const { case: c, kind } = input;
  const { store, config } = deps;

  const to = c.senderEmail;
  if (isForbiddenRecipient(to, config)) return { ok: false, refusal: "bad_recipient" };
  if (await store.isSuppressed(to)) return { ok: false, refusal: "suppressed" };
  if ((await store.sendsToday(deps.now(), ["decline", "stop"])) >= config.dailyCap) {
    return { ok: false, refusal: "daily_cap" };
  }
  if (!(await store.claimSend(c.id, kind))) return { ok: false, refusal: "already_sent" };

  try {
    const sent = await deps.mail.send({
      from: config.address,
      to,
      subject: input.subject,
      text: input.text,
      inReplyTo: input.inReplyTo,
      idempotencyKey: `bouncer:${kind}:${c.id}`,
    });
    await store.rememberMessages([sent.id]);
    return { ok: true, sent };
  } catch (error) {
    // Nothing went out: let a retry of this webhook try again.
    await store.releaseSend(c.id, kind);
    throw error;
  }
}

/** Emails and forwards to the owner per UTC day. */
export const OWNER_MAIL_CAP = 40;

export async function sendToOwner(
  deps: GuardDeps,
  input: { subject: string; text: string; inReplyTo?: string; idempotencyKey: string },
): Promise<SentEmail | null> {
  const { store, config } = deps;
  if ((await store.sendsToday(deps.now(), ["to_owner"])) >= OWNER_MAIL_CAP) return null;
  await store.claimSend(null, "to_owner");
  const sent = await deps.mail.send({
    from: config.address,
    to: config.ownerEmail,
    subject: input.subject,
    text: input.text,
    inReplyTo: input.inReplyTo,
    idempotencyKey: input.idempotencyKey,
  });
  await store.rememberMessages([sent.id]);
  return sent;
}

/** Forward a message (a follow-up) to the owner as-is, with a note on top. */
export async function forwardToOwner(
  deps: GuardDeps,
  input: { messageId: string; text: string },
): Promise<SentEmail | null> {
  const { store, config } = deps;
  if ((await store.sendsToday(deps.now(), ["to_owner"])) >= OWNER_MAIL_CAP) return null;
  await store.claimSend(null, "to_owner");
  const sent = await deps.mail.forward({
    messageId: input.messageId,
    to: config.ownerEmail,
    text: input.text,
    idempotencyKey: `bouncer:handoff:${input.messageId}`,
  });
  await store.rememberMessages([sent.id]);
  return sent;
}
