/**
 * Bouncer, start to finish. One function per thing that can arrive at its
 * address.
 *
 *   the owner forwards a cold email ──► ask first (style 3, the default):
 *                                        "here's what I'd send", wait for YES
 *                                     └► style 1 or 2: decline straight away
 *                                        (still asks when it isn't cold sales,
 *                                        or the Firewall flagged it)
 *   the owner replies                ──► YES / NO / 1 / 2 / 3
 *   the salesperson replies          ──► sequence bump: one please-stop, then silence
 *                                        a real person: hand the thread to the owner
 *   anyone else                      ──► never answered
 *
 * Every email out goes through guard.ts. Every email in is untrusted.
 */

import { isAuthenticated } from "./auth";
import { looksAutomatic, type Classifier } from "./classify";
import { parseInlineForward, parseRfc822, stripForwardPrefix, type ForwardedEmail } from "./forward";
import { forwardToOwner, sendToOwner, sendToStranger, type GuardDeps, type Outcome, type Refusal } from "./guard";
import { stopUrl } from "./links";
import type { InboundMessage } from "./mail/port";
import type { Case, Style } from "./store";
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
  const ownerName = copy.cleanFirstName(config.ownerName);

  /* ── Entry point: one verified webhook event ────────────────────── */

  async function handleEvent(event: WebhookEvent): Promise<void> {
    if (event.type !== "message.received") return;
    if (event.data.from_self === true) return; // our own mail, arriving back
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
    if (message.identity !== config.address) return; // not Bouncer's address
    if (message.from.email === config.address) return; // never talk to ourselves
    // Auto-forwarded or BCC'd mail keeps the ORIGINAL From — the salesperson —
    // and isn't something anyone deliberately sent Bouncer. Ignore it.
    const addressed = [...message.to, ...message.cc].some((a) => a.email === config.address);
    if (!addressed) return;

    if (message.from.email === config.ownerEmail) return fromOwner(message);
    return fromSomeoneElse(message);
  }

  /* ── Mail from the owner: forwards and answers ──────────────────── */

  async function fromOwner(message: InboundMessage): Promise<void> {
    if (looksAutomatic(message.subject, message.headers)) return;
    // Anyone can type the owner's address into a From line. Only mail that
    // provably came from it is acted on.
    if (!isAuthenticated(message, config)) {
      console.warn("owner mail failed SPF/DKIM/DMARC; ignored", message.id);
      return;
    }

    const asked = await store.caseByAskThread(message.threadId);
    if (asked?.status === "ask") return answer(asked, message);

    const forwarded = await findForward(message);
    if (forwarded) return newForward(message, forwarded);

    const reply = parseAnswer(message.replyText || message.text || message.subject);
    if (reply.kind === "style") {
      await store.setStyle(reply.style);
      await tellOwner(message, copy.styleChangedEmail(reply.style), `bouncer:style:${message.id}`);
      return;
    }
    await tellOwner(message, copy.couldNotParseEmail(), `bouncer:noparse:${message.id}`);
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

  async function newForward(message: InboundMessage, forwarded: ForwardedEmail): Promise<void> {
    const sender = forwarded.senderEmail;
    if (sender === config.ownerEmail || sender === config.address) {
      await tellOwner(
        message,
        copy.cannotDeclineEmail("the email you forwarded seems to be from you, or from Bouncer itself."),
        `bouncer:self:${message.id}`,
      );
      return;
    }

    const verdict = await classifier.forward({
      subject: forwarded.subject,
      body: forwarded.body,
      senderEmail: sender,
      senderName: forwarded.senderName,
    });

    const c = await store.createCase({
      status: "ask",
      senderEmail: sender,
      // Cleaned again here, whatever the classifier did: these strings reach emails.
      senderName: copy.cleanFirstName(verdict.senderFirstName) ?? copy.cleanFirstName(forwarded.senderName),
      senderCompany: copy.cleanCompany(verdict.senderCompany),
      subject: forwarded.subject || stripForwardPrefix(message.subject),
      summary: copy.cleanSummary(verdict.summary),
      sourceMessageId: message.id,
    });
    if (!c) return; // this forward was already handled

    // Hidden instructions aimed at agents, or not cold sales: never automatic.
    const why =
      message.firewall?.verdict === "suspicious" ? "firewall" : verdict.kind === "cold_sales" ? null : verdict.kind;
    const style = await store.style(config.defaultStyle);

    if (why || style === 3) {
      await store.updateCase(c.id, { reason: why ?? "ask_first" });
      const sent = await tellOwner(
        message,
        copy.askEmail({
          ownerFirstName: ownerName,
          label: copy.senderLabel(c),
          why: why ?? "ask_first",
          summary: c.summary,
          draft: copy.declineText(style === 2 ? 2 : 1, { sender: c.senderName, owner: ownerName }),
        }),
        `bouncer:ask:${message.id}`,
      );
      if (sent) await store.updateCase(c.id, { askThreadId: sent.threadId });
      return;
    }

    const outcome = await decline(c, style);
    if (!outcome.ok) await explainRefusal(message, outcome.refusal);
  }

  async function answer(c: Case, message: InboundMessage): Promise<void> {
    const reply = parseAnswer(message.replyText || message.text);
    if (reply.kind === "unknown") return;
    if (reply.kind === "no") {
      await store.updateCase(c.id, { status: "dismissed" });
      return;
    }
    if (reply.kind === "style") {
      await store.setStyle(reply.style);
      if (reply.style === 3) {
        // "3" keeps asking first; it doesn't approve this one.
        await tellOwner(message, copy.styleChangedEmail(3), `bouncer:style:${message.id}`);
        return;
      }
    }

    const style = reply.kind === "style" ? reply.style : await store.style(config.defaultStyle);
    const outcome = await decline(c, style);
    if (!outcome.ok) return explainRefusal(message, outcome.refusal);
    await tellOwner(message, copy.declinedNotice({ label: copy.senderLabel(c) }), `bouncer:declined:${c.id}`);
  }

  /* ── Declining ──────────────────────────────────────────────────── */

  async function decline(c: Case, style: Style): Promise<Outcome> {
    const body = copy.declineText(style === 2 ? 2 : 1, { sender: c.senderName, owner: ownerName });
    const outcome = await sendToStranger(deps, {
      case: c,
      kind: "decline",
      subject: reSubject(c.subject ?? ""),
      text: copy.withFooter(body, ownerName, stopUrl(config.siteUrl, config.linkSecret, c.senderEmail)),
    });
    if (outcome.ok) await store.updateCase(c.id, { status: "declined", outThreadId: outcome.sent.threadId });
    return outcome;
  }

  async function explainRefusal(message: InboundMessage, refusal: Refusal): Promise<void> {
    const reasons: Partial<Record<Refusal, string>> = {
      suppressed: "this sender has asked not to receive email from Bouncer.",
      daily_cap: `Bouncer has reached today's limit of ${config.dailyCap} replies. Forward it again tomorrow.`,
      bad_recipient: "I can't reply to that address.",
    };
    const reason = reasons[refusal];
    if (!reason) return; // already_sent: nothing to tell
    await tellOwner(message, copy.cannotDeclineEmail(reason), `bouncer:refused:${message.id}`);
  }

  /* ── Mail from anyone else: follow-ups ──────────────────────────── */

  async function fromSomeoneElse(message: InboundMessage): Promise<void> {
    const automatic = looksAutomatic(message.subject, message.headers);
    const c = await store.caseByOutThread(message.threadId);

    // Not a thread Bouncer started, someone other than the original sender, or
    // already handed over: never reply. A person goes to the owner; anything else, silence.
    if (!c || message.from.email !== c.senderEmail || c.status === "handed_off") {
      if (automatic) return;
      const kind = c?.status === "handed_off" ? "genuine_reply" : await classify(message);
      if (kind === "genuine_reply") {
        const label = copy.senderLabel({
          senderName: copy.cleanFirstName(message.from.name),
          senderCompany: null,
          senderEmail: message.from.email,
        });
        await forwardToOwner(deps, {
          messageId: message.id,
          text: copy.handOffNote({ label, senderEmail: message.from.email }),
        });
      }
      return;
    }

    if (automatic) return;

    // Hidden instructions aimed at agents: no automatic reply. The owner decides.
    if (message.firewall?.verdict === "suspicious") {
      await handOff(c, message, copy.suspiciousFollowUpNote({ label: copy.senderLabel(c), senderEmail: c.senderEmail }));
      return;
    }

    const kind = await classify(message);
    if (kind === "auto_reply") return;

    if (kind === "sequence_bump") {
      if (c.status !== "declined") return; // the one please-stop already went: silence
      const outcome = await sendToStranger(deps, {
        case: c,
        kind: "stop",
        subject: reSubject(message.subject || c.subject || ""),
        text: copy.withFooter(
          copy.stopText({ sender: c.senderName, owner: ownerName }),
          ownerName,
          stopUrl(config.siteUrl, config.linkSecret, c.senderEmail),
        ),
        inReplyTo: message.id,
      });
      if (outcome.ok || outcome.refusal === "already_sent") await store.updateCase(c.id, { status: "stopped" });
      return;
    }

    // A real person, or Bouncer can't tell: the owner takes it from here.
    await handOff(c, message, copy.handOffNote({ label: copy.senderLabel(c), senderEmail: c.senderEmail }));
  }

  function classify(message: InboundMessage) {
    return classifier.followUp({
      subject: message.subject,
      body: message.firewall?.cleanText || message.replyText || message.text,
      headers: message.headers,
    });
  }

  async function handOff(c: Case, message: InboundMessage, note: string): Promise<void> {
    await mail.handOff(message.threadId, "Bouncer: a person replied; passed to the owner");
    await store.updateCase(c.id, { status: "handed_off" });
    await forwardToOwner(deps, { messageId: message.id, text: note });
  }

  function tellOwner(message: InboundMessage, text: string, idempotencyKey: string) {
    return sendToOwner(deps, { subject: reSubject(message.subject), text, inReplyTo: message.id, idempotencyKey });
  }

  return { handleEvent, handleMessage };
}

export type Bouncer = ReturnType<typeof createBouncer>;

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
