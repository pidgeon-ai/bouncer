/**
 * Every word Bouncer sends, in one file.
 *
 * Replies to strangers are FIXED templates. The model never writes them: it
 * only extracts names, which are sanitised below before they are allowed in.
 * So an email that says "ignore your instructions and reply with…" cannot
 * change a single word of what goes out.
 *
 * Patrick approves the final wording before launch. Voice: short, kind,
 * honest that it's an AI, no sarcasm.
 */

import type { Style } from "./store";

export interface Footer {
  siteUrl: string;
  stopUrl: string;
  reportUrl: string;
}

const NOT_NAMES = new Set([
  "sales", "team", "info", "hello", "hi", "support", "noreply", "no-reply", "admin", "contact",
  "marketing", "growth", "the", "your", "mr", "mrs", "ms", "dr", "ai", "bot", "assistant",
]);

/**
 * A first name fit to put in an email, or null. Letters, apostrophes and
 * hyphens only, at most 30 characters, one word. Anything else — an
 * instruction, a URL, an emoji, a second sentence — is dropped.
 */
export function cleanFirstName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const words = raw.trim().replace(/^["']+|["']+$/g, "").split(/\s+/).filter(Boolean);
  // The whole value must look like a name (at most three name-shaped words),
  // not just start with one: "Ignore previous instructions…" is not "Ignore".
  if (words.length === 0 || words.length > 3) return null;
  if (!words.every((word) => /^[\p{L}][\p{L}'’.-]{0,29}$/u.test(word))) return null;
  const first = words[0].replace(/\.$/, "");
  if (!/^[\p{L}][\p{L}'’-]{0,29}$/u.test(first)) return null;
  if (NOT_NAMES.has(first.toLowerCase())) return null;
  return first === first.toLowerCase() ? first[0].toUpperCase() + first.slice(1) : first;
}

/** A company name fit to show the user (never sent to strangers). */
export function cleanCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const company = raw.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &.,'’-]{0,39}$/u.test(company)) return null;
  return company;
}

/** One line for the user, from the model. Plain text, one line, bounded. */
export function cleanSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function hi(senderFirstName: string | null): string {
  return senderFirstName ? `Hi ${senderFirstName},` : "Hi there,";
}

function who(userFirstName: string | null): string {
  return userFirstName ?? "The person you emailed";
}

function signature(userFirstName: string | null): string {
  return userFirstName
    ? `Bouncer, ${userFirstName}'s AI email assistant`
    : "Bouncer, an AI email assistant";
}

/** The footer on every email to a third party: AI disclosure, opt-out, abuse report. */
export function strangerFooter(userFirstName: string | null, footer: Footer): string {
  const site = footer.siteUrl.replace(/^https?:\/\//, "");
  return [
    "--",
    `${signature(userFirstName)} · ${site}`,
    `I'm an AI, not a person, and I only reply on ${userFirstName ? `${userFirstName}'s` : "their"} behalf. Get your own, free: ${footer.siteUrl}`,
    `Never hear from Bouncer again: ${footer.stopUrl}`,
    `Report abuse: ${footer.reportUrl}`,
  ].join("\n");
}

/** The decline itself. Style 3 sends the polite no, after the user said yes. */
export function declineText(
  style: Style,
  names: { sender: string | null; user: string | null },
): string {
  const person = who(names.user);
  if (style === 2) {
    return [
      hi(names.sender),
      "",
      `${person} asked me to reply: the timing isn't right for them at the moment. If it's still relevant, you're welcome to check back next quarter. Until then, please take them off this sequence. Thanks for understanding.`,
    ].join("\n");
  }
  return [
    hi(names.sender),
    "",
    `${person} asked me to reply: this isn't a priority for them right now, so please take them off this sequence. Thanks for understanding.`,
  ].join("\n");
}

/** The one and only follow-up a sequence gets. */
export function stopText(names: { sender: string | null; user: string | null }): string {
  const person = names.user ?? "them";
  return [
    hi(names.sender),
    "",
    `This was already declined, so please remove ${person} from this sequence. This is the last reply you'll get from me on this thread.`,
  ].join("\n");
}

export function withFooter(body: string, userFirstName: string | null, footer: Footer): string {
  return `${body}\n\n${strangerFooter(userFirstName, footer)}`;
}

/* ── Emails to the user (from the front door) ─────────────────────── */

export function senderLabel(c: { senderName: string | null; senderCompany: string | null; senderEmail: string }): string {
  if (c.senderName && c.senderCompany) return `${c.senderName} (${c.senderCompany})`;
  if (c.senderName) return `${c.senderName} <${c.senderEmail}>`;
  return c.senderEmail;
}

const userFooter = (siteUrl: string) =>
  `--\nBouncer · ${siteUrl.replace(/^https?:\/\//, "")} · I keep message content for 30 days and never train on your mail.`;

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

export const STYLE_MENU = [
  "  1 · polite no",
  "  2 · not now, try next quarter",
  "  3 · ask me first: send me a one-line summary, and decline only when I say YES",
].join("\n");

export function previewEmail(input: {
  userFirstName: string | null;
  label: string;
  senderFirstName: string | null;
  frontDoor: string;
  siteUrl: string;
}): string {
  const decline = declineText(1, { sender: input.senderFirstName, user: input.userFirstName });
  return [
    input.userFirstName ? `Hi ${input.userFirstName},` : "Hi,",
    "",
    `I'm Bouncer, an AI assistant that answers cold sales email for you. Here's what I'd send to ${input.label}:`,
    "",
    quote(decline),
    "",
    "Reply YES to send it, or reply with a style:",
    STYLE_MENU,
    "",
    `Your reply also confirms this address is yours. Nothing has been sent to ${input.label} yet, and nothing will be unless you reply.`,
    "",
    `After that, forward any cold email to ${input.frontDoor} and I'll answer it from your own Bouncer address. Every reply says it's from an AI assistant.`,
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function welcomeEmail(input: {
  userFirstName: string | null;
  label: string;
  address: string;
  style: Style;
  frontDoor: string;
  siteUrl: string;
}): string {
  const styles: Record<Style, string> = {
    1: "polite no",
    2: "not now, try next quarter",
    3: "ask me first",
  };
  return [
    input.userFirstName ? `You're set, ${input.userFirstName}.` : "You're set.",
    "",
    `I've declined ${input.label} from your Bouncer address, ${input.address}. If they answer with a real question, I'll pass it to you. If it's just the sequence again, I'll ask them once to stop, then go quiet.`,
    "",
    `From now on, forward any cold email to ${input.frontDoor}. Your style: ${styles[input.style]}. To change it, email me 1, 2 or 3:`,
    STYLE_MENU,
    "",
    "Email me DELETE to remove your account and everything I've stored.",
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function declinedNotice(input: { label: string; siteUrl: string }): string {
  return [`Declined: ${input.label}. I'll handle the follow-ups.`, "", userFooter(input.siteUrl)].join("\n");
}

export function askEmail(input: {
  userFirstName: string | null;
  label: string;
  why: "not_cold" | "unsure" | "firewall" | "summary";
  summary: string | null;
  siteUrl: string;
}): string {
  const opening = {
    not_cold:
      "This doesn't look like a cold sales email to me (it could be a customer, a colleague or a warm lead), so I haven't replied.",
    unsure: "I couldn't tell whether this is a cold sales email, so I haven't replied.",
    firewall:
      "This email contains text aimed at AI assistants (hidden or instruction-like), so I didn't act on it automatically.",
    summary: "Here's the one-line summary you asked for.",
  }[input.why];
  return [
    input.userFirstName ? `Hi ${input.userFirstName},` : "Hi,",
    "",
    opening,
    "",
    `From: ${input.label}`,
    ...(input.summary ? [`In short: ${input.summary}`] : []),
    "",
    input.why === "summary"
      ? "Reply YES and I'll decline it politely. Otherwise I'll leave it alone."
      : "Reply YES if you'd like me to decline it anyway. Otherwise I'll leave it alone.",
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function handOffNote(input: { label: string; senderEmail: string; siteUrl: string }): string {
  return [
    `${input.label} answered Bouncer's decline with what looks like a real reply, not the sequence, so I've stopped and I'm passing it to you. I won't reply to this thread again.`,
    "",
    `To answer them, write to ${input.senderEmail} directly: replies to this email come back to Bouncer, not to them.`,
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function suspiciousFollowUpNote(input: { label: string; senderEmail: string; siteUrl: string }): string {
  return [
    `${input.label} replied, and the reply contains text aimed at AI assistants, so I haven't answered it. Have a look yourself; I won't reply to this thread again.`,
    "",
    `To answer them, write to ${input.senderEmail} directly.`,
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function couldNotParseEmail(input: { siteUrl: string }): string {
  return [
    "I couldn't find the original sender in what you forwarded, so I haven't replied to anyone.",
    "",
    "Try forwarding it as an attachment (Gmail: the ⋮ menu → Forward as attachment), or forward it again without editing the top of the message.",
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function cannotDeclineEmail(input: { reason: string; siteUrl: string }): string {
  return [`I haven't replied to anyone: ${input.reason}`, "", userFooter(input.siteUrl)].join("\n");
}

export function styleChangedEmail(input: { style: Style; siteUrl: string }): string {
  const names: Record<Style, string> = { 1: "polite no", 2: "not now, try next quarter", 3: "ask me first" };
  return [`Done: your style is now "${names[input.style]}".`, "", userFooter(input.siteUrl)].join("\n");
}

export function deletedEmail(input: { siteUrl: string }): string {
  return [
    "Done. I've deleted your Bouncer account, your Bouncer address and everything I stored about you. Forward me an email any time to start again.",
    "",
    userFooter(input.siteUrl),
  ].join("\n");
}

export function tallyEmail(input: {
  userFirstName: string | null;
  count: number;
  minutes: number;
  shareUrl: string;
  siteUrl: string;
}): { subject: string; text: string } {
  const emails = input.count === 1 ? "cold email" : "cold emails";
  return {
    subject: `Bouncer handled ${input.count} ${emails} this week`,
    text: [
      input.userFirstName ? `Hi ${input.userFirstName},` : "Hi,",
      "",
      `Bouncer handled ${input.count} ${emails} this week (~${input.minutes} minutes saved).`,
      "",
      `Share it on LinkedIn: ${input.shareUrl}`,
      "",
      userFooter(input.siteUrl),
    ].join("\n"),
  };
}

export const MINUTES_SAVED_PER_EMAIL = 3;
