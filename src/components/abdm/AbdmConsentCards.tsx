"use client";

// /p/abdm: the patient's (or acting caregiver's) answer to each ABDM consent request — the in-process stand-in for the
// ABHA app. Neutral copy from src/i18n/abdm.ts only.
import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CircleCheck } from "lucide-react";
import { formatDateIN } from "@/core/copy";
import { ta, typeList, type AbdmKey } from "@/i18n/abdm";
import type { PatientAbdmRequest } from "@/server/abdm/flow";
import { ErrorNote, PButton } from "@/components/portal/ui";

const STATE: Record<string, AbdmKey> = {
  REQUESTED: "stateRequested", GRANTED: "stateGranted", DENIED: "stateDenied", REVOKED: "stateRevoked", EXPIRED: "stateExpired",
};

export function AbdmConsentCards({ lang, requests }: { lang: "en" | "hi"; requests: PatientAbdmRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const d = (iso: string) => formatDateIN(iso, lang);

  async function answer(id: string, decision: "approve" | "deny" | "revoke") {
    setBusy(`${id}:${decision}`); setError(null); setSaved(null);
    try {
      const res = await fetch(`/api/p/abdm/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      if (res.status === 401) { router.replace(`/p/login?lang=${lang}&next=/p/abdm`); return; }
      if (!res.ok) throw new Error(String(res.status));
      setSaved(ta(lang, decision === "approve" ? "savedApproved" : decision === "deny" ? "savedDenied" : "savedRevoked"));
      setConfirm(null);
      router.refresh();
    } catch {
      setError(ta(lang, "error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 grid gap-4">
      {saved && (
        <p role="status" className="flex items-start gap-2 border border-sage bg-sage-tint px-4 py-3 text-[15px] text-sage-ink">
          <CircleCheck aria-hidden className="mt-1 size-4 shrink-0" />{saved}
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!requests.length && <p className="border border-dashed border-control bg-gallery p-5 text-muted">{ta(lang, "none")}</p>}
      {requests.map((r) => (
        <article key={r.id} data-testid="abdm-consent" className={clsx("grid gap-3 border bg-surface p-5", r.state === "REQUESTED" ? "border-ink shadow-placard" : "border-rule")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl leading-snug">{r.state === "REQUESTED" ? ta(lang, "askTitle") : ta(lang, STATE[r.state])}</h2>
            <span className="text-sm text-faint">{ta(lang, "askedOn", { date: d(r.createdAt) })}</span>
          </div>
          <p>{ta(lang, "asksFor", { types: typeList(lang, r.hiTypes) })}</p>
          <p className="text-muted">{ta(lang, "dates", { from: d(r.from), to: d(r.to) })}</p>
          {r.state === "REQUESTED" && (
            <>
              <p className="text-muted">{ta(lang, "keptUntil", { date: d(r.eraseAt) })}</p>
              <div className="flex flex-wrap gap-3">
                <PButton loading={busy === `${r.id}:approve`} disabled={!!busy} onClick={() => answer(r.id, "approve")}>{ta(lang, "approve")}</PButton>
                <PButton variant="secondary" loading={busy === `${r.id}:deny`} disabled={!!busy} onClick={() => answer(r.id, "deny")}>{ta(lang, "deny")}</PButton>
              </div>
            </>
          )}
          {r.state === "GRANTED" && (
            <>
              <p className="text-muted">{ta(lang, "approvedOn", { date: d(r.decidedAt ?? r.createdAt), count: r.documents, until: d(r.eraseAt) })}</p>
              {confirm === r.id ? (
                <div className="grid gap-3 border border-madder bg-madder-tint p-4">
                  <p className="text-madder-ink">{ta(lang, "revokeConfirm")}</p>
                  <div className="flex flex-wrap gap-3">
                    <PButton variant="danger" loading={busy === `${r.id}:revoke`} onClick={() => answer(r.id, "revoke")}>{ta(lang, "yesRemove")}</PButton>
                    <PButton variant="ghost" onClick={() => setConfirm(null)}>{ta(lang, "cancel")}</PButton>
                  </div>
                </div>
              ) : (
                <div><PButton variant="secondary" onClick={() => setConfirm(r.id)}>{ta(lang, "revoke")}</PButton></div>
              )}
            </>
          )}
        </article>
      ))}
    </div>
  );
}
