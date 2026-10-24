import { parseCount, shareImage, shareImageSize } from "@/components/share-image";

export const alt = "My agent declined salespeople this week. Bouncer, free at bouncer.pidgeon.ai";
export const size = shareImageSize;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  return shareImage(parseCount((await params).n));
}
