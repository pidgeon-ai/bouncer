/**
 * The whole journey, end to end against the Pidgeon fake:
 * forward → ask the owner → YES → decline → follow-ups → hand-off →
 * weekly summary → deletion after 30 days.
 */

import { describe, expect, it } from "vitest";

import { deleteOldMail, sendWeeklyTally } from "@/lib/jobs";

import { BOUNCER, OWNER, SALES, gmailForward, harness } from "./harness";

type H = Awaited<ReturnType<typeof harness>>;

/** The owner forwards a cold email, then answers Bouncer's question. */
async function forwardAndAnswer(h: H, answer: string, forward = gmailForward()) {
  await h.receive({ from: OWNER, subject: "Fwd: Quick question about your pipeline", text: forward });
  const ask = h.to(OWNER).at(-1)!;
  await h.receive({ from: OWNER, subject: "Re: Quick question about your pipeline", text: answer, inReplyTo: ask.id });
  return ask;
}

describe("ask first: the default", () => {
  it("shows the owner the decline it would send, and sends nothing to the salesperson", async () => {
    const h = await harness();
    await h.receive({ from: OWNER, subject: "Fwd: Quick question about your pipeline", text: gmailForward() });

    expect(h.to(SALES)).toHaveLength(0);
    const [ask] = h.to(OWNER);
    expect(ask.from).toBe(BOUNCER);
    expect(ask.subject).toBe("Re: Quick question about your pipeline");
    expect(ask.text).toContain("Nothing has been sent yet.");
    expect(ask.text).toContain("From: Mark (Acme)");
    expect(ask.text).toContain("In short: Wants a 15-minute call about their platform");
    expect(ask.text).toContain("> Patrick asked me to reply: this isn't a priority for them right now");
    expect(ask.text).toContain("Reply YES to send it");
  });

  it("YES sends the decline from Bouncer's address, with the AI disclosure and a stop link", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "YES");

    const [decline] = h.to(SALES);
    expect(decline.from).toBe(BOUNCER);
    expect(decline.subject).toBe("Re: Quick question about your pipeline");
    expect(decline.text).toMatch(
      /^Hi Mark,\n\nPatrick asked me to reply: this isn't a priority for them right now, so please take them off this sequence\. Thanks for understanding\./,
    );
    expect(decline.text).toContain("Bouncer, Patrick's AI email assistant");
    expect(decline.text).toContain("I'm an AI, not a person");
    expect(decline.text).toContain("I'm open source: https://github.com/pidgeon-ai/bouncer");
    expect(decline.text).toMatch(/Never hear from me again: http:\/\/localhost:3100\/stop\?e=/);
    expect(decline.text).toContain("Report abuse: abuse@pidgeon.ai");
    expect(h.to(OWNER).at(-1)!.text).toContain("Declined: Mark (Acme)");
  });

  it("NO sends nothing", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "no thanks");
    expect(h.to(SALES)).toHaveLength(0);
  });

  it("2 sends this one in style 2 and switches to it", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "2");
    expect(h.to(SALES)[0].text).toContain("you're welcome to check back next quarter");
    expect(await h.store.style(3)).toBe(2);
  });

  it("3 keeps asking and doesn't approve this one", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "3");
    expect(h.to(SALES)).toHaveLength(0);
  });
});

describe("styles 1 and 2: straight away", () => {
  it("emailing Bouncer 1 switches it to decline without asking", async () => {
    const h = await harness();
    await h.receive({ from: OWNER, subject: "1", text: "1" });
    expect(h.to(OWNER).at(-1)!.text).toContain('your style is now "polite no"');

    await h.receive({ from: OWNER, subject: "Fwd: Partnership", text: gmailForward({ fromName: "Jane Doe", from: "jane@growthco.io" }) });
    const [decline] = h.to("jane@growthco.io");
    expect(decline.from).toBe(BOUNCER);
    expect(decline.text).toMatch(/^Hi Jane,/);
  });

  it("can be the default from the environment", async () => {
    const h = await harness({ config: { defaultStyle: 1 } });
    await h.receive({ from: OWNER, subject: "Fwd: x", text: gmailForward() });
    expect(h.to(SALES)).toHaveLength(1);
  });
});

describe("follow-ups", () => {
  it("a sequence bump gets one please-stop, then silence", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "yes");
    const [decline] = h.to(SALES);

    const bump = await h.receive({ from: SALES, subject: "Re: Quick question about your pipeline", text: "Just following up on this!", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(2);
    const stop = h.to(SALES)[1];
    expect(stop.text).toContain("please remove Patrick from this sequence");
    expect(stop.inReplyTo).toBe(bump.message.id);

    await h.receive({ from: SALES, subject: "Re: Quick question", text: "Bumping this to the top of your inbox", inReplyTo: decline.id });
    await h.receive({ from: SALES, subject: "Re: Quick question", text: "Last try!", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(2);
  });

  it("a genuine reply is handed to the owner, not answered", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "yes");
    const [decline] = h.to(SALES);

    const reply = await h.receive({ from: SALES, subject: "Re: Quick question", text: "[question] Sorry! We met at the conference. Is Patrick the right person?", inReplyTo: decline.id });

    expect(h.to(SALES)).toHaveLength(1);
    expect(h.pidgeon.handOffs).toEqual([{ threadId: reply.message.threadId, reason: expect.any(String) }]);
    expect(h.pidgeon.forwards).toHaveLength(1);
    expect(h.pidgeon.forwards[0].to).toBe(OWNER);
    expect(h.pidgeon.forwards[0].text).toContain("write to mark@acme.com directly");

    // Once handed off, Bouncer never answers that thread again.
    await h.receive({ from: SALES, subject: "Re: Quick question", text: "just following up", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(1);
  });

  it("an out-of-office is ignored", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "yes");
    const [decline] = h.to(SALES);
    await h.receive({ from: SALES, subject: "Automatic reply: Quick question", text: "I'm away", headers: { "auto-submitted": "auto-replied" }, inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(1);
    expect(h.pidgeon.forwards).toHaveLength(0);
  });
});

describe("weekly summary and retention", () => {
  it("emails the owner a count with a LinkedIn share link, once a week", async () => {
    const h = await harness({ config: { defaultStyle: 1 } });
    await h.receive({ from: OWNER, subject: "Fwd: x", text: gmailForward() });
    await h.receive({ from: OWNER, subject: "Fwd: y", text: gmailForward({ from: "a@one.com", fromName: "Ann" }) });

    expect(await sendWeeklyTally(h.deps)).toEqual({ sent: true });
    const tally = h.to(OWNER).at(-1)!;
    expect(tally.subject).toBe("Bouncer handled 2 cold emails this week");
    expect(tally.text).toContain("(~6 minutes saved)");
    expect(decodeURIComponent(tally.text)).toContain(
      "My email agent declined 2 salespeople this week. It's open source: https://github.com/pidgeon-ai/bouncer",
    );

    // The cron firing twice in one week sends nothing new.
    const before = h.pidgeon.outbox.length;
    await sendWeeklyTally(h.deps);
    expect(h.pidgeon.outbox.length).toBe(before);
  });

  it("deletes message content after 30 days, in Pidgeon and in the database", async () => {
    const h = await harness();
    await forwardAndAnswer(h, "yes");
    h.setNow(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));
    const { deleted } = await deleteOldMail(h.deps);
    expect(deleted).toBeGreaterThan(0);
    expect(await h.store.messagesOlderThan(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))).toEqual([]);
    expect(await h.store.declinesSince(new Date(0))).toBe(0);
  });
});
