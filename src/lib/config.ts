/**
 * Everything Bouncer reads from the environment, in one place.
 *
 * Bouncer runs for one person: its owner. Every knob that touches safety
 * (the owner, the default style, caps, the test-mode trust switch) is here so
 * a reviewer can see all of them at a glance.
 */

import type { Style } from "./store";

export interface Config {
  /** Bouncer's own address on Pidgeon. The owner forwards cold email here; declines go out from here. */
  address: string;
  /** The one person Bouncer works for. Only their (authenticated) mail is ever acted on. */
  ownerEmail: string;
  /** Their first name, as it appears in declines: "Sam asked me to reply…". */
  ownerName: string | null;
  /**
   * 1 polite no · 2 not now · 3 ask me first (the default): nothing goes to a
   * stranger until the owner replies YES.
   */
  defaultStyle: Style;
  /** Where this deployment is reachable, for the stop link in every footer. No trailing slash. */
  siteUrl: string;
  /** Pidgeon API key: a `send` key on Bouncer's address. pgn_test_… for development and CI. */
  pidgeonApiKey: string;
  pidgeonBaseUrl?: string;
  /** Secret for verifying Pidgeon webhook signatures. */
  webhookSecret: string;
  /** Secret for signing stop links. */
  linkSecret: string;
  /** Secret the cron jobs must send as a bearer token. */
  cronSecret: string;
  /** Max declines + stop requests per UTC day. Pidgeon's Free plan sends 25 a day from pidgeon.email. */
  dailyCap: number;
  /** Max model calls per UTC day. Over it, Bouncer asks the owner instead of guessing. */
  aiDailyCallCap: number;
  /** The model behind classification, through the Vercel AI Gateway. */
  aiModel: string;
  /** Delete stored message content after this many days. */
  retentionDays: number;
  /**
   * In test mode only: treat test messages as DMARC-passing. Test inbound mail
   * has no SPF/DKIM/DMARC results, so without this a test run can never get
   * past the owner check. Ignored unless the key is a pgn_test_ key AND the
   * message itself is marked test — so it can never apply to real mail.
   */
  trustTestAuth: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function style(value: string | undefined): Style {
  return value === "1" ? 1 : value === "2" ? 2 : 3;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    address: (env.BOUNCER_ADDRESS ?? "").trim().toLowerCase(),
    ownerEmail: (env.BOUNCER_OWNER_EMAIL ?? "").trim().toLowerCase(),
    ownerName: env.BOUNCER_OWNER_NAME?.trim() || null,
    defaultStyle: style(env.BOUNCER_STYLE),
    siteUrl: (env.BOUNCER_SITE_URL ?? "http://localhost:3100").replace(/\/$/, ""),
    pidgeonApiKey: env.PIDGEON_API_KEY ?? "",
    pidgeonBaseUrl: env.PIDGEON_BASE_URL || undefined,
    webhookSecret: env.PIDGEON_WEBHOOK_SECRET ?? "",
    linkSecret: env.BOUNCER_LINK_SECRET ?? "",
    cronSecret: env.CRON_SECRET ?? "",
    dailyCap: int(env.BOUNCER_DAILY_CAP, 25),
    aiDailyCallCap: int(env.BOUNCER_AI_DAILY_CALL_CAP, 500),
    aiModel: env.BOUNCER_AI_MODEL ?? "anthropic/claude-haiku-5.5",
    retentionDays: int(env.BOUNCER_RETENTION_DAYS, 30),
    trustTestAuth: env.BOUNCER_TRUST_TEST_AUTH === "1",
  };
}

/** The settings Bouncer cannot run without. Checked when the app starts. */
export function missingConfig(config: Config): string[] {
  const missing: string[] = [];
  if (!config.address) missing.push("BOUNCER_ADDRESS");
  if (!config.ownerEmail) missing.push("BOUNCER_OWNER_EMAIL");
  if (!config.pidgeonApiKey) missing.push("PIDGEON_API_KEY");
  if (!config.webhookSecret) missing.push("PIDGEON_WEBHOOK_SECRET");
  if (!config.linkSecret) missing.push("BOUNCER_LINK_SECRET");
  return missing;
}

export function isTestKey(config: Pick<Config, "pidgeonApiKey">): boolean {
  return config.pidgeonApiKey.startsWith("pgn_test_");
}
