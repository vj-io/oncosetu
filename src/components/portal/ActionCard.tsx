import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight } from "lucide-react";

/** A big, calm tap target: icon, title, one line. At least 88px tall. `primary` is the page's one main action (teal). */
export function ActionCard({ href, icon, title, text, note, primary = false }: { href: string; icon: ReactNode; title: string; text: string; note?: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={clsx(
        "group flex min-h-[88px] items-center gap-4 rounded-lg px-4 py-4 shadow-card transition-colors sm:px-5",
        primary ? "bg-pine text-white hover:bg-pine-hover" : "border border-rule bg-surface hover:border-control/50 hover:bg-spotlight",
      )}
    >
      <span aria-hidden className={clsx("grid size-12 shrink-0 place-items-center rounded-md [&_svg]:size-6", primary ? "bg-white/15 text-white" : "bg-setu-tint text-setu-ink")}>
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-display text-lg leading-snug">{title}</span>
        <span className={clsx("text-[16px]", primary ? "text-white/90" : "text-muted")}>{text}</span>
        {note && <span className={clsx("text-[16px]", primary ? "text-white" : "text-ink")}>{note}</span>}
      </span>
      <ArrowRight aria-hidden className={clsx("size-5 shrink-0 transition-transform group-hover:translate-x-0.5", primary ? "text-white" : "text-faint")} />
    </Link>
  );
}
