"use client";

import type { Lang } from "@/core/types";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Frame } from "@/components/ui";
import { dm } from "@/i18n/demo";
import { tp } from "@/i18n/patient";
import { DEMO_PEOPLE } from "@/lib/demo-people";
import { PPassword } from "./PPassword";
import { ErrorNote, PButton, PField, PInput } from "./ui";

const SEND_WINDOW_MS = 10 * 60_000; // the server allows 3 sends per phone per 10 minutes and answers the same every time
const SEND_MAX = 3;
const MAX_TRIES = 5; // the server locks the phone for 15 minutes after 5 wrong codes; its answers stay uniform

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * `after` is where a successful sign-in goes: /p, or the (server-validated) portal page the visitor came for.
 * `sms` false = no text message can reach anyone here: the code always comes from the front desk, so nothing is sent.
 * Opens on phone + password (signing in from home); a code (first time, forgotten password) is one link away. The desk
 * station opens on the code: it is at the clinic, where the desk gives one.
 */
export function LoginForm({ lang, demo, after, station = false, sms = true }: { lang: Lang; demo: boolean; after: string; station?: boolean; sms?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "phone" | "code">(station ? "phone" : "password");
  const [password, setPassword] = useState("");
  const [fromDesk, setFromDesk] = useState(!sms); // the code in hand came from the front desk, not an SMS
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // When this browser last asked for a code. The server never says whether it sent one (a stranger must not learn which numbers are registered), so the page keeps its own count.
  const [asked, setAsked] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
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

  /** Straight to the code box with a desk code: asking for an SMS would replace the desk code with a new one. */
  function takeDeskCode() {
    if (phone.replace(/\D/g, "").length < 10) return setError(tp(lang, "phoneInvalid"));
    setError(null);
    setCode("");
    setFromDesk(true);
    setStep("code");
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!sms) return takeDeskCode();
    if (phone.replace(/\D/g, "").length < 10) return setError(tp(lang, "phoneInvalid"));
    setFromDesk(false);
    const t = Date.now();
    const recent = asked.filter((x) => t - x < SEND_WINDOW_MS);
    if (recent.length >= SEND_MAX) { // the server would send nothing: say so, and when to try again
      setNow(t);
      setStep("code");
      return; // the line above the code box now says when a new one can be asked for
    }
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/patient/otp/start", { phone });
    setBusy(false);
    if (!res) return;
    if (!res.ok) return setError(tp(lang, "genericError"));
    setCode("");
    setAsked([...asked.filter((x) => t - x < SEND_WINDOW_MS), t]);
    setNow(t);
    setStep("code"); // always: the answer never says whether the number is known
  }

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) return setError(tp(lang, "phoneInvalid"));
    if (!password) return setError(tp(lang, "passwordWrong"));
    setBusy(true);
    setError(null);
    const res = await post("/api/auth/patient/password", station ? { phone, password, station } : { phone, password });
    if (!res) return setBusy(false);
    if (res.ok) {
      router.replace(after);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(tp(lang, res.status === 401 ? "passwordWrong" : res.status === 429 ? "passwordLocked" : "genericError"));
  }

  const toCode = () => { setStep("phone"); setError(null); setPassword(""); };
  const toPassword = () => { setStep("password"); setError(null); setCode(""); };
  const linkCls = "h-11 justify-self-start text-left text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4";

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
      <Frame className="px-5 py-6 sm:px-8 sm:py-8">
        {step === "password" ? (
          <form method="post" onSubmit={signInWithPassword} className="grid gap-5" noValidate data-testid="password-form">
            <PField label={tp(lang, "phoneLabel")} hint={tp(lang, "phoneHint")}>
              <PInput big type="tel" name="phone" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </PField>
            <PField label={tp(lang, "passwordLabel")}>
              <PPassword big name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} showLabel={tp(lang, "pwShow")} />
            </PField>
            {error && <ErrorNote>{error}</ErrorNote>}
            <PButton type="submit" big loading={busy} className="w-full">
              {tp(lang, "signIn")}
            </PButton>
            <button type="button" data-testid="use-code" onClick={toCode} className={linkCls}>{tp(lang, "useCodeLink")}</button>
          </form>
        ) : step === "phone" ? (
          <form method="post" onSubmit={sendCode} className="grid gap-5" noValidate>
            {!station && <p className="text-[16px] text-muted">{tp(lang, sms ? "loginIntro" : "loginIntroDesk")}</p>}
            <PField label={tp(lang, "phoneLabel")} hint={tp(lang, "phoneHint")}>
              <PInput big type="tel" name="phone" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </PField>
            {error && <ErrorNote>{error}</ErrorNote>}
            <PButton type="submit" big loading={busy} className="w-full">
              {tp(lang, sms ? "sendCode" : "next")}
            </PButton>
            {sms && (
              <button type="button" data-testid="have-desk-code" onClick={takeDeskCode} className={linkCls}>
                {tp(lang, "haveDeskCode")}
              </button>
            )}
            {!station && <button type="button" data-testid="use-password" onClick={toPassword} className={linkCls}>{tp(lang, "usePasswordLink")}</button>}
          </form>
        ) : (
          <form method="post" onSubmit={verify} className="grid gap-5" noValidate>
            <p role="status" className="text-[16px] text-muted">
              {tp(lang, fromDesk ? "deskCodeHelp" : "codeSent")}
            </p>
            {!fromDesk && asked.length > 0 && (() => {
              const last = asked[asked.length - 1];
              const recent = asked.filter((x) => now - x < SEND_WINDOW_MS);
              const limited = recent.length >= SEND_MAX;
              return <p role="status" data-testid="code-sent-at" className="text-[16px] text-muted">{limited ? tp(lang, "codeWaitMore", { time: clock(last), n: minutesLeft(recent[0] + SEND_WINDOW_MS - now) }) : tp(lang, "codeSentAt", { time: clock(last) })}</p>;
            })()}
            {!fromDesk && <p data-testid="code-not-arrived" className="text-[16px] text-muted">{tp(lang, "codeNotArrived")}</p>}
            <PField label={tp(lang, "codeLabel")} hint={tp(lang, fromDesk ? "deskCodeHint" : "codeHint")}>
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
              {sms && (
                <button type="button" onClick={() => sendCode()} disabled={busy} className="h-11 text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4 disabled:opacity-60">
                  {tp(lang, fromDesk ? "sendCode" : "resendCode")}
                </button>
              )}
              <button type="button" onClick={() => { setStep("phone"); setError(null); setTries(0); }} className="h-11 text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4">
                {tp(lang, "changeNumber")}
              </button>
            </div>
          </form>
        )}
      </Frame>

      {demo && (
        <section aria-labelledby="demo-accounts" data-testid="demo-accounts" className="grid gap-3 rounded-lg border border-rule bg-surface px-5 py-5 shadow-card">
          <h2 id="demo-accounts" className="text-lg">{dm(lang, "title")}</h2>
          <p className="text-[16px] text-muted">{dm(lang, "hint")}</p>
          <ul className="grid gap-2">
            {DEMO_PEOPLE.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => demoSignIn(p)} data-testid={`demo-${p.key}`} className="flex min-h-12 w-full items-center justify-between gap-3 border border-control bg-matte px-4 py-2 text-left text-[16px] hover:border-faint hover:bg-spotlight rounded-lg">
                  <span>{dm(lang, p.key)}</span>
                  <span className="shrink-0 text-base text-muted">{p.phone}</span>
                </button>
                {demoState?.key === p.key && <p role="status" className="mt-1 text-[16px] text-muted">{demoState.msg}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {demo && (
        <details className="border border-dashed border-control bg-alcove px-5 py-3 rounded-lg">
          <summary className="flex min-h-12 cursor-pointer items-center text-[16px] font-medium">{tp(lang, "demoSummary")}</summary>
          <p className="mt-2 text-[16px] text-muted">{tp(lang, "demoHelp")}</p>
          <PButton variant="secondary" className="mt-3" onClick={showDemo} loading={demoBusy} disabled={phone.replace(/\D/g, "").length < 10}>
            {tp(lang, "demoShow")}
          </PButton>
          {demoText && (
            <p role="status" className="mt-3 border border-rule bg-matte px-3 py-2 text-[16px] break-words rounded-lg">
              {demoText}
            </p>
          )}
        </details>
      )}
    </div>
  );
}
