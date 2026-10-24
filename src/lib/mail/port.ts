/**
 * What Bouncer needs from an email API, and nothing more.
 *
 * `pidgeon.ts` implements this with the Pidgeon SDK; the tests implement it
 * with an in-memory fake that records every send. Keeping the seam this
 * narrow is what makes the safety rules testable: every email Bouncer can
 * ever send goes through `send`.
 */

export interface Mailbox {
  email: string;
  name: string | null;
}

export interface FirewallResult {
  verdict: "clean" | "suspicious";
  signals: { kind: string; detail: string }[];
  /** The new text with hidden content removed: what a model should read. */
  cleanText: string;
}

export interface InboundMessage {
  id: string;
  threadId: string;
  /** The address it arrived at. */
  identity: string;
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  subject: string;
  /** The full text part, quoted history included. Forwards live here. */
  text: string;
  /** Only what the sender wrote this time. */
  replyText: string;
  /** Lowercased headers Pidgeon keeps: message-id, auto-submitted, list-id, … */
  headers: Record<string, string>;
  authentication: { spf: string | null; dkim: string | null; dmarc: string | null };
  firewall: FirewallResult | null;
  attachments: { id: string; filename: string; contentType: string }[];
  /** Written in Pidgeon test mode: it never left Pidgeon. */
  test: boolean;
}

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** A Pidgeon message id; threads the send under it. */
  inReplyTo?: string;
  /** Every send carries one. A retry with the same key sends nothing new. */
  idempotencyKey: string;
}

export interface SentEmail {
  id: string;
  threadId: string;
}

export interface MailPort {
  getMessage(id: string): Promise<InboundMessage>;
  /** The raw bytes of an attachment, e.g. a forwarded .eml. */
  downloadAttachment(id: string): Promise<Uint8Array>;
  send(email: OutboundEmail): Promise<SentEmail>;
  /** Forward a message as-is to someone, with a note on top. */
  forward(input: { messageId: string; to: string; text: string; idempotencyKey: string }): Promise<SentEmail>;
  /** Hand a thread to a person: the agent stops owning it. */
  handOff(threadId: string, reason: string): Promise<void>;
  createPod(input: { name: string; clientId: string; idempotencyKey: string }): Promise<{ id: string }>;
  /** Returns null when the address is already taken. */
  createAddress(input: {
    address: string;
    displayName: string;
    podId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; email: string } | null>;
  deleteAddress(id: string): Promise<void>;
  deleteMessages(ids: string[]): Promise<void>;
}
