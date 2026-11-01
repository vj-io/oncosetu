"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tp, type PatientKey } from "@/i18n/patient";
import { DISPUTE_REASONS, type DisputeReason } from "@/server/portal/dispute-reasons";
import { ErrorNote, PButton } from "./ui";

/** J7: "Something wrong with this?" on one document. A reason code only (no free text); the records team sees the item as disputed. */
export function DisputeDocument({ lang, documentId, flagged }: { lang: "en" | "hi"; documentId: string; flagged: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (flagged) return <p role="status" className="text-[15px] text-muted">{tp(lang, "disputeFlagged")}</p>;

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/p/documents/${documentId}/dispute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      if (res.status === 401) { router.replace(`/p/login?next=/p&lang=${lang}`); return; }
      if (!res.ok) throw new Error(String(res.status));
      router.refresh(); // the list comes back with this paper marked
    } catch {
      setError(tp(lang, "genericError"));
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-4">
        {tp(lang, "disputeButton")}
      </button>
    );
  }
  return (
    <fieldset className="grid gap-1 border-t border-rule pt-3">
      <legend className="text-[17px] font-medium">{tp(lang, "disputeTitle")}</legend>
      {DISPUTE_REASONS.map((r) => (
        <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-[17px]">
          <input type="radio" name={`dispute-${documentId}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 accent-[var(--color-ink)]" />
          {tp(lang, `dispute_${r}` as PatientKey)}
        </label>
      ))}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap gap-3 pt-2">
        <PButton loading={busy} disabled={!reason} onClick={send}>{tp(lang, "disputeSend")}</PButton>
        <PButton variant="secondary" disabled={busy} onClick={() => { setOpen(false); setReason(null); setError(null); }}>{tp(lang, "cancel")}</PButton>
      </div>
    </fieldset>
  );
}
