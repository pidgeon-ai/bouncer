import { verifyWebhook } from "@pidgeon-ai/sdk";

import { getApp } from "@/lib/app";

/**
 * Every inbound email, to the front door and to every personal Bouncer
 * address, arrives here as a signed Pidgeon webhook.
 */
export async function POST(request: Request) {
  const { config, bouncer } = await getApp();

  // Verify first, on the exact bytes. An unverified payload is just a stranger's POST.
  const rawBody = await request.text();
  let event;
  try {
    event = await verifyWebhook({ rawBody, headers: request.headers, secret: config.webhookSecret });
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  // A thrown error answers 500, so Pidgeon retries; de-duplication makes the retry safe.
  await bouncer.handleEvent(event);
  return new Response(null, { status: 204 });
}
