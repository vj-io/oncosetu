"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, Compass, LogOut, Menu, Smartphone } from "lucide-react";
import { navFor, roleHome, type StaffRole } from "@/lib/staff-nav";
import { Avatar, Badge, Button, Dialog, EmptyState, Skeleton, Spotlight, Wordmark } from "@/components/ui";
import { Tour, startTour } from "./Tour";

export type { StaffRole };
const ROLE_LABEL: Record<StaffRole, string> = { desk: "Desk", records: "Records", clinician: "Clinician", org_admin: "Administrator", auditor: "Auditor" };

export type StaffShellProps = {
  user: { name: string; role: StaffRole; orgName: string };
  demo: boolean;
  children: ReactNode;
};

export function StaffShell({ user, demo, children }: StaffShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const nav = navFor(user.role);
  const home = roleHome(user.role);
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

  return (
    <div className="relative flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-obsidian focus:px-4 focus:py-3 focus:text-gallery">
        Skip to content
      </a>

      {demo && (
        <div className="relative z-40 bg-obsidian text-gallery">
          <div className="mx-auto flex min-h-11 max-w-gallery items-center justify-between gap-3 pl-4 sm:pl-8">
            <p className="font-mono text-[11px] tracking-[0.14em] uppercase">
              Demo · synthetic data
            </p>
            <button
              type="button"
              onClick={() => setPhoneOpen(true)}
              className="inline-flex h-11 shrink-0 items-center gap-2 border-l border-gallery/25 px-4 font-mono text-[11px] tracking-[0.14em] whitespace-nowrap uppercase hover:bg-label focus-visible:outline-gallery sm:px-6"
            >
              <Smartphone aria-hidden className="size-4" />
              Demo phone
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-rule bg-gallery/92 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-3 px-4 sm:px-8 lg:gap-8">
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className="-ml-2 grid size-11 shrink-0 place-items-center hover:bg-spotlight lg:hidden">
            <Menu aria-hidden className="size-5" />
          </button>
          <Link href={home} className="flex min-h-11 shrink-0 items-center gap-3">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    className={clsx(
                      "inline-flex h-11 items-center border-b-2 px-2.5 font-mono text-[12px] tracking-[0.12em] whitespace-nowrap uppercase transition-colors",
                      isActive(n.href) ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {(user.role === "clinician" || user.role === "records") && (
              // Hidden on phones by a wrapper: Button's own inline-flex beat a `hidden` class and pushed a 375 px page 165 px sideways.
              <span className="hidden md:inline-flex">
                <Button variant="secondary" size="md" onClick={startTour} icon={<Compass aria-hidden />}>
                  Take the 2-minute tour
                </Button>
              </span>
            )}
            <details className="group relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-2 hover:bg-spotlight [&::-webkit-details-marker]:hidden">
                <span className="sr-only">Your menu</span>
                <Avatar name={user.name} size="sm" />
                <span className="hidden text-left leading-tight whitespace-nowrap md:grid xl:max-2xl:hidden">
                  <span className="text-sm text-ink">{user.name}</span>
                  <span className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase" title={user.orgName}>{ROLE_LABEL[user.role]}</span>
                </span>
                <ChevronDown aria-hidden className="size-4 text-faint group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 z-50 mt-1 hidden w-64 border border-rule bg-matte py-1 shadow-frame group-open:grid">
                <p className="border-b border-rule px-4 py-2 text-sm"><span className="block text-ink">{user.name}</span><span className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">{ROLE_LABEL[user.role]} · {user.orgName}</span></p>
                {(user.role === "clinician" || user.role === "records") && (
                  <button type="button" onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); startTour(); }} className="flex min-h-11 items-center gap-2 px-4 text-left text-[15px] hover:bg-spotlight">
                    <Compass aria-hidden className="size-4" />Take the 2-minute tour
                  </button>
                )}
                <button type="button" onClick={signOut} disabled={signingOut} className="flex min-h-11 items-center gap-2 px-4 text-left text-[15px] hover:bg-spotlight">
                  <LogOut aria-hidden className="size-4" />Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="relative flex flex-1 flex-col">
        <Spotlight />
        <main id="main" tabIndex={-1} className="relative mx-auto w-full max-w-gallery flex-1 px-4 py-8 outline-none sm:px-8 sm:py-10">
          {children}
        </main>
      </div>

      <footer className="border-t border-rule">
        <p className="mx-auto max-w-gallery px-4 py-5 font-mono text-[11px] leading-relaxed tracking-[0.12em] text-faint uppercase sm:px-8">
          A list of what is in the file, not a clinical summary · Every fact shown links to the exact words in the document
        </p>
      </footer>

      <Dialog open={navOpen} onClose={() => setNavOpen(false)} placement="left" title={<Wordmark />} description={`${ROLE_LABEL[user.role]} · ${user.orgName}`}>
        <nav aria-label="Primary">
          <ul className="grid">
            {nav.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={clsx(
                    "flex h-12 items-center border-b border-rule border-l-2 pl-3 text-[17px]",
                    isActive(n.href) ? "border-l-ink text-ink" : "border-l-transparent text-muted hover:bg-spotlight hover:text-ink",
                  )}
                  onClick={() => setNavOpen(false)}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-8 flex items-center gap-3">
          <Avatar name={user.name} size="sm" />
          <div className="grid leading-tight">
            <span className="text-sm">{user.name}</span>
            <span className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">{ROLE_LABEL[user.role]}</span>
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
    <div className="mx-auto max-w-[22rem] rounded-[2rem] border-[10px] border-obsidian bg-gallery shadow-frame">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">Inbox</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] text-setu-ink uppercase">
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
                <span className="font-mono text-xs text-muted">{m.toMasked}</span>
                <Badge tone={m.delivery === "failed" ? "conflict" : m.delivery === "sent" ? "verified" : "neutral"}>
                  {m.delivery === "failed" && m.deliveryError ? `failed · ${m.deliveryError}` : m.delivery}
                </Badge>
                <time dateTime={m.createdAt} className="ml-auto font-mono text-[11px] text-faint">
                  {new Date(m.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>
              <p className="border border-rule bg-matte px-3 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {m.body.split(/(https?:\/\/\S+)/g).map((part, i) =>
                  i % 2 ? (
                    <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-setu-ink underline decoration-brass underline-offset-2">
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
