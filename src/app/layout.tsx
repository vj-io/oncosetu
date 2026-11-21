import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Figtree, IBM_Plex_Mono, Noto_Sans_Devanagari } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

// Self-hosted at build time by next/font: no request leaves for Google at runtime (CSP-friendly).
// Figtree for everything (text, headings, numbers); Plex Mono for codes only; Noto Sans Devanagari for Hindi and Marathi.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", preload: false });
// Devanagari only downloads when Hindi or Marathi glyphs render (unicode-range), so no preload.
const notoDeva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-noto-deva", preload: false });

// Patient (/p/**) and share (/s/**) layouts must override the title: the brand shows as
// "Setu Records" there unless disclosure is cleared.
export const metadata: Metadata = {
  title: "OncoSetu",
  description:
    "Records continuity for cancer care in India: a document index where every displayed fact links to a verbatim source quote, and missing records become tracked requests.",
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: proxy.ts issues a CSP nonce per request, and Next only stamps it on scripts
  // of dynamically rendered pages (a prerendered page's scripts would be blocked).
  await connection();
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${plexMono.variable} ${notoDeva.variable}`}
    >
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
