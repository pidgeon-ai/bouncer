/**
 * The whole Bouncer journey, printed. No keys, no network: the Pidgeon side
 * is the test double from tests/harness.ts and the database is in-process.
 *
 *   npm run demo
 */

import { sendWeeklyTally } from "../src/lib/jobs";
import { OWNER, SALES, gmailForward, harness } from "../tests/harness";

async function main() {
  const h = await harness();
  let shown = 0;
  const show = (step: string) => {
    console.log(`\n━━ ${step} ${"━".repeat(Math.max(0, 70 - step.length))}`);
    for (const email of h.pidgeon.outbox.slice(shown)) {
      console.log(`\nFrom: ${email.from}\nTo:   ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
    }
    for (const f of h.pidgeon.forwards) console.log(`\n[forwards message ${f.messageId} to ${f.to}]\n${f.text}`);
    h.pidgeon.forwards.length = 0;
    shown = h.pidgeon.outbox.length;
  };

  await h.receive({ from: OWNER, subject: "Fwd: Quick question about your pipeline", text: gmailForward() });
  show("1. Patrick forwards a cold email. Bouncer asks him first");

  await h.receive({ from: OWNER, subject: "Re: Quick question about your pipeline", text: "YES", inReplyTo: h.to(OWNER).at(-1)!.id });
  show("2. Patrick replies YES. The decline goes out");
  const decline = h.to(SALES)[0];

  await h.receive({ from: SALES, subject: "Re: Quick question", text: "Just following up on my last note!", inReplyTo: decline.id });
  show("3. The sequence bumps. One please-stop");

  await h.receive({ from: SALES, subject: "Re: Quick question", text: "Bumping this again", inReplyTo: decline.id });
  show("4. Another bump. Silence");

  await h.receive({ from: OWNER, subject: "1", text: "1" });
  await h.receive({ from: OWNER, subject: "Fwd: Hello", text: gmailForward({ from: "jane@growthco.io", fromName: "Jane Doe", subject: "Hello" }) });
  const janeDecline = h.to("jane@growthco.io")[0];
  show("5. Patrick switches to style 1: the next forward is declined straight away");

  await h.receive({ from: "jane@growthco.io", subject: "Re: Hello", text: "[question] Sorry, I think we met at Web Summit. Is Patrick the right person for partnerships?", inReplyTo: janeDecline.id });
  show("6. Jane answers like a person. Handed to Patrick, not answered");

  await sendWeeklyTally(h.deps);
  show("7. Monday: the weekly summary");
}

main();
