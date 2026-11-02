import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { ButtonLink, Frame, Wordmark } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found · OncoSetu" };

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-reading content-center gap-8 px-4 py-16 sm:px-8">
      <Wordmark />
      <Frame matte>
        <div className="grid gap-3 px-5 py-7 sm:px-8 sm:py-9">
          <p className="ds-kicker">Error 404</p>
          <h1 className="text-3xl tracking-[-0.025em]">This page could not be found.</h1>
          <p className="text-muted">The link may be old or mistyped, or the page may have been removed. Nothing on any record has changed.</p>
        </div>
      </Frame>
      <div>
        <ButtonLink href="/" size="lg">
          Back to the home page <ArrowRight aria-hidden />
        </ButtonLink>
      </div>
    </main>
  );
}
