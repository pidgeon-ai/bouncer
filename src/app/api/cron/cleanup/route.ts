import { getApp } from "@/lib/app";
import { isCronRequest } from "@/lib/cron";
import { deleteOldMail } from "@/lib/jobs";

export async function GET(request: Request) {
  const app = await getApp();
  if (!isCronRequest(request, app.config.cronSecret)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await deleteOldMail(app));
}
