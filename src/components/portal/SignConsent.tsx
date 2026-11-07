"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FileText } from "lucide-react";
import { SignaturePad } from "@/components/consent/SignaturePad";
import type { Lang } from "@/core/types";
import type { ConsentPurposes } from "@/db/schema";
import { tp } from "@/i18n/patient";
import { tv } from "@/i18n/privacy";
import { ErrorNote, PButton, PField, PInput } from "./ui";

export type SignedItem = { id: string; action: string; signer: string | null; signedAt: string; dateText: string };

/** Sign the consent form in the portal: draw a signature or type the name. The signed PDF is kept with the documents. */
export function SignConsent({ lang, purposes, relation, defaultName, signed }: {
  lang: Lang; purposes: ConsentPurposes; relation: "self" | "guardian" | "caregiver"; defaultName: string; signed: SignedItem[]
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"drawn" | "typed">("drawn");
  const [name, setName] = useState(defaultName);
  const [png, setPng] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sign" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const none = !purposes.store;
  const [withdrawMode, setWithdrawMode] = useState(false);
  useEffect(() => {
    const on = () => setWithdrawMode(true); // the Withdraw button above leads here
    window.addEventListener("consent:sign-withdraw", on);
    return () => window.removeEventListener("consent:sign-withdraw", on);
  }, []);

  async function sign(withdraw: boolean) {
    setBusy(withdraw ? "withdraw" : "sign"); setError(null); setDone(false);
    try {
      const res = await fetch("/api/p/consent/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signerName: name, method: mode, signature: mode === "drawn" ? png ?? undefined : undefined, withdraw, purposes: { ...purposes, team: !!purposes.team }, lang }),
      });
      if (res.status === 401) { router.replace(`/p/login?lang=${lang}`); return; }
      if (!res.ok) throw new Error(String(res.status));
      setDone(true); setPng(null);
      router.refresh();
    } catch {
      setError(tp(lang, "genericError"));
    }
    setBusy(null);
  }

  const ready = name.trim().length >= 2 && (mode === "typed" || !!png);
  return (
    <section aria-labelledby="sign-h" className="grid gap-4 border border-rule bg-surface px-5 py-5" data-testid="sign-consent">
      <h2 id="sign-h" className="text-xl">{tv(lang, "signTitle")}</h2>
      <p className="text-[17px] text-muted">{tv(lang, "signIntro")}</p>
      {withdrawMode && <p role="status" data-testid="withdraw-banner" className="border border-madder bg-madder-tint px-4 py-3 text-[17px] text-madder-ink">{tv(lang, "signWithdrawBanner")}</p>}
      <p className="text-[15px]">{tv(lang, "signAs", { who: tv(lang, `who_${relation}` as "who_self") })}</p>
      <PField label={tv(lang, "signName")}>
        <PInput big value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="sign-name" />
      </PField>
      <div role="group" aria-label={tv(lang, "signTitle")} className="flex flex-wrap gap-2">
        {(["drawn", "typed"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-11 border px-4 text-[15px] ${mode === m ? "border-ink bg-ink text-gallery" : "border-control"}`}>
            {tv(lang, m === "drawn" ? "signDraw" : "signType")}
          </button>
        ))}
      </div>
      {mode === "drawn"
        ? <SignaturePad onChange={setPng} clearLabel={tv(lang, "signClear")} hint={tv(lang, "signHint")} />
        : <p className="border border-dashed border-control px-4 py-6 font-serif text-2xl italic">{name || " "}<span className="mt-2 block font-sans text-[15px] text-muted not-italic">{tv(lang, "signTyped")}</span></p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <p role="status" className="flex items-start gap-2 border border-sage bg-sage-tint px-4 py-3 text-sage-ink"><CircleCheck aria-hidden className="mt-1 size-5 shrink-0" />{tv(lang, "signDone")}</p>}
      <div className="flex flex-wrap gap-3">
        {!withdrawMode && <PButton big loading={busy === "sign"} disabled={!ready || busy !== null || none} onClick={() => sign(false)} data-testid="sign-save">{tv(lang, "signButton")}</PButton>}
        <PButton big variant={withdrawMode ? "danger" : "secondary"} loading={busy === "withdraw"} disabled={!ready || busy !== null} onClick={() => sign(true)} data-testid="sign-withdraw">{tv(lang, "signWithdrawButton")}</PButton>
      </div>
      <div>
        <h3 className="text-lg">{tv(lang, "signedList")}</h3>
        {signed.length === 0 ? <p className="mt-1 text-muted">{tv(lang, "signedNone")}</p> : (
          <ul className="mt-2 divide-y divide-rule border border-rule" data-testid="signed-list">
            {signed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <FileText aria-hidden className="size-4 text-faint" />
                <span className="min-w-0 flex-1 text-[15px]">{tv(lang, s.action === "withdraw" ? "signedWithdraw" : "signedGrant")} · {tv(lang, "signedBy", { name: s.signer ?? "—", date: s.dateText })}</span>
                <a href={`/api/signed-consents/${s.id}/pdf`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center underline underline-offset-4">{tv(lang, "viewPdf")}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
