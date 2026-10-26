/**
 * Every word Bouncer sends, in one file.
 *
 * Replies to strangers are FIXED templates. The model never writes them: it
 * only extracts names, which are sanitised below before they are allowed in.
 * So an email that says "ignore your instructions and reply with…" cannot
 * change a single word of what goes out.
 *
 * Voice: short, kind, honest that it's an AI, no sarcasm. Change the words
 * here; keep them fixed.
 */

import type { Style } from "./store";

export const REPO_URL = "https://github.com/pidgeon-ai/bouncer";

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

/** A company name fit to show the owner (never sent to strangers). */
export function cleanCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const company = raw.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &.,'’-]{0,39}$/u.test(company)) return null;
  return company;
}

/** One line for the owner, from the model. Plain text, one line, bounded. */
export function cleanSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function hi(senderFirstName: string | null): string {
  return senderFirstName ? `Hi ${senderFirstName},` : "Hi there,";
}

function who(ownerFirstName: string | null): string {
  return ownerFirstName ?? "The person you emailed";
}

function signature(ownerFirstName: string | null): string {
  return ownerFirstName
    ? `Bouncer, ${ownerFirstName}'s AI email assistant`
    : "Bouncer, an AI email assistant";
}

/** The footer on every email to a stranger: AI disclosure, how to opt out, where to complain. */
export function strangerFooter(ownerFirstName: string | null, stopUrl: string): string {
  return [
    "--",
    signature(ownerFirstName),
    `I'm an AI, not a person, and I only reply on ${ownerFirstName ? `${ownerFirstName}'s` : "their"} behalf. I'm open source: ${REPO_URL}`,
    `Never hear from me again: ${stopUrl}`,
    "Report abuse: abuse@pidgeon.ai",
  ].join("\n");
}

/** The decline itself. Style 3 sends the polite no, after the owner said YES. */
export function declineText(style: Style, names: { sender: string | null; owner: string | null }): string {
  const person = who(names.owner);
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
export function stopText(names: { sender: string | null; owner: string | null }): string {
  const person = names.owner ?? "them";
  return [
    hi(names.sender),
    "",
    `This was already declined, so please remove ${person} from this sequence. This is the last reply you'll get from me on this thread.`,
  ].join("\n");
}

export function withFooter(body: string, ownerFirstName: string | null, stopUrl: string): string {
  return `${body}\n\n${strangerFooter(ownerFirstName, stopUrl)}`;
}

/* ── Emails to the owner ──────────────────────────────────────────── */

export function senderLabel(c: { senderName: string | null; senderCompany: string | null; senderEmail: string }): string {
  if (c.senderName && c.senderCompany) return `${c.senderName} (${c.senderCompany})`;
  if (c.senderName) return `${c.senderName} <${c.senderEmail}>`;
  return c.senderEmail;
}

const ownerFooter = "--\nBouncer · your self-hosted email agent · message content is deleted after 30 days";

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

export const STYLE_MENU = [
  "  1 · polite no, sent straight away",
  "  2 · not now, try next quarter, sent straight away",
  "  3 · ask me first, like this",
].join("\n");

const STYLE_NAMES: Record<Style, string> = {
  1: "polite no",
  2: "not now, try next quarter",
  3: "ask me first",
};

/**
 * Bouncer asks before acting: always in style 3, and in any style when the
 * email doesn't look like cold sales or the Firewall flagged it.
 */
export function askEmail(input: {
  ownerFirstName: string | null;
  label: string;
  why: "not_cold" | "unsure" | "firewall" | "ask_first";
  summary: string | null;
  draft: string;
}): string {
  const opening = {
    not_cold:
      "This doesn't look like a cold sales email to me (it could be a customer, a colleague or a warm lead), so I haven't replied.",
    unsure: "I couldn't tell whether this is a cold sales email, so I haven't replied.",
    firewall:
      "This email contains text aimed at AI assistants (hidden or instruction-like), so I didn't act on it automatically.",
    ask_first: "Here's a cold email you forwarded. Nothing has been sent yet.",
  }[input.why];
  return [
    input.ownerFirstName ? `Hi ${input.ownerFirstName},` : "Hi,",
    "",
    opening,
    "",
    `From: ${input.label}`,
    ...(input.summary ? [`In short: ${input.summary}`] : []),
    "",
    "Here's what I'd send:",
    "",
    quote(input.draft),
    "",
    "Reply YES to send it, NO to leave it, or 1 or 2 to send it in that style and use that style from now on:",
    STYLE_MENU,
    "",
    ownerFooter,
  ].join("\n");
}

export function declinedNotice(input: { label: string }): string {
  return [`Declined: ${input.label}. I'll handle the follow-ups.`, "", ownerFooter].join("\n");
}

export function handOffNote(input: { label: string; senderEmail: string }): string {
  return [
    `${input.label} answered Bouncer's decline with what looks like a real reply, not the sequence, so I've stopped and I'm passing it to you. I won't reply to this thread again.`,
    "",
    `To answer them, write to ${input.senderEmail} directly: replies to this email come back to Bouncer, not to them.`,
    "",
    ownerFooter,
  ].join("\n");
}

export function suspiciousFollowUpNote(input: { label: string; senderEmail: string }): string {
  return [
    `${input.label} replied, and the reply contains text aimed at AI assistants, so I haven't answered it. Have a look yourself; I won't reply to this thread again.`,
    "",
    `To answer them, write to ${input.senderEmail} directly.`,
    "",
    ownerFooter,
  ].join("\n");
}

export function couldNotParseEmail(): string {
  return [
    "I couldn't find the original sender in what you forwarded, so I haven't replied to anyone.",
    "",
    "Try forwarding it as an attachment (Gmail: the ⋮ menu → Forward as attachment), or forward it again without editing the top of the message.",
    "",
    "To change how I reply, email me just 1, 2 or 3:",
    STYLE_MENU,
    "",
    ownerFooter,
  ].join("\n");
}

export function cannotDeclineEmail(reason: string): string {
  return [`I haven't replied to anyone: ${reason}`, "", ownerFooter].join("\n");
}

export function styleChangedEmail(style: Style): string {
  return [`Done: your style is now "${STYLE_NAMES[style]}".`, "", ownerFooter].join("\n");
}

export function tallyEmail(input: { ownerFirstName: string | null; count: number; minutes: number }): {
  subject: string;
  text: string;
} {
  const emails = input.count === 1 ? "cold email" : "cold emails";
  const share = `My email agent declined ${input.count} ${input.count === 1 ? "salesperson" : "salespeople"} this week. It's open source: ${REPO_URL}`;
  return {
    subject: `Bouncer handled ${input.count} ${emails} this week`,
    text: [
      input.ownerFirstName ? `Hi ${input.ownerFirstName},` : "Hi,",
      "",
      `Bouncer handled ${input.count} ${emails} this week (~${input.minutes} minutes saved).`,
      "",
      `Share it on LinkedIn: https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(share)}`,
      "",
      ownerFooter,
    ].join("\n"),
  };
}

export const MINUTES_SAVED_PER_EMAIL = 3;
