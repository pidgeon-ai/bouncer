/**
 * The gate every outgoing email goes through. If you fork Bouncer, this is
 * the file to keep.
 *
 * Two doors, and nothing else in the codebase calls `mail.send`:
 *
 *  sendToStranger — a decline or a please-stop, to the salesperson.
 *    · The recipient is not a parameter. It is the sender of the email the
 *      user forwarded, read from the case — so Bouncer cannot be talked into
 *      writing to anyone else.
 *    · Only for a verified user (they answered from their own address and it
 *      passed DMARC), from their personal Bouncer address.
 *    · Never to a suppressed address, never to the user or to Bouncer itself.
 *    · At most one decline and one please-stop per case — enforced by a
 *      unique index in the database, not just by this code.
 *    · A daily cap per user and a global one.
 *
 *  sendToUser — anything to the person Bouncer works for, from the front door.
 *    · Capped per day, and tightly for addresses not yet verified, so the
 *      front door can't be used to flood someone with previews.
 *
 * Every send carries a deterministic Idempotency-Key, so a webhook retry
 * never sends twice.
 */

import type { Config } from "./config";
import type { MailPort, SentEmail } from "./mail/port";
import type { Case, Store, User } from "./store";

export interface GuardDeps {
  mail: MailPort;
  store: Store;
  config: Config;
  now: () => Date;
}

export type Refusal =
  | "not_verified"
  | "no_address"
  | "wrong_user"
  | "bad_recipient"
  | "suppressed"
  | "user_cap"
  | "global_cap"
  | "already_sent";

export type Outcome = { ok: true; sent: SentEmail } | { ok: false; refusal: Refusal };

const VALID_EMAIL = /^[^\s@<>()",;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Addresses Bouncer must never write to on someone's behalf. */
export function isForbiddenRecipient(email: string, user: Pick<User, "email">, config: Config): boolean {
  const to = email.trim().toLowerCase();
  if (!VALID_EMAIL.test(to)) return true;
  if (to === user.email) return true;
  if (to === config.frontDoor) return true;
  const domain = to.split("@")[1];
  if (domain === config.personalDomain || domain.endsWith(`.${config.personalDomain}`)) return true;
  if (/^(mailer-daemon|postmaster|abuse|noreply|no-reply|do-not-reply|donotreply)@/.test(to)) return true;
  return false;
}

export async function sendToStranger(
  deps: GuardDeps,
  input: {
    user: User;
    case: Case;
    kind: "decline" | "stop";
    subject: string;
    text: string;
    inReplyTo?: string;
  },
): Promise<Outcome> {
  const { user, case: c, kind } = input;
  const { store, config } = deps;

  if (user.status !== "verified") return { ok: false, refusal: "not_verified" };
  if (!user.address) return { ok: false, refusal: "no_address" };
  if (c.userEmail !== user.email) return { ok: false, refusal: "wrong_user" };

  const to = c.senderEmail;
  if (isForbiddenRecipient(to, user, config)) return { ok: false, refusal: "bad_recipient" };
  if (await store.isSuppressed(to)) return { ok: false, refusal: "suppressed" };

  const now = deps.now();
  if ((await store.thirdPartySendsToday(now, user.email)) >= config.dailyCapPerUser) {
    return { ok: false, refusal: "user_cap" };
  }
  if ((await store.thirdPartySendsToday(now)) >= config.dailyCapGlobal) {
    return { ok: false, refusal: "global_cap" };
  }

  if (!(await store.claimSend(user.email, c.id, kind))) return { ok: false, refusal: "already_sent" };

  try {
    const sent = await deps.mail.send({
      from: user.address,
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

/** Per UTC day: generous for verified users, tight for an address nobody has confirmed. */
export const USER_MAIL_CAP = { verified: 40, pending: 3 };

export async function sendToUser(
  deps: GuardDeps,
  input: {
    user: User;
    subject: string;
    text: string;
    inReplyTo?: string;
    idempotencyKey: string;
  },
): Promise<SentEmail | null> {
  const { store, config } = deps;
  const cap = input.user.status === "verified" ? USER_MAIL_CAP.verified : USER_MAIL_CAP.pending;
  if ((await store.userMailToday(input.user.email, deps.now())) >= cap) return null;

  await store.claimSend(input.user.email, null, "to_user");
  const sent = await deps.mail.send({
    from: config.frontDoor,
    to: input.user.email,
    subject: input.subject,
    text: input.text,
    inReplyTo: input.inReplyTo,
    idempotencyKey: input.idempotencyKey,
  });
  await store.rememberMessages([sent.id]);
  return sent;
}

/** Forward a follow-up to the user, from their personal address. Same cap as sendToUser. */
export async function forwardToUser(
  deps: GuardDeps,
  input: { user: User; messageId: string; text: string },
): Promise<SentEmail | null> {
  const { store } = deps;
  if ((await store.userMailToday(input.user.email, deps.now())) >= USER_MAIL_CAP.verified) return null;
  await store.claimSend(input.user.email, null, "to_user");
  const sent = await deps.mail.forward({
    messageId: input.messageId,
    to: input.user.email,
    text: input.text,
    idempotencyKey: `bouncer:handoff:${input.messageId}`,
  });
  await store.rememberMessages([sent.id]);
  return sent;
}
