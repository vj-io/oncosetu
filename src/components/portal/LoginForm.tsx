"use client";

import type { Lang } from "@/core/types";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Frame } from "@/components/ui";
import { dm } from "@/i18n/demo";
import { tp } from "@/i18n/patient";
import { DEMO_PEOPLE } from "@/lib/demo-people";
import { ErrorNote, PButton, PField, PInput } from "./ui";

const MAX_TRIES = 5; // the server locks the phone for 15 minutes after 5 wrong codes; its answers stay uniform

/** `after` is where a successful sign-in goes: /p, or the (server-validated) portal page the visitor came for. */
export function LoginForm({ lang, demo, after, station = false }: { lang: Lang; demo: boolean; after: string; station?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [demoText, setDemoText] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  async function post(url: string, body: unknown) {
    try {
      return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError(tp(lang, "offlineError"));
      return null;
    }
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) return setError(tp(lang, "phoneInvalid"));
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/patient/otp/start", { phone });
    setBusy(false);
    if (!res) return;
    if (!res.ok) return setError(tp(lang, "genericError"));
    setCode("");
    setStep("code"); // always: the answer never says whether the number is known
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (tries >= MAX_TRIES) return setError(tp(lang, "tooManyTries"));
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/patient/otp/verify", station ? { phone, code, station } : { phone, code });
    if (!res) return setBusy(false);
    if (res.ok) {
      router.replace(after); // no ?lang= unless chosen: the patient's own language applies after sign-in
      router.refresh();
      return;
    }
    setBusy(false);
    if (res.status === 401) {
      const n = tries + 1;
      setTries(n);
      setError(tp(lang, n >= MAX_TRIES ? "tooManyTries" : "codeInvalid"));
    } else setError(tp(lang, "genericError"));
  }

  const [demoState, setDemoState] = useState<{ key: string; msg: string } | null>(null);

  /** Demo button: fills the phone, asks for a demo code, reads it from the simulated SMS outbox and fills the six digits. The person presses Sign in. */
  async function demoSignIn(p: (typeof DEMO_PEOPLE)[number]) {
    setError(null);
    setPhone(p.phone);
    setCode("");
    setStep("phone");
    setDemoState({ key: p.key, msg: dm(lang, "working") });
    const res = await post("/api/auth/patient/demo-code", { phone: p.phone });
    if (!res || !res.ok) { setDemoState({ key: p.key, msg: res?.status === 429 ? dm(lang, "tooMany") : dm(lang, "failed") }); return; }
    let digits = "";
    for (let i = 0; i < 8 && !digits; i++) {
      const r = await fetch(`/api/demo/outbox?phone=${encodeURIComponent(p.phone)}`, { cache: "no-store" }).catch(() => null);
      const body = (await r?.json().catch(() => null)) as { messages?: { body: string; templateKey: string }[] } | null;
      for (const m of body?.messages ?? []) {
        const hit = m.templateKey === "auth.otp" ? /[0-9]{6}/.exec(m.body) : null;
        if (hit) { digits = hit[0]; break; }
      }
      if (!digits) await new Promise((ok) => setTimeout(ok, 300));
    }
    if (!digits) { setDemoState({ key: p.key, msg: dm(lang, "failed") }); return; }
    setStep("code");
    setCode(digits);
    setDemoState({ key: p.key, msg: dm(lang, "filled") });
  }

  async function showDemo() {
    setDemoBusy(true);
    setDemoText(null);
    try {
      const res = await fetch(`/api/demo/outbox?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
      const body = (await res.json()) as { messages?: { body: string }[] };
      setDemoText(body.messages?.[0]?.body ?? tp(lang, "demoNone"));
    } catch {
      setDemoText(tp(lang, "offlineError"));
    }
    setDemoBusy(false);
  }

  return (
    <div className="mt-8 grid gap-6">
      {demo && (
        <section aria-labelledby="demo-accounts" data-testid="demo-accounts" className="grid gap-3 border border-rule bg-surface px-5 py-5">
          <h2 id="demo-accounts" className="text-lg">{dm(lang, "title")}</h2>
          <p className="text-[15px] text-muted">{dm(lang, "hint")}</p>
          <ul className="grid gap-2">
            {DEMO_PEOPLE.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => demoSignIn(p)} data-testid={`demo-${p.key}`} className="flex min-h-12 w-full items-center justify-between gap-3 border border-control bg-matte px-4 py-2 text-left text-[15px] hover:border-ink hover:bg-spotlight">
                  <span>{dm(lang, p.key)}</span>
                  <span className="shrink-0 font-mono text-[12px] text-muted">{p.phone}</span>
                </button>
                {demoState?.key === p.key && <p role="status" className="mt-1 text-[15px] text-muted">{demoState.msg}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Frame className="px-5 py-6 sm:px-8 sm:py-8">
        {step === "phone" ? (
          <form method="post" onSubmit={sendCode} className="grid gap-5" noValidate>
            <PField label={tp(lang, "phoneLabel")} hint={tp(lang, "phoneHint")}>
              <PInput big type="tel" name="phone" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </PField>
            {error && <ErrorNote>{error}</ErrorNote>}
            <PButton type="submit" big loading={busy} className="w-full">
              {tp(lang, "sendCode")}
            </PButton>
          </form>
        ) : (
          <form method="post" onSubmit={verify} className="grid gap-5" noValidate>
            <p role="status" className="text-[15px] text-muted">
              {tp(lang, "codeSent")}
            </p>
            <p data-testid="code-not-arrived" className="text-[15px] text-muted">{tp(lang, "codeNotArrived")}</p>
            <PField label={tp(lang, "codeLabel")} hint={tp(lang, "codeHint")}>
              <PInput
                big
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="font-mono tracking-[0.4em]"
              />
            </PField>
            {error && <ErrorNote>{error}</ErrorNote>}
            <PButton type="submit" big loading={busy} disabled={code.length !== 6 || tries >= MAX_TRIES} className="w-full">
              {tp(lang, "signIn")}
            </PButton>
            <div className="flex flex-wrap gap-x-6">
              <button type="button" onClick={() => sendCode()} disabled={busy} className="h-11 text-[15px] underline underline-offset-4 disabled:opacity-60">
                {tp(lang, "resendCode")}
              </button>
              <button type="button" onClick={() => { setStep("phone"); setError(null); setTries(0); }} className="h-11 text-[15px] underline underline-offset-4">
                {tp(lang, "changeNumber")}
              </button>
            </div>
          </form>
        )}
      </Frame>

      {demo && (
        <details className="border border-dashed border-control bg-alcove px-5 py-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-[15px] font-medium">{tp(lang, "demoSummary")}</summary>
          <p className="mt-2 text-sm text-muted">{tp(lang, "demoHelp")}</p>
          <PButton variant="secondary" className="mt-3" onClick={showDemo} loading={demoBusy} disabled={phone.replace(/\D/g, "").length < 10}>
            {tp(lang, "demoShow")}
          </PButton>
          {demoText && (
            <p role="status" className="mt-3 border border-rule bg-matte px-3 py-2 font-mono text-[15px] break-words">
              {demoText}
            </p>
          )}
        </details>
      )}
    </div>
  );
}
