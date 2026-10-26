/**
 * The whole journey against the REAL Pidgeon API in test mode: nothing leaves
 * Pidgeon. `POST /test/inbound` plays both the owner and the salesperson, and
 * each delivery is handed straight to Bouncer, so no webhook is needed.
 *
 * Needs a pgn_test_ key on BOUNCER_ADDRESS (README → Test mode), then:
 *
 *   npm run smoke
 */

import { createClient, createConfig, testInbound } from "@pidgeon-ai/sdk";

import { createBouncer } from "../src/lib/bouncer";
import { defaultClassifier } from "../src/lib/classify";
import { isTestKey, loadConfig } from "../src/lib/config";
import { sendWeeklyTally } from "../src/lib/jobs";
import { pidgeonMail } from "../src/lib/mail/pidgeon";
import type { MailPort, OutboundEmail, SentEmail } from "../src/lib/mail/port";
import { createStore } from "../src/lib/store";
import { pglite } from "../src/lib/store/connect";

const SALES = "smoke-sales@example.net";

async function main() {
  const config = {
    ...loadConfig(),
    ownerEmail: process.env.BOUNCER_OWNER_EMAIL || "smoke-owner@example.com",
    defaultStyle: 3 as const,
    trustTestAuth: true,
    linkSecret: "smoke",
    webhookSecret: "smoke",
    cronSecret: "smoke",
  };
  if (!isTestKey(config)) throw new Error("Refusing to run: PIDGEON_API_KEY must be a pgn_test_ key.");
  if (!config.address) throw new Error("Set BOUNCER_ADDRESS to the address the test key reaches.");

  const client = createClient(
    createConfig({ auth: () => config.pidgeonApiKey, ...(config.pidgeonBaseUrl ? { baseUrl: config.pidgeonBaseUrl } : {}) }),
  );

  // The real Pidgeon port, with every send recorded so the script can answer it.
  const sent: (OutboundEmail & SentEmail)[] = [];
  const real = pidgeonMail(config);
  const mail: MailPort = {
    ...real,
    async send(email) {
      const result = await real.send(email);
      sent.push({ ...email, ...result });
      return result;
    },
  };

  const store = createStore(await pglite());
  await store.migrate();
  const classifier = defaultClassifier({ store, model: config.aiModel, dailyCap: config.aiDailyCallCap });
  const deps = { mail, store, config, classifier, now: () => new Date() };
  const bouncer = createBouncer(deps);

  let step = 0;
  async function arrive(input: { from: string; subject: string; text: string; in_reply_to?: string }) {
    const { data } = await testInbound({
      client,
      body: { to: config.address, ...input },
      headers: { "Idempotency-Key": `smoke:${Date.now()}:${step}` },
      throwOnError: true,
    });
    if (data.data.status !== "delivered" || !data.data.message_id) throw new Error(`test inbound: ${data.data.status}`);
    await bouncer.handleEvent({
      id: `smoke-${Date.now()}-${step++}`,
      type: "message.received",
      data: { message_id: data.data.message_id, from_self: false },
    });
  }
  function check(label: string, ok: boolean) {
    console.log(`${ok ? "✓" : "✗"} ${label}`);
    if (!ok) process.exitCode = 1;
  }
  const to = (address: string) => sent.filter((m) => m.to === address);

  const forward = [
    "---------- Forwarded message ---------",
    `From: Mark Smith <${SALES}>`,
    "Subject: Quick question about your pipeline",
    `To: ${config.ownerEmail}`,
    "",
    "Hi, I noticed you're hiring. Worth a quick call to show you our platform? Mark",
  ].join("\n");

  await arrive({ from: config.ownerEmail, subject: "Fwd: Quick question about your pipeline", text: forward });
  check("Bouncer asked the owner first; nothing to the salesperson", to(config.ownerEmail).length === 1 && to(SALES).length === 0);

  await arrive({ from: config.ownerEmail, subject: "Re: Quick question about your pipeline", text: "YES", in_reply_to: to(config.ownerEmail)[0].id });
  check("YES sent the decline from Bouncer's address", to(SALES).length === 1 && to(SALES)[0].from === config.address);

  await arrive({ from: SALES, subject: "Re: Quick question about your pipeline", text: "Just following up on this!", in_reply_to: to(SALES)[0].id });
  check("a sequence bump got one please-stop", to(SALES).length === 2);

  await arrive({ from: SALES, subject: "Re: Quick question about your pipeline", text: "Bumping this again", in_reply_to: to(SALES)[0].id });
  check("a second bump: silence", to(SALES).length === 2);

  check("weekly summary sent", (await sendWeeklyTally(deps)).sent);

  console.log(`\nSent ${sent.length} test emails; none left Pidgeon.`);
  for (const m of sent) console.log(`  ${m.id}  ${m.from} → ${m.to}  ${m.subject}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
