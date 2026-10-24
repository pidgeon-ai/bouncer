/**
 * Bouncer, start to finish. One function per thing that can arrive.
 *
 *   forward to the front door ──► first time: preview to the user, wait for YES
 *                               └► verified:  decline from their Bouncer address
 *                                             (or ask them, when it isn't cold)
 *   reply from the user          ──► YES / 1 / 2 / 3 / NO, DELETE
 *   reply to a decline           ──► sequence bump: one please-stop, then silence
 *                                   real person:   hand the thread to the user
 *
 * Every email out goes through guard.ts. Every email in is untrusted.
 */

import { isAuthenticated } from "./auth";
import type { Classifier } from "./classify";
import { looksAutomatic } from "./classify";
import { isTestKey } from "./config";
import { parseInlineForward, parseRfc822, stripForwardPrefix, type ForwardedEmail } from "./forward";
import { forwardToUser, sendToStranger, sendToUser, type GuardDeps, type Refusal } from "./guard";
import { reportUrl, stopUrl } from "./links";
import type { InboundMessage } from "./mail/port";
import { hashEmail, type Case, type Style, type User } from "./store";
import * as copy from "./templates";

export interface BouncerDeps extends GuardDeps {
  classifier: Classifier;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export function createBouncer(deps: BouncerDeps) {
  const { mail, store, config, classifier } = deps;

  /* ── Entry point: one verified webhook event ────────────────────── */

  async function handleEvent(event: WebhookEvent): Promise<void> {
    if (event.type !== "message.received") return;
    if (event.data.from_self === true) return; // our own mail arriving at our other addresses
    const messageId = event.data.message_id;
    if (typeof messageId !== "string") return;

    if (!(await store.firstDelivery(event.id))) return; // a redelivery: already handled
    try {
      const message = await mail.getMessage(messageId);
      await store.rememberMessages([message.id]);
      await handleMessage(message);
    } catch (error) {
      await store.forgetDelivery(event.id); // let Pidgeon's retry run it again
      throw error;
    }
  }

  async function handleMessage(message: InboundMessage): Promise<void> {
    const from = message.from.email;
    if (isBouncerAddress(from)) return; // never talk to ourselves
    if (message.identity === config.frontDoor) return frontDoor(message);
    if (message.identity.endsWith(`@${config.personalDomain}`)) return personalAddress(message);
  }

  function isBouncerAddress(email: string): boolean {
    return email === config.frontDoor || email.endsWith(`@${config.personalDomain}`);
  }

  /* ── The front door: bouncer@pidgeon.ai ─────────────────────────── */

  async function frontDoor(message: InboundMessage): Promise<void> {
    // Auto-forwarded or BCC'd mail keeps the ORIGINAL From — the salesperson.
    // Treating them as the user would email them a preview. Bouncer only acts
    // on mail a person deliberately addressed to it.
    const addressed = [...message.to, ...message.cc].some((a) => a.email === config.frontDoor);
    if (!addressed) return;
    // Bounces, out-of-office replies and robots: never answer.
    if (looksAutomatic(message.subject, message.headers)) return;
    if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|[a-z-]*noreply)[+@]/i.test(message.from.email)) return;
    // Spoofed From lines get nothing at all, not even a preview.
    if (!isAuthenticated(message, config)) {
      console.warn("front door: unauthenticated message ignored", message.id);
      return;
    }

    const userEmail = message.from.email;
    const existing = await store.getUser(userEmail);

    // A reply in a thread where Bouncer asked this user something.
    const asked = await store.caseByAskThread(message.threadId);
    if (asked && asked.userEmail === userEmail && existing && isOpen(asked)) {
      return answer(existing, asked, message);
    }

    const forwarded = await findForward(message);
    if (!forwarded) {
      if (existing?.status === "verified" && (await command(existing, message))) return;
      const user = existing ?? (await store.addPendingUser(userEmail, copy.cleanFirstName(message.from.name)));
      await sendToUser(deps, {
        user,
        subject: reSubject(message.subject),
        text: copy.couldNotParseEmail({ siteUrl: config.siteUrl }),
        inReplyTo: message.id,
        idempotencyKey: `bouncer:noparse:${message.id}`,
      });
      return;
    }

    const user = existing ?? (await store.addPendingUser(userEmail, copy.cleanFirstName(message.from.name)));
    return newForward(user, message, forwarded);
  }

  async function findForward(message: InboundMessage): Promise<ForwardedEmail | null> {
    const attached = message.attachments.find(
      (a) => a.contentType === "message/rfc822" || a.filename.toLowerCase().endsWith(".eml"),
    );
    if (attached) {
      const bytes = await mail.downloadAttachment(attached.id);
      const parsed = parseRfc822(new TextDecoder().decode(bytes));
      if (parsed) return { ...parsed, shape: "attachment" };
    }
    const inline = parseInlineForward(message.text);
    return inline ? { ...inline, shape: "inline" } : null;
  }

  async function newForward(user: User, message: InboundMessage, forwarded: ForwardedEmail): Promise<void> {
    if (await store.caseBySource(user.email, message.id)) return; // already handled this forward

    const sender = forwarded.senderEmail;
    if (sender === user.email || isBouncerAddress(sender)) {
      await tellUser(user, message, copy.cannotDeclineEmail({
        reason: "the email you forwarded seems to be from you, or from Bouncer itself.",
        siteUrl: config.siteUrl,
      }), `bouncer:self:${message.id}`);
      return;
    }

    const verdict = await classifier.forward({
      subject: forwarded.subject,
      body: forwarded.body,
      senderEmail: sender,
      senderName: forwarded.senderName,
    });

    // Hidden instructions aimed at agents mean no automatic action.
    const suspicious = message.firewall?.verdict === "suspicious";
    const why: "firewall" | "not_cold" | "unsure" | null = suspicious
      ? "firewall"
      : verdict.kind === "cold_sales"
        ? null
        : verdict.kind;

    const c = await store.createCase({
      userEmail: user.email,
      status: user.status === "verified" ? "ask" : "preview",
      reason: why,
      senderEmail: sender,
      // Cleaned again here, whatever the classifier did: these strings reach emails.
      senderName: copy.cleanFirstName(verdict.senderFirstName) ?? copy.cleanFirstName(forwarded.senderName),
      senderCompany: copy.cleanCompany(verdict.senderCompany),
      subject: forwarded.subject || stripForwardPrefix(message.subject),
      summary: copy.cleanSummary(verdict.summary),
      sourceMessageId: message.id,
    });

    // First time: show the user what Bouncer would send. Nothing goes to the stranger.
    if (user.status !== "verified") {
      const lines = copy.previewEmail({
        userFirstName: user.firstName,
        label: copy.senderLabel(c),
        senderFirstName: c.senderName,
        frontDoor: config.frontDoor,
        siteUrl: config.siteUrl,
      });
      const caution = why ? `${cautionLine(why)}\n\n` : "";
      const sent = await tellUser(user, message, caution + lines, `bouncer:preview:${message.id}`);
      if (sent) await store.updateCase(c.id, { askThreadId: sent.threadId });
      return;
    }

    if (why || user.style === 3) {
      const sent = await tellUser(user, message, copy.askEmail({
        userFirstName: user.firstName,
        label: copy.senderLabel(c),
        why: why ?? "summary",
        summary: c.summary,
        siteUrl: config.siteUrl,
      }), `bouncer:ask:${message.id}`);
      if (sent) await store.updateCase(c.id, { askThreadId: sent.threadId });
      return;
    }

    const outcome = await decline(user, c);
    if (!outcome.ok) await explainRefusal(user, message, outcome.refusal);
  }

  function cautionLine(why: "firewall" | "not_cold" | "unsure"): string {
    if (why === "firewall") {
      return "Heads up: this email contains text aimed at AI assistants, so I'd only reply if you confirm.";
    }
    if (why === "not_cold") {
      return "Heads up: this doesn't look like a cold sales email to me. Only reply YES if you're sure.";
    }
    return "Heads up: I couldn't tell whether this is a cold sales email. Only reply YES if you're sure.";
  }

  /* ── The user's answers: YES, 1, 2, 3, NO ───────────────────────── */

  function isOpen(c: Case): boolean {
    return c.status === "preview" || c.status === "ask";
  }

  async function answer(user: User, c: Case, message: InboundMessage): Promise<void> {
    const reply = parseAnswer(message.replyText || message.text);
    if (reply.kind === "no") {
      await store.updateCase(c.id, { status: "dismissed" });
      return;
    }
    if (reply.kind === "unknown") return;

    const style: Style = reply.kind === "style" ? reply.style : user.style;

    if (c.status === "preview") {
      // This reply is the sign-up: it passed DMARC from the user's own address.
      await store.verifyUser(user.email, style);
      user = (await store.getUser(user.email))!;
      user = await provision(user);
      const outcome = await decline(user, c);
      if (!outcome.ok) return explainRefusal(user, message, outcome.refusal);
      await tellUser(user, message, copy.welcomeEmail({
        userFirstName: user.firstName,
        label: copy.senderLabel(c),
        address: user.address!,
        style,
        frontDoor: config.frontDoor,
        siteUrl: config.siteUrl,
      }), `bouncer:welcome:${c.id}`);
      return;
    }

    if (reply.kind === "style") await store.setStyle(user.email, reply.style);
    const outcome = await decline({ ...user, style }, c);
    if (!outcome.ok) return explainRefusal(user, message, outcome.refusal);
    await tellUser(user, message, copy.declinedNotice({ label: copy.senderLabel(c), siteUrl: config.siteUrl }), `bouncer:declined:${c.id}`);
  }

  /** Commands a verified user can email the front door: 1, 2, 3 or DELETE. */
  async function command(user: User, message: InboundMessage): Promise<boolean> {
    const text = `${message.replyText || message.text}`.trim();
    const subject = stripForwardPrefix(message.subject);
    if (/^delete\b/i.test(text) || /^delete\b/i.test(subject)) {
      if (user.identityId && !isTestKey(config)) await mail.deleteAddress(user.identityId);
      await store.deleteUser(user.email);
      await mail.send({
        from: config.frontDoor,
        to: user.email,
        subject: reSubject(message.subject),
        text: copy.deletedEmail({ siteUrl: config.siteUrl }),
        inReplyTo: message.id,
        idempotencyKey: `bouncer:deleted:${message.id}`,
      });
      return true;
    }
    const reply = parseAnswer(text || subject);
    if (reply.kind === "style") {
      await store.setStyle(user.email, reply.style);
      await tellUser(user, message, copy.styleChangedEmail({ style: reply.style, siteUrl: config.siteUrl }), `bouncer:style:${message.id}`);
      return true;
    }
    return false;
  }

  /* ── Declining ──────────────────────────────────────────────────── */

  function footerFor(email: string): copy.Footer {
    return {
      siteUrl: config.siteUrl,
      stopUrl: stopUrl(config.siteUrl, config.linkSecret, email),
      reportUrl: reportUrl(config.siteUrl, config.linkSecret, email),
    };
  }

  async function decline(user: User, c: Case) {
    const style: Style = user.style === 2 ? 2 : 1; // style 3 is "ask first", then the polite no
    const body = copy.declineText(style, { sender: c.senderName, user: user.firstName });
    const outcome = await sendToStranger(deps, {
      user,
      case: c,
      kind: "decline",
      subject: reSubject(c.subject ?? ""),
      text: copy.withFooter(body, user.firstName, footerFor(c.senderEmail)),
    });
    if (outcome.ok) await store.updateCase(c.id, { status: "declined", outThreadId: outcome.sent.threadId });
    return outcome;
  }

  async function explainRefusal(user: User, message: InboundMessage, refusal: Refusal): Promise<void> {
    const reasons: Partial<Record<Refusal, string>> = {
      suppressed: "this sender has asked not to receive email from Bouncer.",
      user_cap: `you've reached today's limit of ${config.dailyCapPerUser} replies. Forward it again tomorrow.`,
      global_cap: "Bouncer has reached its daily limit. Forward it again tomorrow.",
      bad_recipient: "I can't reply to that address.",
    };
    const reason = reasons[refusal];
    if (!reason) return; // already_sent and the like: nothing to tell
    await tellUser(user, message, copy.cannotDeclineEmail({ reason, siteUrl: config.siteUrl }), `bouncer:refused:${message.id}`);
  }

  /* ── Mail to a personal Bouncer address: follow-ups ─────────────── */

  async function personalAddress(message: InboundMessage): Promise<void> {
    const user = await store.getUserByAddress(message.identity);
    if (!user || user.status !== "verified") return;
    if (message.from.email === user.email) return; // the user writes to people directly, not through Bouncer

    const c = await store.caseByOutThread(message.threadId);
    const automatic = looksAutomatic(message.subject, message.headers);

    // Not a thread Bouncer started, or someone other than the original sender:
    // never reply. A person gets passed to the user; everything else, silence.
    if (!c || message.from.email !== c.senderEmail || c.status === "handed_off") {
      if (automatic) return;
      const kind = c?.status === "handed_off" ? "genuine_reply" : await classify(message);
      if (kind === "genuine_reply" || kind === "unsure") {
        await forwardToUser(deps, {
          user,
          messageId: message.id,
          text: copy.handOffNote({
            label: copy.senderLabel({ senderName: copy.cleanFirstName(message.from.name), senderCompany: null, senderEmail: message.from.email }),
            senderEmail: message.from.email,
            siteUrl: config.siteUrl,
          }),
        });
      }
      return;
    }

    if (automatic) return;

    // Hidden instructions aimed at agents: no automatic reply. The user decides.
    if (message.firewall?.verdict === "suspicious") {
      await handOff(user, c, message, copy.suspiciousFollowUpNote({ label: copy.senderLabel(c), senderEmail: c.senderEmail, siteUrl: config.siteUrl }));
      return;
    }

    const kind = await classify(message);
    if (kind === "auto_reply") return;

    if (kind === "sequence_bump") {
      if (c.status !== "declined") return; // the one please-stop already went: silence
      const outcome = await sendToStranger(deps, {
        user,
        case: c,
        kind: "stop",
        subject: reSubject(message.subject || c.subject || ""),
        text: copy.withFooter(copy.stopText({ sender: c.senderName, user: user.firstName }), user.firstName, footerFor(c.senderEmail)),
        inReplyTo: message.id,
      });
      if (outcome.ok || outcome.refusal === "already_sent") await store.updateCase(c.id, { status: "stopped" });
      return;
    }

    // A real person, or Bouncer can't tell: the user takes it from here.
    await handOff(user, c, message, copy.handOffNote({ label: copy.senderLabel(c), senderEmail: c.senderEmail, siteUrl: config.siteUrl }));
  }

  function classify(message: InboundMessage) {
    return classifier.followUp({
      subject: message.subject,
      body: message.firewall?.cleanText || message.replyText || message.text,
      headers: message.headers,
    });
  }

  async function handOff(user: User, c: Case, message: InboundMessage, note: string): Promise<void> {
    await mail.handOff(message.threadId, "Bouncer: a person replied; passed to the user");
    await store.updateCase(c.id, { status: "handed_off" });
    await forwardToUser(deps, { user, messageId: message.id, text: note });
  }

  /* ── Provisioning a personal address ────────────────────────────── */

  async function provision(user: User): Promise<User> {
    if (user.address) return user;

    if (isTestKey(config)) {
      // Test keys can't create pods or addresses: take one from the pre-made pool.
      for (const address of config.testAddressPool) {
        if (!(await store.addressTaken(address))) {
          await store.setAddress(user.email, address, address);
          return (await store.getUser(user.email))!;
        }
      }
      throw new Error("Test address pool is empty: add addresses to BOUNCER_TEST_ADDRESS_POOL.");
    }

    const id = hashEmail(user.email).slice(0, 16);
    if (!user.podId) {
      // One pod per user: their sending reputation is theirs alone.
      const pod = await mail.createPod({ name: `bouncer-${id}`, clientId: id, idempotencyKey: `bouncer:pod:${id}` });
      await store.setPod(user.email, pod.id);
      user = { ...user, podId: pod.id };
    }

    for (const local of addressCandidates(user.firstName, id)) {
      const address = `${local}@${config.personalDomain}`;
      if (await store.addressTaken(address)) continue;
      const created = await mail.createAddress({
        address,
        displayName: user.firstName ? `Bouncer for ${user.firstName}` : "Bouncer",
        podId: user.podId!,
        idempotencyKey: `bouncer:address:${id}:${local}`,
      });
      if (!created) continue; // taken in Pidgeon: try the next one
      await store.setAddress(user.email, created.id, created.email);
      return (await store.getUser(user.email))!;
    }
    throw new Error("Could not find a free Bouncer address");
  }

  /* ── Small helpers ──────────────────────────────────────────────── */

  async function tellUser(user: User, message: InboundMessage, text: string, idempotencyKey: string) {
    return sendToUser(deps, { user, subject: reSubject(message.subject), text, inReplyTo: message.id, idempotencyKey });
  }

  return { handleEvent, handleMessage, provision };
}

export type Bouncer = ReturnType<typeof createBouncer>;

/** patrick → patrick, patrick-2 … patrick-9, then patrick-<hash>. */
export function addressCandidates(firstName: string | null, id: string): string[] {
  const base =
    (firstName ?? "")
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "inbox";
  const reserved = new Set(["bouncer", "admin", "abuse", "postmaster", "support", "noreply", "inbox"]);
  const first = reserved.has(base) ? [] : [base];
  return [...first, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`), `${base}-${id.slice(0, 6)}`];
}

export function reSubject(subject: string): string {
  const clean = stripForwardPrefix(subject);
  return clean ? `Re: ${clean}` : "Re: your email";
}

export type Answer = { kind: "yes" } | { kind: "no" } | { kind: "style"; style: Style } | { kind: "unknown" };

/** Reads the first line of a reply. Generous with phrasing, strict with meaning. */
export function parseAnswer(text: string): Answer {
  const first = (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim().toLowerCase();
  const word = first.replace(/^[^\p{L}\p{N}]+/u, "");
  if (/^([123])(\s|[.)!,:]|$)/.test(word)) return { kind: "style", style: Number(word[0]) as Style };
  if (/^(yes|yep|yeah|y|ok|okay|sure|send( it)?|go( ahead)?|ja|oui|sí|si)\b/.test(word)) return { kind: "yes" };
  if (/^(no|nope|n|don'?t|do not|stop|skip|cancel|nee|nein|non)\b/.test(word)) return { kind: "no" };
  return { kind: "unknown" };
}
