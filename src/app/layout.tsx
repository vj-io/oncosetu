import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Instrument_Sans, Inter_Tight, JetBrains_Mono, Noto_Sans_Devanagari } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

// Self-hosted at build time by next/font: no request leaves for Google at runtime (CSP-friendly).
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });
// Devanagari only downloads when Hindi glyphs render (unicode-range), so no preload.
const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-noto-deva", preload: false });

// Patient (/p/**) and share (/s/**) layouts must override the title: the brand shows as
// "Setu Records" there unless disclosure is cleared.
export const metadata: Metadata = {
  title: "OncoSetu",
  description:
    "Records continuity for cancer care in India: a document index where every displayed fact links to a verbatim source quote, and missing records become tracked requests.",
};

export const viewport: Viewport = {
  themeColor: "#f5f4f0",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: proxy.ts issues a CSP nonce per request, and Next only stamps it on scripts
  // of dynamically rendered pages (a prerendered page's scripts would be blocked).
  await connection();
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${interTight.variable} ${jetbrainsMono.variable} ${notoDevanagari.variable}`}
    >
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
