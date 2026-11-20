"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export type TabLink = { href: string; label: string; count?: number };

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
      "inline-flex h-11 items-center gap-2 border-b-2 px-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]",
      active ? "border-ink text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink",
    );

  return (
    <div className="flex items-stretch">
      <nav aria-label="Patient workspace" className="min-w-0 overflow-x-auto">
        <ul className="flex min-w-max gap-1">
          {main.map((it) => (
            <li key={it.href}>
              <Item it={it} inert={inert} active={on(it.href)} className={tab(on(it.href))}>
                {it.label}
                {it.count != null && <span className="min-w-5 border border-rule bg-matte px-1 text-center font-mono text-[11px] text-faint tabular-nums">{it.count}</span>}
              </Item>
            </li>
          ))}
        </ul>
      </nav>
      {more.length > 0 && (
        <div ref={box} className="relative shrink-0">
          <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className={clsx(tab(moreActive), "cursor-pointer")}>
            More
            <ChevronDown aria-hidden className={clsx("size-4", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="absolute right-0 z-40 mt-px grid w-64 border border-rule bg-matte py-1 shadow-frame">
              {more.map((it) => (
                <li key={it.href}>
                  <Item it={it} inert={inert} active={on(it.href)} className={clsx("flex min-h-11 items-center px-4 text-[15px] hover:bg-spotlight", on(it.href) ? "text-ink underline decoration-brass underline-offset-4" : "text-muted")}>
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
