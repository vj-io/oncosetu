"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { confirmProblem } from "@/components/account/ChangePassword";
import { Button, Field, Frame, Input, PasswordInput } from "@/components/ui";
import { AuthShell } from "@/components/shell/AuthShell";

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
    <AuthShell headline="Set a new password with your authenticator app." points={["No email link to wait for: the 6-digit code proves it is you", "You are signed out everywhere once it is changed", "Lost the app too? Your administrator resets it first"]}>
          <Frame animate className="px-6 py-7 sm:px-8 sm:py-8">
          <h1 className="text-[1.75rem] leading-tight tracking-[-0.02em]">Forgot your password?</h1>
          <p className="mt-2 mb-6 text-[15px] text-muted">Set a new one with your email and the 6-digit code from your authenticator app.</p>
            {done ? (
              <div role="status" className="grid gap-4">
                <p className="flex items-start gap-2 text-[15px]">
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-ink" />
                  Your password is changed, and you are signed out everywhere.
                </p>
                <p className="text-[15px] text-muted">Wait until your app shows a new code, then sign in with the new password.</p>
                <Link href="/login" className="text-ink underline decoration-link underline-offset-4 hover:decoration-ink">Go to sign-in</Link>
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
                  <PasswordInput name="new-password" autoComplete="new-password" minLength={MIN} required value={next} onChange={(e) => setNext(e.target.value)} />
                </Field>
                <Field label="New password again" error={mismatch}>
                  <PasswordInput name="new-password-again" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
                </Field>
                {error && (
                  <p role="alert" className="flex items-start gap-2 border border-madder/40 bg-madder-tint px-4 py-3 text-[15px] text-madder-ink rounded-lg">
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
            <Link href="/login" className="inline-flex min-h-11 items-center text-ink underline decoration-link underline-offset-4 hover:decoration-ink">Back to sign-in</Link>
          </p>
    </AuthShell>
  );
}
