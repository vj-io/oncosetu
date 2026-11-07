"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CircleCheck } from "lucide-react";
import { formatDateIN, istDate } from "@/core/copy";
import { CONSENT_PURPOSES } from "@/core/types";
import type { ConsentPurposes } from "@/db/schema";
import { tp, type PatientKey } from "@/i18n/patient";
import { formatDateTimeIN } from "@/server/portal/summary";
import { ErrorNote, PButton } from "./ui";
import type { Lang } from "@/core/types";

type Purposes = ConsentPurposes;
type Caregiver = { id: string; name: string; relation: string; active: boolean };
export type ErasureStatus = { state: "queued" | "scheduled" | "completed"; eligibleAfter: string; completedAt: string | null };
const PURPOSES = CONSENT_PURPOSES;

/** Purpose toggles, one-tap withdrawal (FR-CON-04) and the caregiver list. Each change is one request; the server re-reads it on every use. */
export function ConsentPanel({
  lang, initial, caregivers, isPatient, lastUpdated, erasure: initialErasure,
}: {
  lang: Lang; initial: Purposes; caregivers: Caregiver[]; isPatient: boolean; lastUpdated: string | null; erasure: ErasureStatus | null;
}) {
  const router = useRouter();
  const [purposes, setPurposes] = useState<Purposes>(initial);
  const [cgs, setCgs] = useState(caregivers);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "withdrawn" | "removed"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(lastUpdated);
  const [erasure, setErasure] = useState(initialErasure);

  async function post(url: string, body?: unknown): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) { router.replace(`/p/login?lang=${lang}`); return false; }
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      return true;
    } catch {
      setError(tp(lang, "genericError"));
      return false;
    }
  }

  async function toggle(key: (typeof PURPOSES)[number], on: boolean) {
    // turning "keep my papers" off means there is nothing to keep: everything goes off, as with the withdraw button
    const next = key === "store" && !on ? { store: false, ai: false, share: false, abdm: false, metrics: false, team: false } : { ...purposes, [key]: on };
    const prev = purposes;
    setPurposes(next);
    setBusy(key);
    if (await post("/api/p/consent", { purposes: next, lang })) {
      setNote({ kind: "ok", text: tp(lang, "consentSaved") });
      setUpdated(formatDateTimeIN(new Date(), lang));
    } else setPurposes(prev);
    setBusy(null);
  }

  /** Withdrawal is always signed: the button takes the person to the signature step, which records the withdrawal and the signed PDF together. */
  function withdraw() {
    window.dispatchEvent(new CustomEvent("consent:sign-withdraw"));
    document.getElementById("sign-h")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** J8: only offered once permission is withdrawn. The server answers with the date the records become eligible for removal. */
  async function requestErasure() {
    setBusy("erasure");
    setError(null);
    try {
      const res = await fetch("/api/p/erasure", { method: "POST" });
      if (res.status === 401) { router.replace(`/p/login?next=/p/consent&lang=${lang}`); return; }
      if (!res.ok) throw new Error(String(res.status));
      setErasure((await res.json()) as ErasureStatus);
      setNote({ kind: "ok", text: tp(lang, "erasureDone") });
    } catch {
      setError(tp(lang, "genericError"));
    }
    setBusy(null);
  }

  async function revoke(id: string) {
    setBusy(id);
    if (await post(`/api/p/caregivers/${id}/revoke`)) {
      setCgs((x) => x.map((c) => (c.id === id ? { ...c, active: false } : c)));
      setNote({ kind: "removed", text: tp(lang, "cgRevoked") });
    }
    setBusy(null);
  }

  const none = !PURPOSES.some((p) => purposes[p]);

  return (
    <div className="mt-8 grid gap-10">
      <div role="status" aria-live="polite">
        {note && (
          <p className={clsx("flex items-start gap-2 border px-4 py-3 text-[17px]", note.kind === "withdrawn" ? "border-ink bg-alcove" : "border-sage bg-sage-tint text-sage-ink")}>
            <CircleCheck aria-hidden className="mt-1 size-5 shrink-0" />
            {note.text}
          </p>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <section className="grid gap-1">
        <ul className="divide-y divide-rule border border-rule bg-surface">
          {PURPOSES.map((key) => (
            <li key={key}>
              <label className="flex min-h-16 cursor-pointer items-center gap-4 px-4 py-4">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-[17px] leading-snug font-medium">{tp(lang, `p_${key}` as PatientKey)}</span>
                  <span className="text-[15px] text-muted">{tp(lang, `p_${key}_d` as PatientKey)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <span aria-hidden className="w-10 text-right text-[15px] text-muted">{tp(lang, purposes[key] ? "on" : "off")}</span>
                  <input
                    type="checkbox" role="switch" className="peer sr-only" checked={purposes[key]} disabled={busy !== null || (key !== "store" && !purposes.store)}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                  <span aria-hidden className={clsx(
                    "relative h-7 w-12 rounded-sm border border-ink transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:opacity-45",
                    purposes[key] ? "border-setu bg-setu" : "bg-matte",
                  )}>
                    <span className={clsx("absolute top-0.5 left-0.5 size-5 rounded-xs transition-transform duration-200", purposes[key] ? "translate-x-5 bg-matte" : "bg-ink")} />
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[15px] text-muted">{updated ? tp(lang, "consentLastUpdated", { date: updated }) : tp(lang, "consentNoneOnRecord")}</p>
      </section>

      <section aria-labelledby="wd" className="grid gap-3 border border-rule bg-surface px-5 py-5">
        <h2 id="wd" className="text-xl">{tp(lang, "withdrawTitle")}</h2>
        <p className="text-[17px] text-muted">{tp(lang, "withdrawText")}</p>
        <PButton variant="danger" big loading={busy === "withdraw"} disabled={none || busy !== null} onClick={withdraw} className="w-full sm:w-auto">
          {tp(lang, "withdrawButton")}
        </PButton>
      </section>

      {none && (
        <section aria-labelledby="er" className="grid gap-3 border border-rule bg-surface px-5 py-5">
          <h2 id="er" className="text-xl">{tp(lang, "erasureTitle")}</h2>
          {erasure ? (
            <>
              <p role="status" className="text-[17px]">
                {tp(lang, `erasure_${erasure.state}` as PatientKey, { date: formatDateIN(istDate(erasure.completedAt ?? erasure.eligibleAfter), lang) })}
              </p>
              {erasure.state !== "completed" && <p className="text-[15px] text-muted">{tp(lang, "erasureUndo")}</p>}
            </>
          ) : (
            <>
              <p className="text-[17px] text-muted">{tp(lang, "erasureText")}</p>
              <PButton variant="secondary" big loading={busy === "erasure"} disabled={busy !== null} onClick={requestErasure} className="w-full sm:w-auto">
                {tp(lang, "erasureButton")}
              </PButton>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="cg" className="grid gap-3">
        <h2 id="cg" className="text-xl">{tp(lang, "cgTitle")}</h2>
        <p className="text-[17px] text-muted">{tp(lang, "cgIntro")}</p>
        {cgs.length === 0 ? (
          <p className="text-muted">{tp(lang, "cgNone")}</p>
        ) : (
          <ul className="divide-y divide-rule border border-rule bg-surface">
            {cgs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid min-w-0 flex-1">
                  <span className="text-[17px]">{c.name}</span>
                  <span className="text-[15px] text-muted">{c.relation}</span>
                </span>
                {c.active ? (
                  isPatient && <PButton variant="secondary" loading={busy === c.id} disabled={busy !== null} onClick={() => revoke(c.id)}>{tp(lang, "cgRevoke")}</PButton>
                ) : (
                  <span className="text-[15px] text-muted">{tp(lang, "cgInactive")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!isPatient && <p className="text-[15px] text-muted">{tp(lang, "cgOnlyPatient")}</p>}
      </section>
    </div>
  );
}
