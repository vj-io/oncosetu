"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SmsContext } from "@/lib/sms-context";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft, CalendarRange, ChartColumn, ChevronDown, ChevronRight, Circle, ClipboardCheck, ClipboardList, Compass, Copy, Eraser, FileSearch, FileText, FileX,
  FolderCheck, FolderOpen, History, IdCard, KeyRound, LayoutDashboard, ListChecks, LogOut, Mail, Menu, MessageCircle, MonitorSmartphone, PackageCheck,
  ScanLine, Search, Send, Settings, Share2, ShieldAlert, ShieldCheck, Siren, Smartphone, Sparkles, TabletSmartphone, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { roleHome, TOUR_ROLES, type StaffRole } from "@/lib/staff-nav";
import { currentItem, patientGroupsFor, patientIdIn, sidebarFor, type SideGroup, type SideItem } from "@/lib/sidebar";
import { Avatar, Badge, Dialog, EmptyState, Skeleton, Wordmark } from "@/components/ui";
import { Tour, startTour } from "./Tour";

export type { StaffRole };
const ROLE_LABEL: Record<StaffRole, string> = { desk: "Desk", records: "Records", clinician: "Clinician", org_admin: "Administrator", auditor: "Auditor" };
const ICONS: Record<string, LucideIcon> = {
  "clipboard-check": ClipboardCheck, "list-checks": ListChecks, users: Users, "folder-check": FolderCheck, "scan-line": ScanLine, "layout-dashboard": LayoutDashboard,
  "user-plus": UserPlus, "clipboard-list": ClipboardList, copy: Copy, "key-round": KeyRound, "monitor-smartphone": MonitorSmartphone, mail: Mail, send: Send,
  "package-check": PackageCheck, "file-search": FileSearch, "tablet-smartphone": TabletSmartphone, "shield-alert": ShieldAlert, siren: Siren, history: History,
  "chart-column": ChartColumn, eraser: Eraser, settings: Settings, "folder-open": FolderOpen, sparkles: Sparkles, "calendar-range": CalendarRange,
  "message-circle": MessageCircle, "file-text": FileText, "file-x": FileX, "share-2": Share2, "shield-check": ShieldCheck, "id-card": IdCard,
};
/** Roles that can search patients from the top bar (the patients list is their page). */
const SEARCH_ROLES: StaffRole[] = ["desk", "records", "clinician"];

export type StaffShellProps = {
  user: { name: string; role: StaffRole; orgName: string };
  demo: boolean;
  sms?: boolean;
  children: ReactNode;
};

export function StaffShell({ user, demo, sms = true, children }: StaffShellProps) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const home = roleHome(user.role);
  const patientId = patientIdIn(pathname);
  const groups: SideGroup[] = sidebarFor(user.role);
  const patientGroups: SideGroup[] = patientId ? patientGroupsFor(patientId, user.role) : [];
  const all = [...groups, ...patientGroups].flatMap((g) => g.items);
  const current = currentItem(all, pathname, view);
  const currentGroup = [...patientGroups, ...groups].find((g) => g.items.includes(current as SideItem));
  const crumbs = patientId
    ? [{ label: "Patients", href: user.role === "desk" ? "/desk" : "/patients" }, { label: current?.label ?? "Patient record" }]
    : [currentGroup && currentGroup.label !== "Work" ? { label: currentGroup.label } : null, current ? { label: current.label } : null].filter(Boolean) as { label: string; href?: string }[];

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    router.push(q ? `/patients?q=${encodeURIComponent(q)}` : "/patients");
  }

  const link = (i: SideItem, dark: boolean, onClick?: () => void) => {
    const Icon = ICONS[i.icon] ?? Circle;
    const on = current === i;
    return (
      <Link
        href={i.view ? `${i.href}?view=${i.view}` : i.href}
        aria-current={on ? "page" : undefined}
        onClick={onClick}
        className={clsx(
          "flex min-h-10 items-center gap-3 rounded-md px-3 text-[15px] transition-colors",
          i.sub && "ml-4 min-h-9 text-[14px]",
          dark
            ? on ? "bg-white/12 font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]" : "text-side-text hover:bg-white/8 hover:text-white focus-visible:outline-white"
            : on ? "bg-setu-tint font-semibold text-setu-ink" : "text-nav-text hover:bg-spotlight hover:text-ink",
        )}
      >
        <Icon aria-hidden className={clsx("shrink-0", i.sub ? "size-4" : "size-[18px]", dark && !on && "text-side-muted")} />
        <span className="min-w-0 truncate">{i.label}</span>
      </Link>
    );
  };

  const navGroups = (dark: boolean, onClick?: () => void) => (
    <div className="grid gap-5">
      {patientId && (
        <Link href={user.role === "desk" ? "/desk" : "/patients"} onClick={onClick} className={clsx("flex min-h-10 items-center gap-2 rounded-md px-3 text-[14px] font-medium", dark ? "text-side-text hover:bg-white/8 hover:text-white focus-visible:outline-white" : "text-setu-ink hover:bg-spotlight")}>
          <ArrowLeft aria-hidden className="size-4" />{user.role === "desk" ? "Back to the front desk" : "All patients"}
        </Link>
      )}
      {[...patientGroups, ...groups.filter((g) => !patientId || g.label === "Account")].map((g) => (
        <div key={g.label} className="grid gap-1">
          <p className={clsx("px-3 pb-1 text-[12px] font-semibold tracking-[0.02em]", dark ? "text-side-muted" : "text-faint")}>{g.label}</p>
          <ul className="grid gap-0.5">
            {g.items.map((i) => <li key={`${i.href}?${i.view ?? ""}`}>{link(i, dark, onClick)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );

  const account = (where: "sidebar" | "bar") => (
    <details className="group relative">
      <summary
        className={clsx(
          "flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-md text-left [&::-webkit-details-marker]:hidden",
          where === "sidebar" ? "w-full px-2 py-1.5 hover:bg-white/8 focus-visible:outline-white" : "px-1.5 hover:bg-spotlight",
        )}
      >
        <span className="sr-only">Account menu</span>
        <Avatar name={user.name} size="sm" />
        {where === "sidebar" && (
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-semibold text-white">{user.name}</span>
            <span className="truncate text-[13px] text-side-muted">{ROLE_LABEL[user.role]}</span>
          </span>
        )}
        <ChevronDown aria-hidden className={clsx("size-4 shrink-0", where === "sidebar" ? "rotate-180 text-side-muted group-open:rotate-0" : "text-nav-muted group-open:rotate-180")} />
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
        <button type="button" onClick={signOut} disabled={signingOut} className="flex min-h-11 items-center gap-2.5 px-4 text-left text-[15px] hover:bg-spotlight">
          <LogOut aria-hidden className="size-4 text-muted" />Sign out
        </button>
      </div>
    </details>
  );

  const demoPhone = demo && (
    <button
      type="button"
      onClick={() => setPhoneOpen(true)}
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md border border-setu/30 bg-setu-tint px-3 text-[13px] font-semibold whitespace-nowrap text-setu-ink hover:bg-setu-tint/70"
    >
      <Smartphone aria-hidden className="size-4" />
      <span className="max-sm:sr-only">Demo phone</span>
    </button>
  );

  return (
    <div className="ds-canvas relative min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-pine focus:px-4 focus:py-3 focus:text-white">
        Skip to content
      </a>

      {/* Desktop: a fixed deep-teal sidebar with the role's pages in groups; inside a record, the record's sections. */}
      <aside className="ds-side fixed inset-y-0 left-0 z-30 hidden w-64 flex-col lg:flex">
        <div className="px-4 pt-5 pb-3">
          <Link href={home} aria-label="OncoSetu home" className="flex min-h-11 items-center rounded-md px-1 focus-visible:outline-white">
            <Wordmark onDark />
          </Link>
          <p className="mt-1 truncate px-1 text-[13px] text-side-muted" title={user.orgName}>{user.orgName}</p>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pt-2 pb-4">{navGroups(true)}</nav>
        <div className="border-t border-white/10 p-3">{account("sidebar")}</div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Top bar: on desktop the breadcrumb and patient search; on tablets and phones the menu, the brand and the account. */}
        <header className="sticky top-0 z-30 border-b border-rule bg-surface/95 backdrop-blur-sm">
          <div className="flex h-14 items-center gap-2 px-2 sm:px-4 lg:h-16 lg:gap-4 lg:px-8">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className="grid size-11 shrink-0 place-items-center rounded-md text-ink hover:bg-spotlight lg:hidden">
              <Menu aria-hidden className="size-5" />
            </button>
            <Link href={home} aria-label="OncoSetu home" className="flex min-h-11 shrink-0 items-center rounded-md px-1 lg:hidden">
              <Wordmark />
            </Link>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
              <ol className="flex min-w-0 items-center gap-1.5 text-[15px] text-muted">
                {crumbs.map((c, k) => (
                  <li key={k} className="flex min-w-0 items-center gap-1.5">
                    {k > 0 && <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />}
                    {c.href ? <Link href={c.href} className="truncate hover:text-ink">{c.label}</Link> : <span className={clsx("truncate", k === crumbs.length - 1 && "font-medium text-ink")}>{c.label}</span>}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {SEARCH_ROLES.includes(user.role) && (
                <form role="search" onSubmit={search} className="relative hidden md:block">
                  <label htmlFor="top-search" className="sr-only">Find a patient</label>
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                  <input id="top-search" name="q" type="search" autoComplete="off" placeholder="Find a patient: name, phone, record code…" className="h-11 w-72 rounded-md border border-rule bg-gallery pr-3 pl-9 text-[15px] placeholder:text-placeholder hover:border-control/60 focus:border-setu-ink focus:bg-surface xl:w-96" />
                </form>
              )}
              {demo && <Badge tone="setu" className="max-md:hidden">Demo · synthetic data</Badge>}
              {demoPhone}
              <div className="lg:hidden">{account("bar")}</div>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-gallery flex-1 px-4 py-6 outline-none sm:px-8 sm:py-8">
          <SmsContext.Provider value={{ sms, demo }}>{children}</SmsContext.Provider>
        </main>

        <footer className="border-t border-rule">
          <p className="mx-auto max-w-gallery px-4 py-4 text-[13px] leading-relaxed text-faint sm:px-8">
            {demo && <Badge tone="setu" className="mr-2 align-[1px]">Demo · synthetic data</Badge>}
            {pathname === "/admin" || pathname.startsWith("/admin/")
              ? "OncoSetu is a records index, not a clinical tool · Every change made here is written to the activity log"
              : "A list of what is in the file, not a clinical summary · Every fact shown links to the exact words in the document"}
          </p>
        </footer>
      </div>

      <Dialog open={navOpen} onClose={() => setNavOpen(false)} placement="left" title={<Wordmark />} description={`${ROLE_LABEL[user.role]} · ${user.orgName}`}>
        <nav aria-label="Primary">{navGroups(false, () => setNavOpen(false))}</nav>
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
