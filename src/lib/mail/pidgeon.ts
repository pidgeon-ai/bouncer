import {
  attachmentsDownloadUrl,
  createClient,
  createConfig,
  messagesAct,
  messagesForward,
  messagesGet,
  messagesSend,
  threadsUpdate,
} from "@pidgeon-ai/sdk";

import type { Config } from "../config";
import type { InboundMessage, MailPort } from "./port";

/** The Pidgeon SDK behind Bouncer's mail port. Each method is one API call. */
export function pidgeonMail(config: Pick<Config, "pidgeonApiKey" | "pidgeonBaseUrl">): MailPort {
  const client = createClient(
    createConfig({
      auth: () => config.pidgeonApiKey,
      ...(config.pidgeonBaseUrl ? { baseUrl: config.pidgeonBaseUrl } : {}),
    }),
  );

  return {
    async getMessage(id) {
      const { data } = await messagesGet({ client, path: { id }, throwOnError: true });
      const m = data.data;
      const message: InboundMessage = {
        id: m.id,
        threadId: m.thread_id,
        identity: (m.identity ?? "").toLowerCase(),
        from: { email: m.from.email.toLowerCase(), name: m.from.name ?? null },
        to: m.to.map((a) => ({ email: a.email.toLowerCase(), name: a.name ?? null })),
        cc: m.cc.map((a) => ({ email: a.email.toLowerCase(), name: a.name ?? null })),
        subject: m.subject ?? "",
        text: m.text ?? "",
        replyText: m.reply_text ?? "",
        headers: m.headers ?? {},
        authentication: m.authentication,
        firewall: m.firewall
          ? {
              verdict: m.firewall.verdict,
              signals: m.firewall.signals.map((s) => ({ kind: s.kind, detail: s.detail })),
              cleanText: m.firewall.clean_text,
            }
          : null,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type.toLowerCase(),
        })),
        test: m.test,
      };
      return message;
    },

    async downloadAttachment(id) {
      const { data } = await attachmentsDownloadUrl({ client, path: { id }, throwOnError: true });
      const response = await fetch(data.data.url);
      if (!response.ok) throw new Error(`Attachment download failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async send(email) {
      const { data } = await messagesSend({
        client,
        body: {
          from: email.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          ...(email.inReplyTo ? { in_reply_to: email.inReplyTo } : {}),
        },
        headers: { "Idempotency-Key": email.idempotencyKey },
        throwOnError: true,
      });
      return { id: data.data.id, threadId: data.data.thread_id };
    },

    async forward({ messageId, to, text, idempotencyKey }) {
      const { data } = await messagesForward({
        client,
        path: { id: messageId },
        body: { to: [to], text },
        headers: { "Idempotency-Key": idempotencyKey },
        throwOnError: true,
      });
      return { id: data.data.id, threadId: data.data.thread_id };
    },

    async handOff(threadId, reason) {
      await threadsUpdate({
        client,
        path: { id: threadId },
        body: { owner_type: "human", status: "human_review", reason },
        throwOnError: true,
      });
    },

    async deleteMessages(ids) {
      for (let i = 0; i < ids.length; i += 100) {
        await messagesAct({
          client,
          body: { message_ids: ids.slice(i, i + 100), action: "delete_forever" },
          throwOnError: true,
        });
      }
    },
  };
}
