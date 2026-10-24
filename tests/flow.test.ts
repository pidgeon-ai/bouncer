/**
 * The whole journey, end to end against the Pidgeon fake:
 * forward → preview → YES → personal address → decline → follow-ups →
 * hand-off → weekly tally → deletion after 30 days.
 */

import { describe, expect, it } from "vitest";

import { deleteOldMail, sendWeeklyTally } from "@/lib/jobs";

import { SALES, USER, gmailForward, harness } from "./harness";

const FRONT = "bouncer@pidgeon.ai";

async function onboarded() {
  const h = await harness();
  const forward = await h.receive({
    to: FRONT,
    from: USER,
    fromName: "Patrick Neuhaus",
    subject: "Fwd: Quick question about your pipeline",
    text: gmailForward(),
  });
  const [preview] = h.to(USER);
  const yes = await h.receive({ to: FRONT, from: USER, subject: "Re: Quick question about your pipeline", text: "YES", inReplyTo: preview.id });
  return { h, forward, preview, yes };
}

describe("first forward: the sign-up", () => {
  it("sends a preview to the user, and nothing to the salesperson", async () => {
    const h = await harness();
    await h.receive({ to: FRONT, from: USER, fromName: "Patrick Neuhaus", subject: "Fwd: Quick question", text: gmailForward() });

    expect(h.to(SALES)).toHaveLength(0);
    const [preview] = h.to(USER);
    expect(preview.from).toBe(FRONT);
    expect(preview.subject).toBe("Re: Quick question");
    expect(preview.text).toContain("Here's what I'd send to Mark (Acme):");
    expect(preview.text).toContain("> Patrick asked me to reply: this isn't a priority for them right now");
    expect(preview.text).toContain("Reply YES to send it");
    expect(preview.text).toContain("2 · not now, try next quarter");
    expect(preview.text).toContain("Nothing has been sent to Mark (Acme) yet");
    expect((await h.store.getUser(USER))?.status).toBe("pending");
  });

  it("YES verifies the user, provisions a personal address in its own pod, and sends the decline from it", async () => {
    const { h } = await onboarded();

    const user = await h.store.getUser(USER);
    expect(user?.status).toBe("verified");
    expect(user?.address).toBe("patrick@bouncer.pidgeon.email");
    expect(h.pidgeon.pods).toHaveLength(1);
    expect(h.pidgeon.addresses.get("patrick@bouncer.pidgeon.email")?.podId).toBe(h.pidgeon.pods[0].id);

    const [decline] = h.to(SALES);
    expect(decline.from).toBe("patrick@bouncer.pidgeon.email");
    expect(decline.subject).toBe("Re: Quick question about your pipeline");
    expect(decline.text).toMatch(/^Hi Mark,\n\nPatrick asked me to reply: this isn't a priority for them right now, so please take them off this sequence\. Thanks for understanding\./);
    expect(decline.text).toContain("Bouncer, Patrick's AI email assistant");
    expect(decline.text).toContain("I'm an AI, not a person");
    expect(decline.text).toContain("Get your own, free: https://bouncer.pidgeon.ai");
    expect(decline.text).toMatch(/Never hear from Bouncer again: https:\/\/bouncer\.pidgeon\.ai\/stop\?e=/);
    expect(decline.text).toMatch(/Report abuse: https:\/\/bouncer\.pidgeon\.ai\/report\?e=/);

    const welcome = h.to(USER).at(-1)!;
    expect(welcome.text).toContain("I've declined Mark (Acme) from your Bouncer address, patrick@bouncer.pidgeon.email");
  });

  it("a style number instead of YES sets the style and sends in it", async () => {
    const h = await harness();
    await h.receive({ to: FRONT, from: USER, fromName: "Patrick", subject: "Fwd: Hello", text: gmailForward() });
    const [preview] = h.to(USER);
    await h.receive({ to: FRONT, from: USER, subject: "Re: Hello", text: "2", inReplyTo: preview.id });

    expect((await h.store.getUser(USER))?.style).toBe(2);
    expect(h.to(SALES)[0].text).toContain("you're welcome to check back next quarter");
  });

  it("NO sends nothing and leaves the user unverified", async () => {
    const h = await harness();
    await h.receive({ to: FRONT, from: USER, subject: "Fwd: Hello", text: gmailForward() });
    const [preview] = h.to(USER);
    await h.receive({ to: FRONT, from: USER, subject: "Re: Hello", text: "no thanks", inReplyTo: preview.id });

    expect(h.to(SALES)).toHaveLength(0);
    expect((await h.store.getUser(USER))?.status).toBe("pending");
  });
});

describe("after sign-up", () => {
  it("every forward is declined straight away, from the personal address", async () => {
    const { h } = await onboarded();
    await h.receive({
      to: FRONT,
      from: USER,
      subject: "Fwd: Partnership",
      text: gmailForward({ fromName: "Jane Doe", from: "jane@growthco.io", subject: "Partnership" }),
    });

    const [decline] = h.to("jane@growthco.io");
    expect(decline.from).toBe("patrick@bouncer.pidgeon.email");
    expect(decline.text).toMatch(/^Hi Jane,/);
  });

  it("style 3 sends the user a one-line summary first and declines only on YES", async () => {
    const { h } = await onboarded();
    await h.receive({ to: FRONT, from: USER, subject: "3", text: "3" });
    await h.receive({ to: FRONT, from: USER, subject: "Fwd: Hi", text: gmailForward({ from: "sam@vendor.com", fromName: "Sam" }) });

    expect(h.to("sam@vendor.com")).toHaveLength(0);
    const ask = h.to(USER).at(-1)!;
    expect(ask.text).toContain("In short: Wants a 15-minute call about their platform");

    await h.receive({ to: FRONT, from: USER, subject: "Re: Hi", text: "yes", inReplyTo: ask.id });
    expect(h.to("sam@vendor.com")).toHaveLength(1);
  });

  it("DELETE removes the account", async () => {
    const { h } = await onboarded();
    await h.receive({ to: FRONT, from: USER, subject: "DELETE", text: "DELETE" });
    expect(await h.store.getUser(USER)).toBeNull();
    expect(h.pidgeon.deletedAddresses).toHaveLength(1);
    expect(h.to(USER).at(-1)!.text).toContain("I've deleted your Bouncer account");
  });
});

describe("follow-ups", () => {
  it("a sequence bump gets one please-stop, then silence", async () => {
    const { h } = await onboarded();
    const [decline] = h.to(SALES);

    const bump = await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question about your pipeline", text: "Just following up on this!", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(2);
    const stop = h.to(SALES)[1];
    expect(stop.text).toContain("please remove Patrick from this sequence");
    expect(stop.inReplyTo).toBe(bump.message.id);

    await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "Bumping this to the top of your inbox", inReplyTo: decline.id });
    await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "Last try!", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(2);
  });

  it("a genuine reply is handed to the user, not answered", async () => {
    const { h } = await onboarded();
    const [decline] = h.to(SALES);

    const reply = await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "[question] Sorry! Actually we met at the conference, is Patrick the right person?", inReplyTo: decline.id });

    expect(h.to(SALES)).toHaveLength(1);
    expect(h.pidgeon.handOffs).toEqual([{ threadId: reply.message.threadId, reason: expect.any(String) }]);
    expect(h.pidgeon.forwards).toHaveLength(1);
    expect(h.pidgeon.forwards[0].to).toBe(USER);
    expect(h.pidgeon.forwards[0].text).toContain("write to mark@acme.com directly");

    // Once handed off, Bouncer never answers that thread again.
    await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "just following up", inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(1);
  });

  it("an out-of-office is ignored", async () => {
    const { h } = await onboarded();
    const [decline] = h.to(SALES);
    await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Automatic reply: Quick question", text: "I'm away", headers: { "auto-submitted": "auto-replied" }, inReplyTo: decline.id });
    expect(h.to(SALES)).toHaveLength(1);
    expect(h.pidgeon.forwards).toHaveLength(0);
  });
});

describe("weekly tally and retention", () => {
  it("emails each user their count with a LinkedIn share link, once a week", async () => {
    const { h } = await onboarded();
    await h.receive({ to: FRONT, from: USER, subject: "Fwd: x", text: gmailForward({ from: "a@one.com", fromName: "Ann" }) });

    expect(await sendWeeklyTally(h.deps)).toEqual({ sent: 1 });
    const tally = h.to(USER).at(-1)!;
    expect(tally.subject).toBe("Bouncer handled 2 cold emails this week");
    expect(tally.text).toContain("(~6 minutes saved)");
    expect(tally.text).toContain("https://www.linkedin.com/feed/?shareActive=true&text=My%20agent%20declined%202%20salespeople%20this%20week.%20Free%3A%20bouncer.pidgeon.ai%2Fs%2F2");

    // The cron firing twice in one week sends nothing new.
    const before = h.pidgeon.outbox.length;
    await sendWeeklyTally(h.deps);
    expect(h.pidgeon.outbox.length).toBe(before);
  });

  it("deletes message content after 30 days, in Pidgeon and in the database", async () => {
    const { h } = await onboarded();
    h.setNow(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));
    const { deleted } = await deleteOldMail(h.deps);
    expect(deleted).toBeGreaterThan(0);
    expect(await h.store.messagesOlderThan(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))).toEqual([]);
    expect(await h.store.declinesSince(USER, new Date(0))).toBe(0);
  });
});
