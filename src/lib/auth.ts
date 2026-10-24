import { isTestKey, type Config } from "./config";
import type { InboundMessage } from "./mail/port";

/**
 * Is this email really from the address in its From line?
 *
 * Bouncer acts on a user's behalf only when it is. Pidgeon reports the
 * receiving server's SPF, DKIM and DMARC results on every inbound message.
 *
 *  - DMARC pass means SPF or DKIM passed AND aligned with the From domain.
 *    That is the rule.
 *  - A domain with no DMARC policy at all (`none` or not reported) can still
 *    get through when both SPF and DKIM pass. Not as strong as alignment, so
 *    it's the only fallback.
 *  - DMARC fail is always a no.
 *
 * Test mode: Pidgeon's test inbound mail carries no results. With a pgn_test_
 * key, BOUNCER_TRUST_TEST_AUTH=1 and a message marked test, it counts as
 * authenticated, because none of it can leave Pidgeon. All three must hold.
 */
export function isAuthenticated(
  message: Pick<InboundMessage, "authentication" | "test">,
  config: Pick<Config, "pidgeonApiKey" | "trustTestAuth">,
): boolean {
  if (message.test && config.trustTestAuth && isTestKey(config)) return true;

  const result = (value: string | null) => (value ?? "").trim().toLowerCase();
  const dmarc = result(message.authentication.dmarc);
  const spf = result(message.authentication.spf);
  const dkim = result(message.authentication.dkim);

  if (dmarc === "pass") return true;
  if (dmarc === "" || dmarc === "none") return spf === "pass" && dkim === "pass";
  return false;
}
