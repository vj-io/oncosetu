"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { confirmProblem } from "@/components/account/ChangePassword";
import { Button, Field, Frame, Input, Spotlight, Wordmark } from "@/components/ui";

const MIN = 12; // MIN_PASSWORD, src/server/own-password.ts

/** Forgotten password: the authenticator code proves who you are (src/server/forgot-password.ts). */
export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [totp, setTotp] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = confirmProblem(next, again);
  const ready = !!email && totp.length === 6 && next.length >= MIN && next === again;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/staff/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, totp, next }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setTotp("");
      setError(body?.error?.message ?? "The password could not be changed. Check your details and try again.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Spotlight />
      <header className="relative border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="OncoSetu home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main id="main" className="relative mx-auto w-full max-w-gallery flex-1 px-4 py-12 sm:px-8 lg:py-20">
        <div className="max-w-md">
          <h1 className="text-[2.25rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl">Forgot your password?</h1>
          <p className="mt-4 text-muted">Set a new one with your email and the 6-digit code from your authenticator app.</p>

          <Frame animate className="mt-8 px-5 py-6 sm:px-8 sm:py-8">
            {done ? (
              <div role="status" className="grid gap-4">
                <p className="flex items-start gap-2 text-[15px]">
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-ink" />
                  Your password is changed, and you are signed out everywhere.
                </p>
                <p className="text-[15px] text-muted">Wait until your app shows a new code, then sign in with the new password.</p>
                <Link href="/login" className="text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">Go to sign-in</Link>
              </div>
            ) : (
              <form method="post" onSubmit={onSubmit} className="grid gap-5">
                <Field label="Email">
                  <Input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Authenticator code" hint="6 digits from the app you scanned when your account was made.">
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
                <Field label="New password" hint={`At least ${MIN} characters. A short sentence you can remember is easiest.`}>
                  <Input type="password" name="new-password" autoComplete="new-password" minLength={MIN} required value={next} onChange={(e) => setNext(e.target.value)} />
                </Field>
                <Field label="New password again" error={mismatch}>
                  <Input type="password" name="new-password-again" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
                </Field>
                {error && (
                  <p role="alert" className="flex items-start gap-2 border border-madder bg-madder-tint px-4 py-3 text-[15px] text-madder-ink">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" loading={busy} disabled={!ready} className="mt-1 w-full">
                  Set new password
                </Button>
              </form>
            )}
          </Frame>
          <p className="mt-6 text-[15px] text-muted">
            Lost your phone or authenticator app too? Ask your administrator: they reset the authenticator first.
          </p>
          <p className="mt-2 text-[15px]">
            <Link href="/login" className="inline-flex min-h-11 items-center text-ink underline decoration-brass underline-offset-4 hover:decoration-ink">Back to sign-in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
