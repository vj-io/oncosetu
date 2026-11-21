"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Any page that fails to render lands here instead of the framework's bare error screen. Neutral wording and no brand
 * name (it can be a patient's page). Nothing about the record is shown, and nothing has been changed.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-reading content-center px-4 py-16 sm:px-8">
      <div className="grid gap-4 rounded-lg border border-rule bg-surface px-6 py-8 shadow-card sm:px-8 sm:py-10">
        <span aria-hidden className="grid size-12 place-items-center rounded-md bg-amber-tint text-amber-ink"><TriangleAlert className="size-6" /></span>
        <h1 className="text-[1.75rem] leading-tight tracking-[-0.02em]">This page could not be shown.</h1>
        <p className="text-muted">Something went wrong while loading it. Nothing on any record has changed. Try again, or go back to the page you came from.</p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Button onClick={reset} icon={<RotateCcw aria-hidden />}>Try again</Button>
          <Button variant="secondary" onClick={() => history.back()}>Go back</Button>
        </div>
      </div>
    </main>
  );
}
