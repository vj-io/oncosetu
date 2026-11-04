import type { Metadata } from "next";
import { Frame, Wordmark } from "@/components/ui";

// Shown for every unknown URL, including mistyped patient (/p/**) and share (/s/**) links, so it stays neutral:
// the "Setu Records" brand, no "Onco" in the tab title and no link to the landing page (FR-CON-07).
export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-reading content-center gap-8 px-4 py-16 sm:px-8">
      <Wordmark brand="Setu Records" />
      <Frame matte>
        <div className="grid gap-3 px-5 py-7 sm:px-8 sm:py-9">
          <p className="ds-kicker">Error 404</p>
          <h1 className="text-3xl tracking-[-0.025em]">This page could not be found.</h1>
          <p className="text-muted">The link may be old or mistyped, or the page may have been removed. Nothing on any record has changed.</p>
        </div>
      </Frame>
    </main>
  );
}
