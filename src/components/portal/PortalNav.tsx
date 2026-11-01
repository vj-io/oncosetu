"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { LogOut } from "lucide-react";

export type NavItem = { href: string; label: string; query: string };

/** Page links (they carry ?lang= so the chosen language sticks) and the sign-out button. */
export function PortalNav({
  items,
  label,
  signOut,
  signingOut,
  lang,
}: {
  items: NavItem[];
  label: string;
  signOut: string;
  signingOut: string;
  lang: "en" | "hi";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function out() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace(`/p/login?lang=${lang}`);
      router.refresh();
    }
  }

  return (
    <nav aria-label={label} className="mb-8 border-b border-rule">
      {/* wraps instead of scrolling sideways: every page link stays visible at 375px */}
      <ul className="flex flex-wrap items-stretch gap-x-1">
        {items.map((it) => {
          const active = it.href === "/p" ? pathname === "/p" : pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <li key={it.href}>
              <Link
                href={`${it.href}${it.query}`}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "inline-flex h-11 items-center border-b-2 px-2.5 text-[15px] whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]",
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink",
                )}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
        <li className="ml-auto">
          <button
            type="button"
            onClick={out}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 px-2.5 text-[15px] text-muted hover:text-ink disabled:opacity-60"
          >
            <LogOut aria-hidden className="size-4" />
            {busy ? signingOut : signOut}
          </button>
        </li>
      </ul>
    </nav>
  );
}
