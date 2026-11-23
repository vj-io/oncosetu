"use client";

import type { Lang } from "@/core/types";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Frame } from "@/components/ui";
import { tp, type PatientKey } from "@/i18n/patient";
import { PPassword } from "./PPassword";
import { ErrorNote, PButton, PField } from "./ui";

const PROBLEM: Record<string, PatientKey> = { too_short: "pwShort", too_long: "pwShort", is_phone: "pwIsPhone", too_simple: "pwSimple" };

/** Choose or replace the portal password (POST /api/p/password). The server checks the rules again. */
export function PasswordForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError(tp(lang, "pwShort"));
    if (pw !== again) return setError(tp(lang, "pwMismatch"));
    setBusy(true);
    const res = await fetch("/api/p/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) }).catch(() => null);
    setBusy(false);
    if (!res) return setError(tp(lang, "offlineError"));
    if (res.ok) {
      setPw(""); setAgain(""); setSaved(true);
      router.refresh();
      return;
    }
    const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? "";
    setError(tp(lang, PROBLEM[code] ?? "genericError"));
  }

  return (
    <Frame className="mt-6 px-5 py-6 sm:px-8 sm:py-8">
      <form method="post" onSubmit={save} className="grid gap-5" noValidate>
        <PField label={tp(lang, "pwNew")}>
          <PPassword name="new-password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setSaved(false); }} showLabel={tp(lang, "pwShow")} />
        </PField>
        <PField label={tp(lang, "pwConfirm")}>
          <PPassword name="confirm-password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setSaved(false); }} showLabel={tp(lang, "pwShow")} />
        </PField>
        {error && <ErrorNote>{error}</ErrorNote>}
        {saved && <p role="status" data-testid="pw-saved" className="rounded-lg border border-sage/40 bg-sage-tint px-4 py-3 text-[16px] text-sage-ink">{tp(lang, "pwSaved")}</p>}
        <PButton type="submit" big loading={busy} className="w-full sm:w-auto">{tp(lang, "pwSave")}</PButton>
      </form>
    </Frame>
  );
}
