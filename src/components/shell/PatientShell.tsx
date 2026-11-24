import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LanguageToggle, Wordmark, type Lang } from "@/components/ui";
import { htmlLang } from "@/core/copy";
import { LangMemory } from "@/components/portal/LangMemory";
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
      <LangMemory lang={lang} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-pine focus:px-4 focus:py-3 focus:text-white">
        {shellCopy.skipToContent[lang]}
      </a>
      <header className="relative z-10 border-b border-edge bg-surface">
        <div className="mx-auto flex min-h-16 max-w-reading flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href={homeHref} aria-label={brand} className="inline-flex h-11 items-center rounded-md"><Wordmark brand={brand} /></Link>
          <div className="ml-auto flex items-center gap-4">
            {displayName && (
              <p className="hidden text-right leading-tight min-[420px]:grid">
                <span className="text-[14px] text-faint">{shellCopy.account[lang]}</span>
                <span className="text-[16px] font-medium">{displayName}</span>
              </p>
            )}
            <LanguageToggle value={lang} />
          </div>
        </div>
      </header>
      {nav && <div className="relative z-20 md:border-b md:border-rule md:bg-surface"><div className="mx-auto max-w-5xl px-2 sm:px-4">{nav}</div></div>}
      <div className="relative flex flex-1 flex-col">
        <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-reading flex-1 px-4 pt-6 pb-10 outline-none sm:px-6 sm:pt-10">
          {children}
        </main>
      </div>
      <footer className={clsx("border-t border-rule", nav && "max-md:pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]")}>
        <p className="mx-auto max-w-reading px-4 py-6 text-[16px] text-muted sm:px-6">{shellCopy.footer[lang]}</p>
      </footer>
    </div>
  );
}
