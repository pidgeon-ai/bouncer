/**
 * The whole journey against the REAL Pidgeon API, in test mode: nothing
 * leaves Pidgeon. Pidgeon's POST /test/inbound plays both the user and the
 * salesperson, and each delivery is handed straight to Bouncer, so no public
 * webhook URL is needed.
 *
 *   PIDGEON_API_KEY=pgn_test_… \
 *   BOUNCER_FRONT_DOOR=bouncer-test@yourapp.pidgeon.email \
 *   BOUNCER_PERSONAL_DOMAIN=yourapp.pidgeon.email \
 *   BOUNCER_TEST_ADDRESS_POOL=bouncer-pool-1@yourapp.pidgeon.email \
 *   BOUNCER_TRUST_TEST_AUTH=1 \
 *   pnpm smoke
 *
 * The test key must reach the front door and every pool address (README → Test mode).
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

const USER = "smoke-user@example.com";
const SALES = "smoke-sales@example.net";

async function main() {
  const config = { ...loadConfig(), linkSecret: "smoke", webhookSecret: "smoke", cronSecret: "smoke" };
  if (!isTestKey(config)) throw new Error("Refusing to run: PIDGEON_API_KEY must be a pgn_test_ key.");
  if (!config.trustTestAuth) throw new Error("Set BOUNCER_TRUST_TEST_AUTH=1 (test inbound mail carries no DMARC results).");
  if (config.testAddressPool.length === 0) throw new Error("Set BOUNCER_TEST_ADDRESS_POOL.");

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
  const now = () => new Date();
  const classifier = defaultClassifier({ store, model: config.aiModel, dailyCap: config.aiDailyCallCap });
  const deps = { mail, store, config, classifier, now };
  const bouncer = createBouncer(deps);

  let step = 0;
  async function arrive(input: { to: string; from: string; from_name?: string; subject: string; text: string; in_reply_to?: string }) {
    const { data } = await testInbound({ client, body: input, headers: { "Idempotency-Key": `smoke:${Date.now()}:${step}` }, throwOnError: true });
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
    `To: ${USER}`,
    "",
    "Hi, I noticed you're hiring. Worth a quick call to show you our platform? Mark",
  ].join("\n");

  await arrive({ to: config.frontDoor, from: USER, from_name: "Sam Smoke", subject: "Fwd: Quick question about your pipeline", text: forward });
  check("preview went to the user, nothing to the salesperson", to(USER).length === 1 && to(SALES).length === 0);

  await arrive({ to: config.frontDoor, from: USER, subject: "Re: Quick question about your pipeline", text: "YES", in_reply_to: to(USER)[0].id });
  const user = await store.getUser(USER);
  check(`user verified with personal address ${user?.address}`, user?.status === "verified" && Boolean(user.address));
  check("decline sent from the personal address", to(SALES).length === 1 && to(SALES)[0].from === user?.address);

  await arrive({ to: user!.address!, from: SALES, subject: "Re: Quick question about your pipeline", text: "Just following up on this!", in_reply_to: to(SALES)[0].id });
  check("sequence bump got one please-stop", to(SALES).length === 2);

  await arrive({ to: user!.address!, from: SALES, subject: "Re: Quick question about your pipeline", text: "Bumping this again", in_reply_to: to(SALES)[0].id });
  check("second bump: silence", to(SALES).length === 2);

  const tally = await sendWeeklyTally(deps);
  check("weekly tally sent", tally.sent === 1);

  console.log(`\nSent ${sent.length} test emails; none left Pidgeon. Message ids:`);
  for (const m of sent) console.log(`  ${m.id}  ${m.from} → ${m.to}  ${m.subject}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
