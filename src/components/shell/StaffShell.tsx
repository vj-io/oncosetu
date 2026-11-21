"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SmsContext } from "@/lib/sms-context";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { ClipboardCheck, ClipboardList, ChevronDown, Compass, Copy, FolderCheck, KeyRound, ListChecks, LogOut, Menu, MonitorSmartphone, ScanLine, Settings2, Smartphone, Users, type LucideIcon } from "lucide-react";
import { menuFor, navFor, roleHome, TOUR_ROLES, type StaffRole } from "@/lib/staff-nav";
import { Avatar, Badge, Dialog, EmptyState, Skeleton, Wordmark } from "@/components/ui";
import { Tour, startTour } from "./Tour";

export type { StaffRole };
const NAV_ICON: Record<string, LucideIcon> = { "/desk": ClipboardCheck, "/records": ListChecks, "/patients": Users, "/preauth": FolderCheck, "/capture": ScanLine, "/admin": Settings2 };
const ROLE_LABEL: Record<StaffRole, string> = { desk: "Desk", records: "Records", clinician: "Clinician", org_admin: "Administrator", auditor: "Auditor" };

export type StaffShellProps = {
  user: { name: string; role: StaffRole; orgName: string };
  demo: boolean;
  sms?: boolean;
  children: ReactNode;
};

export function StaffShell({ user, demo, sms = true, children }: StaffShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const nav = navFor(user.role);
  const home = roleHome(user.role);
  const menu = menuFor(user.role);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const navLink = (n: { href: string; label: string }, onClick?: () => void) => {
    const Icon = NAV_ICON[n.href] ?? Users;
    const on = isActive(n.href);
    return (
      <Link
        href={n.href}
        aria-current={on ? "page" : undefined}
        onClick={onClick}
        className={clsx(
          "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] transition-colors",
          on ? "bg-setu-tint font-semibold text-setu-ink" : "text-nav-text hover:bg-spotlight hover:text-ink",
        )}
      >
        <Icon aria-hidden className={clsx("size-[18px] shrink-0", !on && "text-nav-muted")} />
        {n.label}
      </Link>
    );
  };

  const account = (where: "sidebar" | "bar") => (
    <details className="group relative">
      <summary
        className={clsx(
          "flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-md text-left [&::-webkit-details-marker]:hidden",
          where === "sidebar" ? "w-full px-2 py-1.5 hover:bg-spotlight" : "px-1.5 hover:bg-spotlight",
        )}
      >
        <span className="sr-only">Account menu</span>
        <Avatar name={user.name} size="sm" />
        {where === "sidebar" && (
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-semibold text-ink">{user.name}</span>
            <span className="truncate text-[13px] text-nav-muted">{ROLE_LABEL[user.role]}</span>
          </span>
        )}
        <ChevronDown aria-hidden className={clsx("size-4 shrink-0 text-nav-muted", where === "sidebar" ? "rotate-180 group-open:rotate-0" : "group-open:rotate-180")} />
      </summary>
      <div
        className={clsx(
          "absolute z-50 hidden w-64 overflow-hidden rounded-lg border border-rule bg-surface py-1 text-ink shadow-pop group-open:grid",
          where === "sidebar" ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2",
        )}
      >
        <p className="border-b border-rule px-4 py-2.5 text-sm">
          <span className="block font-medium text-ink">{user.name}</span>
          <span className="text-[13px] text-faint">{ROLE_LABEL[user.role]} · {user.orgName}</span>
        </p>
        {TOUR_ROLES.includes(user.role) && (
          <button type="button" onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); startTour(); }} className="flex min-h-11 items-center gap-2.5 px-4 text-left text-[15px] hover:bg-spotlight">
            <Compass aria-hidden className="size-4 text-muted" />Take the 2-minute tour
          </button>
        )}
        {menu.map((m) => (
          <Link key={m.href} href={m.href} onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")} className="flex min-h-11 items-center gap-2.5 px-4 text-[15px] hover:bg-spotlight">
            {m.href === "/measure" ? <ClipboardList aria-hidden className="size-4 text-muted" /> : m.href === "/admin/duplicates" ? <Copy aria-hidden className="size-4 text-muted" /> : m.href === "/account/password" ? <KeyRound aria-hidden className="size-4 text-muted" /> : <MonitorSmartphone aria-hidden className="size-4 text-muted" />}
            {m.label}
          </Link>
        ))}
        <button type="button" onClick={signOut} disabled={signingOut} className="flex min-h-11 items-center gap-2.5 border-t border-rule px-4 text-left text-[15px] hover:bg-spotlight">
          <LogOut aria-hidden className="size-4 text-muted" />Sign out
        </button>
      </div>
    </details>
  );

  return (
    <div className="relative min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-pine focus:px-4 focus:py-3 focus:text-white">
        Skip to content
      </a>

      {/* Desktop: a fixed pine sidebar. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-rule bg-surface lg:flex">
        <div className="px-4 pt-5 pb-4">
          <Link href={home} aria-label="OncoSetu home" className="flex min-h-11 items-center rounded-md px-1 ">
            <Wordmark />
          </Link>
          <p className="mt-1 truncate px-1 text-[13px] text-nav-muted" title={user.orgName}>{user.orgName}</p>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="grid gap-1">
            {nav.map((n) => <li key={n.href}>{navLink(n)}</li>)}
          </ul>
        </nav>
        <div className="border-t border-rule p-3">{account("sidebar")}</div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Tablet and phone: a pine top bar with the menu. */}
        <header className="sticky top-0 z-30 border-b border-rule bg-surface lg:hidden">
          <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className="grid size-11 shrink-0 place-items-center rounded-md text-ink hover:bg-spotlight">
              <Menu aria-hidden className="size-5" />
            </button>
            <Link href={home} aria-label="OncoSetu home" className="flex min-h-11 shrink-0 items-center rounded-md px-1 ">
              <Wordmark />
            </Link>
            <div className="ml-auto">{account("bar")}</div>
          </div>
        </header>

        {demo && (
          <div className="border-b border-setu/25 bg-setu-tint text-setu-ink">
            <div className="mx-auto flex min-h-11 max-w-gallery items-center justify-between gap-3 pl-4 sm:pl-8">
              <p className="text-[13px] font-medium">Demo · synthetic data</p>
              <button
                type="button"
                onClick={() => setPhoneOpen(true)}
                className="inline-flex h-11 shrink-0 items-center gap-2 px-4 text-[13px] font-medium whitespace-nowrap hover:bg-setu/10 sm:px-8"
              >
                <Smartphone aria-hidden className="size-4" />
                Demo phone
              </button>
            </div>
          </div>
        )}

        <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-gallery flex-1 px-4 py-6 outline-none sm:px-8 sm:py-8">
          <SmsContext.Provider value={{ sms, demo }}>{children}</SmsContext.Provider>
        </main>

        <footer className="border-t border-rule">
          <p className="mx-auto max-w-gallery px-4 py-4 text-[13px] leading-relaxed text-faint sm:px-8">
            {pathname === "/admin" || pathname.startsWith("/admin/")
              ? "OncoSetu is a records index, not a clinical tool · Every change made here is written to the activity log"
              : "A list of what is in the file, not a clinical summary · Every fact shown links to the exact words in the document"}
          </p>
        </footer>
      </div>

      <Dialog open={navOpen} onClose={() => setNavOpen(false)} placement="left" title={<Wordmark />} description={`${ROLE_LABEL[user.role]} · ${user.orgName}`}>
        <nav aria-label="Primary">
          <ul className="grid gap-1">
            {nav.map((n) => <li key={n.href}>{navLink(n, () => setNavOpen(false))}</li>)}
          </ul>
        </nav>
        <div className="mt-8 flex items-center gap-3 border-t border-rule pt-4">
          <Avatar name={user.name} size="sm" />
          <div className="grid leading-tight">
            <span className="text-sm font-medium">{user.name}</span>
            <span className="text-[13px] text-faint">{ROLE_LABEL[user.role]}</span>
          </div>
        </div>
      </Dialog>

      <Tour />

      {demo && (
        <Dialog open={phoneOpen} onClose={() => setPhoneOpen(false)} placement="right" title="Demo phone" description="The text messages and WhatsApp messages this demo sent. Each one says whether it was only simulated.">
          <DemoOutbox />
        </Dialog>
      )}
    </div>
  );
}

type OutboxMessage = { id: string; channel: string; toMasked: string; body: string; createdAt: string; delivery: "simulated" | "queued" | "sent" | "failed"; deliveryError: string | null };

/** Mounted only while the drawer is open, so polling stops when it closes. */
function DemoOutbox() {
  const [messages, setMessages] = useState<OutboxMessage[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Poll every 3 s, counted from the end of the previous request so slow responses never pile up.
    const load = async () => {
      try {
        const res = await fetch("/api/demo/outbox", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { messages: OutboxMessage[] };
        if (alive) {
          setMessages(json.messages);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
      if (alive) timer = setTimeout(load, 3000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[22rem] rounded-[2rem] border-[10px] border-pine-deep bg-gallery shadow-pop">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="text-[13px] text-faint font-medium">Inbox</span>
        <span className="flex items-center gap-1.5 text-[13px] text-setu-ink font-medium">
          <span aria-hidden className="ds-pulse size-1.5 rounded-full bg-setu" />
          Live · 3 s
        </span>
      </div>
      <div aria-live="polite" className="grid min-h-80 content-start gap-3 p-3">
        {error && !messages && <EmptyState title="Outbox unavailable" description="Could not load the demo outbox. Retrying every 3 seconds." className="py-8" />}
        {!error && !messages && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        {messages?.length === 0 && <EmptyState title="No messages yet" description="Upload links, OTP codes and request reminders appear here." className="py-8" />}
        {messages
          ?.slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((m) => (
            <article key={m.id} className="grid gap-1.5">
              <header className="flex flex-wrap items-center gap-2">
                <Badge tone={/whats/i.test(m.channel) ? "setu" : "neutral"}>{/whats/i.test(m.channel) ? "WhatsApp" : "SMS"}</Badge>
                <span className="text-xs text-muted">{m.toMasked}</span>
                <Badge tone={m.delivery === "failed" ? "conflict" : m.delivery === "sent" ? "verified" : "neutral"}>
                  {m.delivery === "failed" && m.deliveryError ? `failed · ${m.deliveryError}` : m.delivery}
                </Badge>
                <time dateTime={m.createdAt} className="ml-auto text-xs text-faint">
                  {new Date(m.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>
              <p className="rounded-lg rounded-tl-xs border border-rule bg-matte px-3 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {m.body.split(/(https?:\/\/\S+)/g).map((part, i) =>
                  i % 2 ? (
                    <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-setu-ink underline decoration-link underline-offset-2">
                      {part}
                    </a>
                  ) : (
                    part
                  ),
                )}
              </p>
            </article>
          ))}
      </div>
    </div>
  );
}
