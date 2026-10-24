import { describe, expect, it } from "vitest";

import { decodeWords, parseInlineForward, parseMailbox, parseRfc822, stripForwardPrefix } from "@/lib/forward";

import { SALES, USER, harness } from "./harness";

describe("inline forwards", () => {
  it("Gmail", () => {
    const parsed = parseInlineForward(
      "FYI\n\n---------- Forwarded message ---------\nFrom: Mark Smith <mark@acme.com>\nDate: Thu, 23 Oct 2026 at 10:02\nSubject: Re: Quick question\nTo: Patrick <patrick@example.com>\n\nHi Patrick,\nWorth a call?",
    );
    expect(parsed).toMatchObject({ senderEmail: "mark@acme.com", senderName: "Mark Smith", subject: "Quick question" });
    expect(parsed?.body).toBe("Hi Patrick,\nWorth a call?");
  });

  it("Apple Mail", () => {
    const parsed = parseInlineForward(
      "Begin forwarded message:\n\nFrom: \"Jane Doe\" <jane@growthco.io>\nSubject: Partnership\nDate: 23 October 2026 at 10:00:00 CEST\nTo: patrick@example.com\n\nHello!",
    );
    expect(parsed).toMatchObject({ senderEmail: "jane@growthco.io", senderName: "Jane Doe", subject: "Partnership" });
  });

  it("Outlook, with the old [mailto:] form and bold headers", () => {
    const parsed = parseInlineForward(
      "________________________________\n*From:* Sam Lee [mailto:sam@vendor.com]\n*Sent:* Thursday, October 23, 2026 10:00 AM\n*To:* Patrick\n*Subject:* RE: Intro\n\nBody",
    );
    expect(parsed).toMatchObject({ senderEmail: "sam@vendor.com", senderName: "Sam Lee", subject: "Intro" });
  });

  it("German Gmail, quoted with >", () => {
    const parsed = parseInlineForward(
      "> ---------- Weitergeleitete Nachricht ---------\n> Von: Max Muster <max@firma.de>\n> Betreff: Kurze Frage\n>\n> Hallo",
    );
    expect(parsed).toMatchObject({ senderEmail: "max@firma.de", subject: "Kurze Frage" });
  });

  it("a plain email with no forwarded header block is not a forward", () => {
    expect(parseInlineForward("Hi Bouncer, how does this work?")).toBeNull();
  });
});

describe("forwarded as attachment", () => {
  const eml = [
    "From: =?UTF-8?Q?Ren=C3=A9e_Dupont?= <renee@vendor.fr>",
    "To: patrick@example.com",
    "Subject: =?UTF-8?B?UXVpY2sgcXVlc3Rpb24=?=",
    "Message-ID: <abc123@mail.vendor.fr>",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Bonjour, une d=C3=A9mo ?",
    "--b1",
    "Content-Type: text/html",
    "",
    "<p>ignored</p>",
    "--b1--",
  ].join("\r\n");

  it("reads the original headers, Message-ID and text body", () => {
    expect(parseRfc822(eml)).toEqual({
      senderEmail: "renee@vendor.fr",
      senderName: "Renée Dupont",
      subject: "Quick question",
      messageId: "<abc123@mail.vendor.fr>",
      body: "Bonjour, une démo ?",
    });
  });

  it("is preferred over the inline text", async () => {
    const h = await harness();
    await h.receive({
      to: "bouncer@pidgeon.ai",
      from: USER,
      subject: "Fwd: Quick question",
      text: "see attached",
      attachment: { filename: "Quick question.eml", contentType: "message/rfc822", content: eml },
    });
    expect(h.to(USER).at(-1)!.text).toContain("Here's what I'd send to Renée <renee@vendor.fr>");
    expect(h.to(SALES)).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("parses mailboxes", () => {
    expect(parseMailbox("Mark <MARK@Acme.com>")).toEqual({ email: "mark@acme.com", name: "Mark" });
    expect(parseMailbox("mark@acme.com")).toEqual({ email: "mark@acme.com", name: null });
    expect(parseMailbox("nobody")).toBeNull();
  });

  it("strips forward and reply prefixes", () => {
    expect(stripForwardPrefix("Fwd: Re: FW: Quick question")).toBe("Quick question");
    expect(stripForwardPrefix("TR: Intro")).toBe("Intro");
  });

  it("decodes encoded words", () => {
    expect(decodeWords("=?utf-8?B?SMOpbGxv?= world")).toBe("Héllo world");
  });
});
