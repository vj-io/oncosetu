import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LanguageToggle, Spotlight, Wordmark, type Lang } from "@/components/ui";
import { htmlLang } from "@/core/copy";
import { shellCopy } from "@/i18n/shell";

/**
 * Calm patient / caregiver frame: large type, neutral copy. The brand is whatever the caller passes
 * ("Setu Records" unless disclosure is cleared); nothing here names it.
 */
export function PatientShell({
  brand,
  lang,
  displayName,
  homeHref = "/p",
  nav,
  children,
}: {
  brand: "OncoSetu" | "Setu Records";
  lang: Lang;
  displayName: string;
  /** Where the brand mark goes: the portal home when signed in, /p/login when signed out. */
  homeHref?: string;
  /** Page links bar, in a wider container so the whole line fits on one row. */
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div lang={htmlLang(lang)} className={clsx("relative flex min-h-dvh flex-col text-[17px] leading-relaxed", lang === "hi" && "font-deva")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-obsidian focus:px-4 focus:py-3 focus:text-gallery">
        {shellCopy.skipToContent[lang]}
      </a>
      <header className="relative z-10 border-b border-rule bg-gallery">
        <div className="mx-auto flex min-h-16 max-w-reading flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href={homeHref} aria-label={brand} className="inline-flex h-11 items-center"><Wordmark brand={brand} /></Link>
          <div className="ml-auto flex items-center gap-4">
            {displayName && (
              <p className="hidden text-right leading-tight min-[420px]:grid">
                <span className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">{shellCopy.account[lang]}</span>
                <span className="text-[16px]">{displayName}</span>
              </p>
            )}
            <LanguageToggle value={lang} />
          </div>
        </div>
      </header>
      {nav && <div className="relative z-20 border-b border-rule bg-gallery"><div className="mx-auto max-w-5xl px-4 sm:px-6">{nav}</div></div>}
      <div className="relative flex flex-1 flex-col">
        <Spotlight className="opacity-80" />
        <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-reading flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12">
          {children}
        </main>
      </div>
      <footer className="border-t border-rule">
        <p className="mx-auto max-w-reading px-4 py-6 text-[16px] text-muted sm:px-6">{shellCopy.footer[lang]}</p>
      </footer>
    </div>
  );
}
