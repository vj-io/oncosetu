"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { roleHome } from "@/lib/staff-nav";
import { Avatar, Badge, Button, Field, Frame, Input, Placard, Spotlight, Wordmark } from "@/components/ui";

type DemoAccount = { role: string; name: string; email: string; password: string; totp: string };

const ROLE_LABEL: Record<string, string> = { desk: "Desk", records: "Records", clinician: "Clinician", org_admin: "Admin", auditor: "Audit" };

async function fetchDemoAccounts(): Promise<DemoAccount[] | null> {
  try {
    const res = await fetch("/api/auth/demo-accounts", { cache: "no-store" });
    if (res.status !== 200) return null;
    return ((await res.json()) as { accounts: DemoAccount[] }).accounts;
  } catch {
    return null;
  }
}

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  const [filling, setFilling] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchDemoAccounts().then((a) => a?.length && setAccounts(a));
  }, []);

  async function fill(account: DemoAccount) {
    // Fill at once, then refetch so the 6-digit code is current; the server still verifies it as TOTP.
    setEmail(account.email);
    setPassword(account.password);
    setTotp(account.totp);
    setError(null);
    setFilling(account.email);
    const fresh = (await fetchDemoAccounts())?.find((a) => a.email === account.email);
    if (fresh) setTotp(fresh.totp);
    setFilling(null);
    submitRef.current?.focus();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/staff/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, totp }),
      });
      if (res.ok) {
        // Each role starts on its own work list: a clinician on Patients, records staff on the records queue.
        const role = ((await res.json().catch(() => null)) as { staff?: { role?: string } } | null)?.staff?.role;
        router.push(roleHome(role));
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Sign-in failed. Check your details and try again.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Spotlight />
      <header className="relative border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="OncoSetu home">
            <Wordmark />
          </Link>
          <span className="hidden font-mono text-[11px] tracking-[0.16em] text-faint uppercase sm:inline">Staff sign-in</span>
          <Link href="/p/login" className="ml-auto inline-flex h-11 items-center font-mono text-[12px] tracking-[0.12em] text-muted uppercase hover:text-ink">
            Patient portal
          </Link>
        </div>
      </header>

      <main id="main" className="relative mx-auto grid w-full max-w-gallery flex-1 items-start gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-20 lg:py-20">
        <div>
          <p className="ds-kicker">Staff sign-in</p>
          <h1 className="mt-4 text-[2.25rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl">Sign in to the records desk.</h1>
          <p className="mt-4 text-muted">Email, password and the 6-digit code from your authenticator app.</p>

          <Frame animate className="mt-8 px-5 py-6 sm:px-8 sm:py-8">
            {/* method="post": a submit before hydration must never put the password in the URL (it did, as a GET). */}
            <form method="post" onSubmit={onSubmit} className="grid gap-5">
              <Field label="Email">
                <Input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password">
                <Input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Authenticator code" hint={filling ? "Fetching a fresh demo code…" : "6 digits, refreshes every 30 seconds."}>
                <Input
                  name="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="font-mono text-lg tracking-[0.4em]"
                />
              </Field>
              {error && (
                <p role="alert" className="flex items-start gap-2 border border-madder bg-madder-tint px-4 py-3 text-[15px] text-madder-ink">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              )}
              <Button ref={submitRef} type="submit" size="lg" loading={busy} disabled={Boolean(filling)} className="mt-1 w-full">
                Sign in
              </Button>
            </form>
          </Frame>
          <p className="mt-6 text-[15px] text-muted">
            Patient or family?{" "}
            <Link href="/p/login" className="text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">
              Sign in here
            </Link>
          </p>
          <p className="mt-2 text-[15px] text-muted">
            <Link href="/security" className="inline-flex min-h-11 items-center underline decoration-brass underline-offset-4 hover:decoration-ink">Security & compliance</Link>
          </p>
        </div>

        <aside aria-labelledby="demo-accounts" className="lg:pt-24">
          {accounts ? (
            <section className="ds-placard-in border border-rule bg-surface shadow-placard">
              <header className="border-b border-rule px-5 py-5 sm:px-6">
                <p className="ds-kicker">Demo accounts · synthetic organisation</p>
                <h2 id="demo-accounts" className="mt-2 text-xl tracking-[-0.02em]">
                  Choose a role to fill the form
                </h2>
                <p className="mt-1 text-sm text-muted">The code is fetched fresh and still checked by the server&rsquo;s TOTP verification.</p>
              </header>
              <ul>
                {accounts.map((a) => (
                  <li key={a.email} className="border-b border-rule last:border-b-0">
                    <button type="button" onClick={() => fill(a)} className="flex min-h-16 w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-spotlight sm:px-6">
                      <Avatar name={a.name} size="sm" />
                      <span className="grid min-w-0 flex-1">
                        <span className="text-[15px]">{a.name}</span>
                        <span className="truncate font-mono text-xs text-muted">{a.email}</span>
                      </span>
                      <Badge className="hidden min-[420px]:inline-flex">{ROLE_LABEL[a.role] ?? a.role}</Badge>
                      {filling === a.email ? <LoaderCircle aria-hidden className="ds-spin size-4" /> : <ArrowRight aria-hidden className="size-4 text-faint" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Placard
              animate
              titleAs="h2"
              kicker="Staff roles"
              title={<span id="demo-accounts">Five roles, one audit trail</span>}
              what="Desk · Records · Clinician · Admin · Audit"
              who="Each action stores actor, role and time in a hash-chained audit log"
              when="Sessions end after 12 hours, or 30 minutes idle on shared desk devices"
            />
          )}
        </aside>
      </main>

      <footer className="relative border-t border-rule">
        <p className="mx-auto max-w-gallery px-4 py-5 font-mono text-[11px] leading-relaxed tracking-[0.12em] text-faint uppercase sm:px-8">
          Document index, not a clinical summary · Every displayed fact links to a verbatim source quote
        </p>
      </footer>
    </div>
  );
}
