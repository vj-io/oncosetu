import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Wordmark } from "@/components/ui";

/**
 * Staff sign-in and password reset: a teal panel that says what OncoSetu is (desktop only) beside the form.
 * The form column keeps its own header on a phone, so the brand is always on screen.
 */
export function AuthShell({ headline, points, children, footer }: { headline: string; points: string[]; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-pine focus:px-4 focus:py-3 focus:text-white">
        Skip to content
      </a>
      <aside className="ds-side relative hidden flex-col px-12 py-10 text-white lg:flex">
        <Link href="/" aria-label="OncoSetu home" className="flex min-h-11 w-fit items-center rounded-md focus-visible:outline-white">
          <Wordmark onDark />
        </Link>
        <div className="my-auto grid max-w-md gap-6">
          <p className="font-display text-[2.5rem] leading-[1.1] tracking-[-0.02em]">{headline}</p>
          <ul className="grid gap-3 text-[17px] text-white/90">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3"><Check aria-hidden className="mt-1 size-5 shrink-0" />{p}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/80">Academic prototype with made-up records. A list of documents, not a clinical summary.</p>
      </aside>
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="OncoSetu home" className="flex min-h-11 items-center rounded-md lg:hidden">
            <Wordmark />
          </Link>
          {footer && <div className="ml-auto">{footer}</div>}
        </header>
        <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pt-4 pb-12 outline-none sm:px-8 lg:items-center lg:pt-0">
          <div className="w-full max-w-[28rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
