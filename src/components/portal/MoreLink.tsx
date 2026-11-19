import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** A quiet row for the "More" list on Home: one title, one short line, a tap target at least 56px tall. */
export function MoreLink({ href, icon, title, note }: { href: string; icon: ReactNode; title: string; note: string }) {
  return (
    <Link href={href} className="group flex min-h-14 items-center gap-3 border border-rule bg-surface px-4 py-3 transition-colors hover:bg-spotlight">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center text-setu-ink [&_svg]:size-5 [&_svg]:stroke-[1.5]">{icon}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[17px] leading-snug font-medium">{title}</span>
        <span className="text-[16px] text-muted">{note}</span>
      </span>
      <ArrowRight aria-hidden className="size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
