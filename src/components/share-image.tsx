import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const shareImageSize = { width: 1200, height: 630 };

const PAPER = "#f8f6f2";
const INK = "#1d2127";
const MUTED = "#5e6670";
const RULE = "#d6d8dc";

/** One corner registration tick, as the Pidgeon brand draws them. */
function Tick({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const top = corner[0] === "t";
  const left = corner[1] === "l";
  return (
    <div
      style={{
        position: "absolute",
        width: 28,
        height: 28,
        [top ? "top" : "bottom"]: 40,
        [left ? "left" : "right"]: 40,
        borderColor: RULE,
        borderStyle: "solid",
        borderWidth: `${top ? 2 : 0}px ${left ? 0 : 2}px ${top ? 0 : 2}px ${left ? 2 : 0}px`,
      }}
    />
  );
}

/** The card LinkedIn shows under a share: the Pidgeon lockup, paper, ink, one number. */
export async function shareImage(count?: number) {
  const [font, logo] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/archivo-expanded-600.ttf")),
    readFile(join(process.cwd(), "public/brand/logo-light.svg"), "utf8"),
  ]);
  const headline =
    count === undefined
      ? "Forward the cold email. Bouncer says no for you."
      : `My agent declined ${count} ${count === 1 ? "salesperson" : "salespeople"} this week.`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "88px 96px",
          background: PAPER,
          color: INK,
          fontFamily: "Archivo",
          position: "relative",
        }}
      >
        <Tick corner="tl" />
        <Tick corner="tr" />
        <Tick corner="bl" />
        <Tick corner="br" />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders img only */}
          <img src={`data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`} height={52} width={204} alt="" />
          <span style={{ fontSize: 30, color: MUTED }}>@</span>
          <span style={{ fontSize: 24, color: MUTED, letterSpacing: 4 }}>BOUNCER</span>
        </div>
        <div style={{ fontSize: count === undefined ? 64 : 72, lineHeight: 1.04, letterSpacing: -2, maxWidth: 1000 }}>
          {headline}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: MUTED }}>
          <span>Free · forward to {process.env.BOUNCER_FRONT_DOOR ?? "bouncer@pidgeon.ai"}</span>
          <span>bouncer.pidgeon.ai</span>
        </div>
      </div>
    ),
    { ...shareImageSize, fonts: [{ name: "Archivo", data: font, weight: 600, style: "normal" }] },
  );
}

/** A count from a URL segment: a whole number from 0 to 9999, or undefined. */
export function parseCount(raw: string): number | undefined {
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  return Number(raw);
}
