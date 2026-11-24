import type { ReactNode } from "react";
import Link from "next/link";
import { ButtonLink, Wordmark } from "@/components/ui";
import { isDemo } from "@/server/demo";

/**
 * The frame of every public page (home, security, seal check, not found): the same header and footer, so moving from the
 * home page to a sign-in or a seal check feels like one product. `actions` false hides the sign-in buttons. Under the neutral
 * "Setu Records" brand the header and footer link to nothing that names the cancer service.
 */
export function PublicShell({ children, actions = true, brand = "OncoSetu" }: { children: ReactNode; actions?: boolean; /** "Setu Records" on pages a patient may reach (FR-CON-07). */ brand?: "OncoSetu" | "Setu Records" }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-pine focus:px-4 focus:py-3 focus:text-white">
        Skip to content
      </a>
      <header className="relative z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:h-[4.5rem] sm:px-8">
          <Link href="/" aria-label={`${brand} home`} className="flex min-h-11 items-center rounded-md">
            <Wordmark brand={brand} />
          </Link>
          {brand === "OncoSetu" && <nav aria-label="Site" className="hidden items-center gap-1 text-[15px] font-medium text-nav-text md:flex">
            <Link href="/#how" className="inline-flex h-11 items-center rounded-md px-3 hover:bg-surface hover:text-ink">How it works</Link>
            <Link href="/#about" className="inline-flex h-11 items-center rounded-md px-3 hover:bg-surface hover:text-ink">About</Link>
            <Link href="/security" className="inline-flex h-11 items-center rounded-md px-3 hover:bg-surface hover:text-ink">Security</Link>
          </nav>}
          {actions && brand === "OncoSetu" && (
            <div className="ml-auto flex items-center gap-2">
              <ButtonLink href="/p/login" variant="secondary" className="max-sm:hidden">Patient or family</ButtonLink>
              <ButtonLink href="/login">Staff sign in</ButtonLink>
            </div>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="relative flex-1 outline-none">{children}</main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 text-[15px] text-muted sm:px-8">
          {/* The demo runs on made-up records; the pilot holds real patients' records, added only with their consent. */}
          <span>{brand} · {isDemo() ? "academic prototype with made-up records" : "academic pilot, records added only with the patient's consent"}</span>
          {brand === "OncoSetu" && <Link href="/security" className="inline-flex min-h-11 items-center text-ink underline decoration-link underline-offset-4 hover:decoration-ink">Security and privacy</Link>}
          <Link href="/verify" className="inline-flex min-h-11 items-center text-ink underline decoration-link underline-offset-4 hover:decoration-ink">Check a sealed record</Link>
        </div>
      </footer>
    </div>
  );
}
