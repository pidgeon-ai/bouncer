/**
 * The whole Bouncer journey, printed. No keys, no network: the Pidgeon side
 * is the test double from tests/harness.ts and the database is in-process.
 *
 *   pnpm demo
 */

import { sendWeeklyTally } from "../src/lib/jobs";
import { SALES, USER, gmailForward, harness } from "../tests/harness";

const FRONT = "bouncer@pidgeon.ai";

async function main() {
  const h = await harness();
  let shown = 0;
  const show = (step: string) => {
    console.log(`\n━━ ${step} ${"━".repeat(Math.max(0, 70 - step.length))}`);
    for (const email of h.pidgeon.outbox.slice(shown)) {
      console.log(`\nFrom: ${email.from}\nTo:   ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
    }
    for (const f of h.pidgeon.forwards) console.log(`\n[forwarded message ${f.messageId} to ${f.to}]\n${f.text}`);
    h.pidgeon.forwards.length = 0;
    shown = h.pidgeon.outbox.length;
  };

  await h.receive({ to: FRONT, from: USER, fromName: "Patrick Neuhaus", subject: "Fwd: Quick question about your pipeline", text: gmailForward() });
  show("1. Patrick forwards a cold email. Bouncer previews to him only");

  await h.receive({ to: FRONT, from: USER, subject: "Re: Quick question about your pipeline", text: "YES", inReplyTo: h.to(USER).at(-1)!.id });
  show("2. Patrick replies YES (DMARC pass). Address provisioned, decline sent");
  const decline = h.to(SALES)[0];

  await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "Just following up on my last note!", inReplyTo: decline.id });
  show("3. Mark's sequence bumps. One please-stop");

  await h.receive({ to: "patrick@bouncer.pidgeon.email", from: SALES, subject: "Re: Quick question", text: "Bumping this again", inReplyTo: decline.id });
  show("4. Another bump. Silence");

  await h.receive({ to: FRONT, from: USER, subject: "Fwd: Hello", text: gmailForward({ from: "jane@growthco.io", fromName: "Jane Doe" }) });
  const janeDecline = h.to("jane@growthco.io")[0];
  show("5. Next forward: declined straight away");

  await h.receive({ to: "patrick@bouncer.pidgeon.email", from: "jane@growthco.io", subject: "Re: Hello", text: "[question] Sorry, I think we met at Web Summit. Is Patrick the right person for partnerships?", inReplyTo: janeDecline.id });
  show("6. Jane answers like a person. Handed to Patrick, not answered");

  await sendWeeklyTally(h.deps);
  show("7. Monday: the weekly tally");
}

main();
