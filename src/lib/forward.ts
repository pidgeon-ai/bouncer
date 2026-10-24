/**
 * Finding the original email inside a forward.
 *
 * Two shapes reach Bouncer:
 *  - forwarded as an attachment (a message/rfc822 part): the original's own
 *    headers, Message-ID included. The best case.
 *  - forwarded inline: Gmail's "---------- Forwarded message ---------",
 *    Apple Mail's "Begin forwarded message:", Outlook's "From: … Sent: …".
 *    The original sender survives; the Message-ID usually does not.
 *
 * Everything here is parsing untrusted text, so it only ever extracts: an
 * address, a display name, a subject, a Message-ID and the body for the
 * classifier. Nothing found here is ever executed or obeyed.
 */

export interface ForwardedEmail {
  senderEmail: string;
  senderName: string | null;
  subject: string;
  /** The original RFC 5322 Message-ID, when the forward kept it. */
  messageId: string | null;
  body: string;
  shape: "attachment" | "inline";
}

const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

const FORWARD_MARKERS = [
  /^-+\s*forwarded message\s*-+$/i,
  /^begin forwarded message:?$/i,
  /^-+\s*original message\s*-+$/i,
  /^_{10,}$/,
  /^-+\s*message transféré\s*-+$/i,
  /^-+\s*weitergeleitete nachricht\s*-+$/i,
  /^-+\s*mensaje reenviado\s*-+$/i,
  /^-+\s*doorgestuurd bericht\s*-+$/i,
];

/** "Mark Smith <mark@acme.com>", "mark@acme.com", "Mark [mailto:mark@acme.com]". */
export function parseMailbox(value: string): { email: string; name: string | null } | null {
  const cleaned = value.replace(/\*/g, "").trim();
  const match = cleaned.match(EMAIL);
  if (!match) return null;
  const email = match[0].toLowerCase();
  let name = cleaned
    .slice(0, match.index)
    .replace(/[<[(]\s*(mailto:)?\s*$/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  if (!name || EMAIL.test(name)) name = "";
  return { email, name: name || null };
}

export function stripForwardPrefix(subject: string): string {
  let s = subject.trim();
  // Fwd:, Fw:, TR:, WG:, RV:, Doorst:, possibly repeated and mixed with Re:.
  const prefix = /^(fwd?|fw|tr|wg|rv|doorst|re|aw|sv)\s*(\[\d+\])?\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, "");
  return s.trim();
}

/** Inline forward: find the forwarded header block in the text. */
export function parseInlineForward(text: string): Omit<ForwardedEmail, "shape"> | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/^(>\s?)+/, ""));

  let start = lines.findIndex((line) => FORWARD_MARKERS.some((marker) => marker.test(line.trim())));
  start = start === -1 ? 0 : start + 1;

  // The header block: the first "From:" with a "Subject:" within a few lines.
  for (let i = start; i < lines.length; i++) {
    if (!/^\s*\**\s*(from|von|de|van|da)\s*:\**/i.test(lines[i])) continue;

    const headers: Record<string, string> = {};
    let j = i;
    for (; j < lines.length && j < i + 12; j++) {
      const line = lines[j].trim();
      if (line === "") {
        if (Object.keys(headers).length > 0) break;
        continue;
      }
      const header = line.match(/^\**\s*([A-Za-zÀ-ÿ-]+)\s*:\**\s*(.*)$/);
      if (!header) break;
      headers[normaliseHeader(header[1])] = header[2].trim();
    }

    const from = headers.from ? parseMailbox(headers.from) : null;
    if (!from || headers.subject === undefined) continue;

    return {
      senderEmail: from.email,
      senderName: from.name,
      subject: stripForwardPrefix(headers.subject),
      messageId: headers["message-id"] ? headers["message-id"].trim() : null,
      body: lines.slice(j).join("\n").trim(),
    };
  }
  return null;
}

function normaliseHeader(name: string): string {
  const key = name.toLowerCase();
  if (["von", "de", "van", "da"].includes(key)) return "from";
  if (["betreff", "objet", "asunto", "onderwerp", "oggetto", "assunto"].includes(key)) return "subject";
  return key;
}

/* ── Forwarded as attachment: a whole RFC 5322 message ──────────────── */

/** Parses a message/rfc822 attachment. Best effort, bounded, never throws. */
export function parseRfc822(raw: string): Omit<ForwardedEmail, "shape"> | null {
  try {
    const source = raw.slice(0, 500_000).replace(/\r\n/g, "\n");
    const split = source.indexOf("\n\n");
    const head = split === -1 ? source : source.slice(0, split);
    const rest = split === -1 ? "" : source.slice(split + 2);
    const headers = parseHeaders(head);

    const from = headers.from ? parseMailbox(decodeWords(headers.from)) : null;
    if (!from) return null;

    return {
      senderEmail: from.email,
      senderName: from.name,
      subject: stripForwardPrefix(decodeWords(headers.subject ?? "")),
      messageId: headers["message-id"]?.trim() || null,
      body: textBody(headers, rest).slice(0, 20_000),
    };
  } catch {
    return null;
  }
}

function parseHeaders(head: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!(key in headers)) headers[key] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** RFC 2047 encoded words: =?utf-8?B?…?= and =?utf-8?Q?…?=. */
export function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset: string, encoding: string, data: string) => {
    try {
      const bytes =
        encoding.toLowerCase() === "b"
          ? Buffer.from(data, "base64")
          : Buffer.from(qpBytes(data.replace(/_/g, " ")));
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

function qpBytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "=" && /^[0-9a-f]{2}$/i.test(input.slice(i + 1, i + 3))) {
      out.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(...new TextEncoder().encode(input[i]));
    }
  }
  return new Uint8Array(out);
}

function decodeBody(body: string, encoding: string | undefined): string {
  const kind = (encoding ?? "").toLowerCase().trim();
  if (kind === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (kind === "quoted-printable") {
    return new TextDecoder().decode(qpBytes(body.replace(/=\n/g, "")));
  }
  return body;
}

function textBody(headers: Record<string, string>, body: string, depth = 0): string {
  const type = headers["content-type"] ?? "text/plain";
  const boundary = type.match(/boundary="?([^";]+)"?/i)?.[1];

  if (/^multipart\//i.test(type) && boundary && depth < 4) {
    const parts = body.split(`--${boundary}`).slice(1);
    let html = "";
    for (const part of parts) {
      if (part.startsWith("--")) break;
      const split = part.indexOf("\n\n");
      if (split === -1) continue;
      const partHeaders = parseHeaders(part.slice(0, split).trim());
      const partType = partHeaders["content-type"] ?? "text/plain";
      const content = part.slice(split + 2);
      if (/^multipart\//i.test(partType)) {
        const nested = textBody(partHeaders, content, depth + 1);
        if (nested) return nested;
      } else if (/^text\/plain/i.test(partType)) {
        return decodeBody(content, partHeaders["content-transfer-encoding"]).trim();
      } else if (/^text\/html/i.test(partType) && !html) {
        html = decodeBody(content, partHeaders["content-transfer-encoding"]);
      }
    }
    return htmlToText(html);
  }

  const decoded = decodeBody(body, headers["content-transfer-encoding"]);
  return /^text\/html/i.test(type) ? htmlToText(decoded) : decoded.trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
