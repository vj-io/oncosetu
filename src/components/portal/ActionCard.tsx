import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** A big, calm tap target: icon, title, one line. At least 88px tall. */
export function ActionCard({ href, icon, title, text, note }: { href: string; icon: ReactNode; title: string; text: string; note?: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-[88px] items-center gap-4 border border-rule bg-surface px-4 py-4 shadow-placard transition-colors hover:bg-spotlight sm:px-5"
    >
      <span aria-hidden className="grid size-12 shrink-0 place-items-center border border-rule bg-matte text-setu-ink [&_svg]:size-6 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-display text-xl leading-snug tracking-[-0.015em]">{title}</span>
        <span className="text-[15px] text-muted">{text}</span>
        {note && <span className="text-[15px] text-ink">{note}</span>}
      </span>
      <ArrowRight aria-hidden className="size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
