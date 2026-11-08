"use client";

import type { Lang } from "@/core/types";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tp } from "@/i18n/patient";
import { ErrorNote, PButton } from "./ui";

/** "My card is lost: stop it" (FR-ID-08), with one confirming tap: a stopped card cannot be switched back on. */
export function StopCard({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/p/card/revoke", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(tp(lang, "genericError"));
      setBusy(false);
    }
  }

  if (!asking) return <PButton variant="secondary" onClick={() => setAsking(true)} className="w-full sm:w-auto">{tp(lang, "cardLostButton")}</PButton>;
  return (
    <div className="grid gap-3">
      <p className="text-[17px] font-medium">{tp(lang, "cardLostConfirm")}</p>
      <div className="flex flex-wrap gap-3">
        <PButton loading={busy} onClick={stop}>{tp(lang, "cardLostYes")}</PButton>
        <PButton variant="ghost" disabled={busy} onClick={() => setAsking(false)}>{tp(lang, "cardLostCancel")}</PButton>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
