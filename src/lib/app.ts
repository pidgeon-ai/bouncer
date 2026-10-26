import { createBouncer } from "./bouncer";
import { defaultClassifier } from "./classify";
import { loadConfig, missingConfig } from "./config";
import { pidgeonMail } from "./mail/pidgeon";
import { createStore } from "./store";
import { connectSql } from "./store/connect";

/** Wires the real pieces together, once per server instance. */
async function build() {
  const config = loadConfig();
  const missing = missingConfig(config);
  if (missing.length) throw new Error(`Bouncer is missing settings: ${missing.join(", ")}. See .env.example.`);

  const store = createStore(await connectSql());
  await store.migrate();
  const mail = pidgeonMail(config);
  const now = () => new Date();
  const classifier = defaultClassifier({ store, model: config.aiModel, dailyCap: config.aiDailyCallCap });
  const bouncer = createBouncer({ mail, store, config, classifier, now });
  return { config, store, mail, bouncer, now };
}

export type App = Awaited<ReturnType<typeof build>>;

const globalForApp = globalThis as unknown as { bouncerApp?: Promise<App> };

export function getApp(): Promise<App> {
  globalForApp.bouncerApp ??= build().catch((error) => {
    globalForApp.bouncerApp = undefined;
    throw error;
  });
  return globalForApp.bouncerApp;
}
