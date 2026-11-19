import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, HeartHandshake, Stethoscope } from "lucide-react";
import { Spotlight, Wordmark } from "@/components/ui";

function Entry({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group grid h-full content-start gap-3 border border-rule bg-surface px-6 py-7 shadow-placard transition-colors hover:bg-spotlight sm:px-7"
      >
        <span aria-hidden className="text-setu">{icon}</span>
        <span className="flex items-center justify-between gap-3">
          <span className="font-display text-2xl tracking-[-0.02em]">{title}</span>
          <ArrowRight aria-hidden className="size-5 shrink-0 text-faint group-hover:text-ink" />
        </span>
        <span className="text-[15px] text-muted">{text}</span>
      </Link>
    </li>
  );
}

export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-obsidian focus:px-4 focus:py-3 focus:text-gallery">
        Skip to content
      </a>
      <header className="relative z-20 border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Wordmark />
        </div>
      </header>

      <main id="main" className="relative flex-1 overflow-x-clip">
        <Spotlight />
        <div className="relative mx-auto grid max-w-gallery gap-12 px-4 pt-12 pb-16 sm:px-8 sm:pt-20 sm:pb-24">
          <div className="grid max-w-3xl gap-5">
            <p className="ds-kicker">Records for cancer care in India</p>
            <h1 className="text-display">The papers a cancer patient carries, in one list the next clinic can trust.</h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted">
              OncoSetu is a records index. It lists a patient&rsquo;s documents, shows the exact words behind every fact, and says which papers are missing.
              It is for hospital staff, patients and their families. It never diagnoses or advises.
            </p>
          </div>

          <ul className="grid gap-5 md:grid-cols-3" aria-label="Where do you want to go?">
            <Entry href="/login" icon={<Stethoscope className="size-8" />} title="Hospital staff" text="Desk, records, doctors, admin and audit. Sign in with your authenticator app." />
            <Entry href="/p/login" icon={<HeartHandshake className="size-8" />} title="Patient or family" text="See your papers, send new ones, and share them with a doctor." />
            <Entry href="/verify" icon={<BadgeCheck className="size-8" />} title="Check a sealed record" text="Got a seal link or code from a hospital? Check it has not been changed." />
          </ul>

          <p className="max-w-2xl text-sm text-muted">
            Academic prototype with made-up records only. A list of documents, not a clinical summary.
          </p>
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-gallery flex-wrap items-center gap-x-6 px-4 py-3 sm:px-8">
          <Link href="/security" className="inline-flex h-11 items-center text-[15px] text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">
            Security and privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
