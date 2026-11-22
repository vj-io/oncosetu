"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { roleHome } from "@/lib/staff-nav";
import { Avatar, Badge, Button, Field, Input, PasswordInput } from "@/components/ui";
import { AuthShell } from "@/components/shell/AuthShell";

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
    <AuthShell
      headline="Every paper in one list, with its source words."
      points={["Today’s patients, the papers that arrived, and the ones still missing", "Email, password and a code from your authenticator app", "Every record you open is written to the activity log"]}
      footer={<Link href="/p/login" className="inline-flex h-11 items-center rounded-md px-3 text-[15px] font-medium text-nav-text hover:bg-surface hover:text-ink">Patient portal</Link>}
    >
      <div className="rounded-xl border border-rule bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-[1.75rem] leading-tight tracking-[-0.02em]">Hospital staff sign-in</h1>
        <p className="mt-2 text-[15px] text-muted">Use your email, your password and the 6-digit code from your authenticator app.</p>
        {accounts && (
          <p className="mt-2 text-[15px] lg:hidden">
            <a href="#demo-accounts" className="text-setu-ink underline decoration-link underline-offset-4 hover:decoration-setu-ink">Trying the demo? Pick a demo role ↓</a>
          </p>
        )}
        {/* method="post": a submit before hydration must never put the password in the URL (it did, as a GET). */}
        <form method="post" onSubmit={onSubmit} className="mt-6 grid gap-5">
          <Field label="Email">
            <Input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="relative">
            <Field label="Password">
              <PasswordInput name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Link href="/login/reset" className="absolute -top-1.5 right-0 inline-flex min-h-8 items-center rounded-md px-1 text-sm font-medium text-setu-ink underline decoration-link underline-offset-4 hover:decoration-setu-ink">Forgot your password?</Link>
          </div>
          <Field label="Authenticator code" hint={filling ? "Getting a fresh code…" : "6 digits. The app shows a new one every 30 seconds."}>
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
            <p role="alert" className="flex items-start gap-2 rounded-md border border-madder/30 bg-madder-tint px-4 py-3 text-[15px] text-madder-ink">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <Button ref={submitRef} type="submit" size="lg" loading={busy} disabled={Boolean(filling)} className="mt-1 w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-5 text-[15px] text-muted">
          Patient or family?{" "}
          <Link href="/p/login" className="font-medium text-setu-ink underline decoration-link underline-offset-4 hover:decoration-setu-ink">Sign in with your phone</Link>
          <span aria-hidden> · </span>
          <Link href="/security" className="inline-flex min-h-11 items-center text-ink underline decoration-link underline-offset-4 hover:decoration-ink">Security & compliance</Link>
        </p>
      </div>

      {accounts ? (
        <section aria-labelledby="demo-accounts" className="ds-placard-in mt-5 overflow-hidden rounded-xl border border-rule bg-surface shadow-card">
          <header className="px-5 pt-5 pb-3 sm:px-6">
            <Badge tone="setu">Demo only · made-up hospital</Badge>
            <h2 id="demo-accounts" className="mt-3 text-lg">Pick a role to fill in the form</h2>
            <p className="mt-1 text-sm text-muted">The code is still checked by the server, as it would be for real staff.</p>
          </header>
          <ul className="divide-y divide-rule border-t border-rule">
            {accounts.map((a) => (
              <li key={a.email}>
                <button type="button" onClick={() => fill(a)} className="flex min-h-16 w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-spotlight sm:px-6">
                  <Avatar name={a.name} size="sm" />
                  <span className="grid min-w-0 flex-1">
                    <span className="text-[15px] font-semibold">{a.name}</span>
                    <span className="truncate text-[13px] text-muted">{a.email}</span>
                  </span>
                  <span className="hidden min-[420px]:inline-flex"><Badge>{ROLE_LABEL[a.role] ?? a.role}</Badge></span>
                  {filling === a.email ? <LoaderCircle aria-hidden className="ds-spin size-4" /> : <ArrowRight aria-hidden className="size-4 text-faint" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AuthShell>
  );
}
