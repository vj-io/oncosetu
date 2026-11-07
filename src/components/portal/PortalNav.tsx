"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import type { Lang } from "@/core/types";

export type NavItem = { href: string; label: string; query: string };
export type NavGroup = { label: string; items: NavItem[] };

const isActive = (pathname: string, href: string) => (href === "/p" ? pathname === "/p" : pathname === href || pathname.startsWith(`${href}/`));

/**
 * One horizontal line on desktop: the main tabs, a "Privacy & access" menu for the privacy pages, Sign out at the right.
 * Below `md` the same links sit behind a Menu button (no sideways scrolling, nothing hidden). Keyboard: Tab through the
 * tabs, Enter/Space opens the menu, Escape closes it and returns focus to its button. The current page is underlined
 * and marked aria-current; the menu button is underlined when one of its pages is open.
 */
export function PortalNav({
  items, group, label, signOut, signingOut, menuLabel, lang,
}: {
  items: NavItem[];
  group: NavGroup;
  label: string;
  signOut: string;
  signingOut: string;
  menuLabel: string;
  lang: Lang;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The menus remember the page they were opened on, so moving to another page closes them without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null); // desktop dropdown
  const [mobileOn, setMobileOn] = useState<string | null>(null); // small-screen menu
  const open = openOn === pathname;
  const mobile = mobileOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  const setMobile = (v: boolean) => setMobileOn(v ? pathname : null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLLIElement>(null);
  const groupActive = group.items.some((it) => isActive(pathname, it.href));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function out() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace(`/p/login?lang=${lang}`);
      router.refresh();
    }
  }

  const tab = (it: NavItem, extra?: string) => {
    const active = isActive(pathname, it.href);
    return (
      <Link
        href={`${it.href}${it.query}`}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "inline-flex h-11 items-center border-b-2 px-2.5 text-[15px] whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]",
          active ? "border-ink text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink",
          extra,
        )}
      >
        {it.label}
      </Link>
    );
  };

  const signOutBtn = (
    <button type="button" onClick={out} disabled={busy} className="inline-flex h-11 items-center gap-2 px-2.5 text-[15px] whitespace-nowrap text-muted hover:text-ink disabled:opacity-60">
      <LogOut aria-hidden className="size-4" />
      {busy ? signingOut : signOut}
    </button>
  );

  return (
    <nav aria-label={label} className="border-b border-rule" data-testid="portal-nav">
      {/* small screens: one Menu button, then a plain vertical list */}
      <div className="flex items-center justify-between md:hidden">
        <button
          type="button" aria-expanded={mobile} aria-controls="portal-menu" onClick={() => setMobile(!mobile)}
          className="inline-flex h-11 items-center gap-2 px-2.5 text-[15px]"
        >
          {mobile ? <X aria-hidden className="size-4" /> : <Menu aria-hidden className="size-4" />}
          {menuLabel}
        </button>
        {signOutBtn}
      </div>
      {mobile && (
        <ul id="portal-menu" className="grid border-t border-rule pb-2 md:hidden">
          {[...items, ...group.items].map((it) => <li key={it.href}>{tab(it, "w-full")}</li>)}
        </ul>
      )}

      {/* desktop: a single line */}
      <ul className="hidden items-stretch gap-x-0.5 md:flex" data-testid="portal-nav-desktop">
        {items.map((it) => <li key={it.href}>{tab(it)}</li>)}
        <li ref={wrap} className="relative" onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); menuBtn.current?.focus(); } }}>
          <button
            ref={menuBtn} type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}
            className={clsx(
              "inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-[15px] whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]",
              groupActive ? "border-ink text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink",
            )}
          >
            {group.label}
            <ChevronDown aria-hidden className={clsx("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="absolute top-full right-0 z-30 grid min-w-60 border border-rule bg-surface py-1 shadow-placard">
              {group.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={`${it.href}${it.query}`} aria-current={isActive(pathname, it.href) ? "page" : undefined}
                    className={clsx("flex min-h-11 items-center px-4 text-[15px] hover:bg-alcove", isActive(pathname, it.href) ? "font-medium text-ink" : "text-muted hover:text-ink")}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li className="ml-auto">{signOutBtn}</li>
      </ul>
    </nav>
  );
}
