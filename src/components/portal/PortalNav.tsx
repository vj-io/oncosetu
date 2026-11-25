"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import type { Lang } from "@/core/types";
import { clearDrawnPages } from "@/components/documents/drawn-pages";

export type NavItem = { href: string; label: string; query: string };
export type NavGroup = { label: string; items: NavItem[] };
/** A bottom-bar tab on a phone: a short label and an icon. */
export type BarItem = { href: string; label: string; query: string; icon: ReactNode };

const isActive = (pathname: string, href: string) => (href === "/p" ? pathname === "/p" : pathname === href || pathname.startsWith(`${href}/`));

/**
 * Desktop: one line of tabs, a "Settings and privacy" menu, Sign out at the right.
 * Phone: a bottom tab bar (Home · Send · Questions · Share · More), as in the phone apps people already use. "More" opens a
 * panel with every other page and Sign out. Keyboard: Escape closes the menus and returns focus to their button.
 */
export function PortalNav({
  items, group, bar, label, signOut, signingOut, moreLabel, moreTitle, closeLabel, lang,
}: {
  items: NavItem[];
  group: NavGroup;
  bar: BarItem[];
  label: string;
  signOut: string;
  signingOut: string;
  moreLabel: string;
  moreTitle: string;
  closeLabel: string;
  lang: Lang;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The menus remember the page they were opened on, so moving to another page closes them without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null); // desktop dropdown
  const [moreOn, setMoreOn] = useState<string | null>(null); // phone "More" panel
  const open = openOn === pathname;
  const more = moreOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  const setMore = (v: boolean) => setMoreOn(v ? pathname : null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLLIElement>(null);
  const groupActive = group.items.some((it) => isActive(pathname, it.href));
  const inBar = (href: string) => bar.some((b) => b.href === href);
  const rest = [...items.filter((it) => !inBar(it.href)), ...group.items];
  const moreActive = rest.some((it) => isActive(pathname, it.href));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!more) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMore(false); moreBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]); // eslint-disable-line react-hooks/exhaustive-deps

  async function out() {
    setBusy(true);
    clearDrawnPages();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace(`/p/login?lang=${lang}`);
      router.refresh();
    }
  }

  const tab = (it: NavItem) => {
    const active = isActive(pathname, it.href);
    return (
      <Link
        href={`${it.href}${it.query}`}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "inline-flex h-11 items-center rounded-md px-3 text-[16px] whitespace-nowrap transition-colors",
          active ? "bg-setu-tint font-semibold text-setu-ink" : "text-nav-text hover:bg-spotlight hover:text-ink",
        )}
      >
        {it.label}
      </Link>
    );
  };

  const signOutBtn = (className?: string) => (
    <button type="button" onClick={out} disabled={busy} className={clsx("inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-[16px] whitespace-nowrap text-nav-text hover:bg-spotlight hover:text-ink disabled:opacity-60", className)}>
      <LogOut aria-hidden className="size-4" />
      {busy ? signingOut : signOut}
    </button>
  );

  return (
    <nav aria-label={label} data-testid="portal-nav">
      {/* desktop: a single line of tabs */}
      <ul className="hidden items-center gap-1 py-2 md:flex" data-testid="portal-nav-desktop">
        {items.map((it) => <li key={it.href}>{tab(it)}</li>)}
        <li ref={wrap} className="relative" onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); menuBtn.current?.focus(); } }}>
          <button
            ref={menuBtn} type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}
            className={clsx(
              "inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[16px] whitespace-nowrap transition-colors",
              groupActive ? "bg-setu-tint font-semibold text-setu-ink" : "text-nav-text hover:bg-spotlight hover:text-ink",
            )}
          >
            {group.label}
            <ChevronDown aria-hidden className={clsx("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="absolute top-full right-0 z-30 mt-2 grid min-w-60 overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-pop">
              {group.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={`${it.href}${it.query}`} aria-current={isActive(pathname, it.href) ? "page" : undefined}
                    className={clsx("flex min-h-11 items-center px-4 text-[16px] hover:bg-spotlight", isActive(pathname, it.href) ? "font-semibold text-setu-ink" : "text-nav-text hover:text-ink")}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li className="ml-auto">{signOutBtn()}</li>
      </ul>

      {/* phone: a bottom tab bar, and a "More" panel above it */}
      {more && <div aria-hidden className="fixed inset-0 z-40 bg-ink/30 md:hidden" onClick={() => setMore(false)} />}
      {more && (
        <div ref={panel} id="portal-more" className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-50 mx-2 rounded-xl border border-edge bg-surface p-2 shadow-pop md:hidden">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <p className="text-[16px] font-semibold">{moreTitle}</p>
            <button type="button" onClick={() => { setMore(false); moreBtn.current?.focus(); }} className="grid size-11 place-items-center rounded-md text-muted hover:bg-spotlight" aria-label={closeLabel}>
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <ul className="grid">
            {rest.map((it) => (
              <li key={it.href}>
                <Link
                  href={`${it.href}${it.query}`} aria-current={isActive(pathname, it.href) ? "page" : undefined}
                  className={clsx("flex min-h-12 items-center rounded-md px-3 text-[16px]", isActive(pathname, it.href) ? "bg-setu-tint font-semibold text-setu-ink" : "text-ink hover:bg-spotlight")}
                >
                  {it.label}
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-rule pt-1">{signOutBtn("w-full")}</li>
          </ul>
        </div>
      )}
      <ul className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom,0px)] md:hidden">
        {bar.map((b) => {
          const active = isActive(pathname, b.href) && !more;
          return (
            <li key={b.href}>
              <Link
                href={`${b.href}${b.query}`} aria-current={active ? "page" : undefined}
                className={clsx("flex h-[4.25rem] flex-col items-center justify-center gap-0.5 px-1 text-[16px] leading-tight [&_svg]:size-6", active ? "font-semibold text-setu-ink" : "text-nav-text")}
              >
                <span aria-hidden>{b.icon}</span>
                <span className="max-w-full truncate">{b.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            ref={moreBtn} type="button" aria-expanded={more} aria-controls="portal-more" onClick={() => setMore(!more)}
            className={clsx("flex h-[4.25rem] w-full flex-col items-center justify-center gap-0.5 px-1 text-[16px] leading-tight [&_svg]:size-6", more || moreActive ? "font-semibold text-setu-ink" : "text-nav-text")}
          >
            <Menu aria-hidden />
            <span>{moreLabel}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
