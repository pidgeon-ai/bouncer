import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

const site = process.env.BOUNCER_SITE_URL ?? "https://bouncer.pidgeon.ai";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Bouncer, by Pidgeon: your AI says no to cold sales email",
  description:
    "Forward a cold sales email to bouncer@pidgeon.ai. Bouncer politely declines it for you, handles the follow-ups, and passes anything real back. Free and open source, built on Pidgeon.",
  openGraph: { type: "website", siteName: "Bouncer" },
};

export const viewport: Viewport = { themeColor: "#f8f6f2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
