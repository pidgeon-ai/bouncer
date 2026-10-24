import { shareImage, shareImageSize } from "@/components/share-image";

export const alt = "Bouncer: forward the cold email, Bouncer says no for you.";
export const size = shareImageSize;
export const contentType = "image/png";

export default async function Image() {
  return shareImage();
}
