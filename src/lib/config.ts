/**
 * Everything Bouncer reads from the environment, in one place.
 *
 * Read once per process. Every knob that touches safety (caps, the test-mode
 * trust switch) is here so a reviewer can see all of them at a glance.
 */

export interface Config {
  /** The public site, used in footers and share links. No trailing slash. */
  siteUrl: string;
  /** The address people forward cold email to, e.g. bouncer@pidgeon.ai. */
  frontDoor: string;
  /** The domain personal Bouncer addresses live on, e.g. bouncer.pidgeon.email. */
  personalDomain: string;
  /** Pidgeon API key. pgn_test_… in development and CI: mail never leaves Pidgeon. */
  pidgeonApiKey: string;
  pidgeonBaseUrl?: string;
  /** Secret for verifying Pidgeon webhook signatures. */
  webhookSecret: string;
  /** Secret for signing stop/report links. */
  linkSecret: string;
  /** Secret Vercel Cron sends as a bearer token. */
  cronSecret: string;
  /** Max declines + stop requests one user's Bouncer may send per UTC day. */
  dailyCapPerUser: number;
  /** Max third-party sends across all users per UTC day. */
  dailyCapGlobal: number;
  /** Max model calls per UTC day. Over it, Bouncer asks the person instead of guessing. */
  aiDailyCallCap: number;
  /** The model behind classification, through the Vercel AI Gateway. */
  aiModel: string;
  /** Delete stored message content after this many days. */
  retentionDays: number;
  /**
   * In test mode only: treat test messages as DMARC-passing. Test inbound mail
   * has no SPF/DKIM/DMARC results, so without this a local run can never get
   * past verification. Ignored unless the key is a pgn_test_ key AND the
   * message itself is marked test — so it can never apply to real mail.
   */
  trustTestAuth: boolean;
  /**
   * Test keys cannot create pods or addresses. In test mode, personal
   * addresses come from this pre-made pool instead (comma-separated).
   */
  testAddressPool: string[];
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    siteUrl: (env.BOUNCER_SITE_URL ?? "https://bouncer.pidgeon.ai").replace(/\/$/, ""),
    frontDoor: (env.BOUNCER_FRONT_DOOR ?? "bouncer@pidgeon.ai").toLowerCase(),
    personalDomain: (env.BOUNCER_PERSONAL_DOMAIN ?? "bouncer.pidgeon.email").toLowerCase(),
    pidgeonApiKey: env.PIDGEON_API_KEY ?? "",
    pidgeonBaseUrl: env.PIDGEON_BASE_URL || undefined,
    webhookSecret: env.PIDGEON_WEBHOOK_SECRET ?? "",
    linkSecret: env.BOUNCER_LINK_SECRET ?? "",
    cronSecret: env.CRON_SECRET ?? "",
    dailyCapPerUser: int(env.BOUNCER_DAILY_CAP_PER_USER, 25),
    dailyCapGlobal: int(env.BOUNCER_DAILY_CAP_GLOBAL, 2000),
    aiDailyCallCap: int(env.BOUNCER_AI_DAILY_CALL_CAP, 5000),
    aiModel: env.BOUNCER_AI_MODEL ?? "anthropic/claude-haiku-5.5",
    retentionDays: int(env.BOUNCER_RETENTION_DAYS, 30),
    trustTestAuth: env.BOUNCER_TRUST_TEST_AUTH === "1",
    testAddressPool: (env.BOUNCER_TEST_ADDRESS_POOL ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function isTestKey(config: Pick<Config, "pidgeonApiKey">): boolean {
  return config.pidgeonApiKey.startsWith("pgn_test_");
}
