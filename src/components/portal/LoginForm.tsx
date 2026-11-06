"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Frame } from "@/components/ui";
import { tp } from "@/i18n/patient";
import { ErrorNote, PButton, PField, PInput } from "./ui";

const MAX_TRIES = 5; // the server locks the phone for 15 minutes after 5 wrong codes; its answers stay uniform

/** `after` is where a successful sign-in goes: /p, or the (server-validated) portal page the visitor came for. */
export function LoginForm({ lang, demo, after }: { lang: "en" | "hi"; demo: boolean; after: string }) {
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
    const res = await post("/api/auth/patient/otp/verify", { phone, code });
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
