"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export type TabLink = { href: string; label: string; count?: number; /** What the number counts, said out loud ('papers on file'). */ countLabel?: string };

function Item({ it, inert, active, className, children }: { it: TabLink; inert: boolean; active: boolean; className: string; children: ReactNode }) {
  if (inert) return <span className={className}>{children}</span>;
  return <Link href={it.href} aria-current={active ? "page" : undefined} className={className}>{children}</Link>;
}

/** Six main tabs in a row plus a "More" menu. The row scrolls sideways on a phone; the menu stays outside the scroller so it is never clipped. */
export function PatientTabsNav({ main, more, inert = false }: { main: TabLink[]; more: TabLink[]; /** Example use (style guide): tabs are plain text, not links. */ inert?: boolean }) {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  const box = useRef<HTMLDivElement>(null);
  // One paper opened from All records (/documents/<id>) belongs to that tab, not to "Documents" under More.
  const onePaper = /\/documents\/[0-9a-f-]{36}$/i.test(pathname);
  const on = (href: string) => {
    if (onePaper && href.endsWith("/documents")) return false;
    if (onePaper && href.endsWith("/records")) return true;
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const moreActive = more.some((m) => on(m.href));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpenOn(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenOn(null); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const tab = (active: boolean) =>
    clsx(
      "inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[15px] whitespace-nowrap transition-colors",
      active ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:bg-surface/60 hover:text-ink",
    );

  return (
    <div className="grid gap-1 rounded-md bg-alcove p-1 sm:flex sm:items-center">
      <nav aria-label="Patient workspace" className="relative min-w-0 sm:overflow-x-auto">
        <ul className="grid grid-cols-2 gap-1 sm:flex sm:min-w-max">
          {main.map((it) => (
            <li key={it.href}>
              <Item it={it} inert={inert} active={on(it.href)} className={clsx(tab(on(it.href)), "w-full justify-center sm:w-auto")}>
                {it.label}
                {it.count != null && <span title={it.countLabel ? `${it.count} ${it.countLabel}` : undefined} className={clsx("min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-medium tabular-nums", on(it.href) ? "bg-setu-tint text-setu-ink" : "bg-floor text-muted")}>{it.count}{it.countLabel && <span className="sr-only"> {it.countLabel}</span>}</span>}
              </Item>
            </li>
          ))}
        </ul>
      </nav>
      {more.length > 0 && (
        <div ref={box} className="relative shrink-0">
          <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className={clsx(tab(moreActive), "w-full cursor-pointer justify-center sm:w-auto")}>
            More
            <ChevronDown aria-hidden className={clsx("size-4", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="absolute right-0 z-40 mt-2 grid w-64 overflow-hidden rounded-lg border border-rule bg-surface py-1 shadow-pop">
              {more.map((it) => (
                <li key={it.href}>
                  <Item it={it} inert={inert} active={on(it.href)} className={clsx("flex min-h-11 items-center px-4 text-[15px] hover:bg-spotlight", on(it.href) ? "bg-setu-tint font-semibold text-setu-ink" : "text-nav-text hover:text-ink")}>
                    {it.label}
                  </Item>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
