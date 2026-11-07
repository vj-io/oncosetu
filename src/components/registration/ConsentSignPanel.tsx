"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { SignaturePad } from "@/components/consent/SignaturePad";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import type { Lang } from "@/core/types";
import { postJson } from "./api";
import { Notice } from "./Notice";

export type SignedRowView = { id: string; action: string; signer: string | null; relation: string; method: string; signedAt: string };

const RELATION = { self: "The patient", guardian: "Parent or legal guardian", caregiver: "Caregiver" } as const;

/** Desk: the patient, guardian or caregiver signs the consent form on screen with the desk staff member as witness. Draft form. */
export function ConsentSignPanel({ patientId, language, minor, hasConsent, withdrawn, defaultName, signed }: {
  patientId: string; language: Lang; minor: boolean; hasConsent: boolean; withdrawn: boolean; defaultName: string; signed: SignedRowView[]
}) {
  const router = useRouter();
  const [relation, setRelation] = useState<keyof typeof RELATION>(minor ? "guardian" : "self");
  const [name, setName] = useState(minor ? "" : defaultName);
  const [mode, setMode] = useState<"drawn" | "typed">("drawn");
  const [png, setPng] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const withdraw = withdrawn && !hasConsent;
  const ready = name.trim().length >= 2 && (mode === "typed" || !!png) && (hasConsent || withdraw);

  async function sign() {
    setBusy(true); setError(null); setDone(false);
    const r = await postJson(`/api/patients/${patientId}/consent/sign`, { signerName: name, relation, method: mode, signature: mode === "drawn" ? png ?? undefined : undefined, withdraw, lang: language });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDone(true); setPng(null);
    router.refresh();
  }

  return (
    <div className="grid max-w-2xl gap-4" data-testid="desk-sign">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="unverified">Draft form, legal review pending</Badge>
        <span className="text-sm text-muted">Signed with you as the witness. The signed PDF is kept with this patient’s documents.</span>
      </div>
      {!hasConsent && !withdraw && <Notice tone="unverified" title="Record the consent first">Use the consent steps above (code or witnessed check), then the signed form can be made.</Notice>}
      {minor && <Notice tone="setu" title="Patient under 18">A parent or legal guardian signs.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who is signing">
          <Select value={relation} onChange={(e) => setRelation(e.target.value as keyof typeof RELATION)}>
            {(Object.keys(RELATION) as (keyof typeof RELATION)[]).filter((k) => !minor || k !== "self").map((k) => <option key={k} value={k}>{RELATION[k]}</option>)}
          </Select>
        </Field>
        <Field label="Full name of the signer"><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="desk-sign-name" /></Field>
      </div>
      <div role="group" aria-label="Signature method" className="flex gap-2">
        {(["drawn", "typed"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-11 border px-4 text-sm ${mode === m ? "border-ink bg-ink text-gallery" : "border-control"}`}>{m === "drawn" ? "Draw signature" : "Type name"}</button>
        ))}
      </div>
      {mode === "drawn" ? <SignaturePad onChange={setPng} clearLabel="Clear" hint="Sign inside the box with a finger, pen or mouse." /> : <p className="border border-dashed border-control px-4 py-5 font-serif text-2xl italic">{name || " "}</p>}
      {error && <Notice tone="conflict" title={error} />}
      {done && <Notice tone="verified" title="Signed and saved with the patient’s documents" />}
      <div><Button onClick={sign} loading={busy} disabled={!ready || busy}>{withdraw ? "Sign the withdrawal" : "Sign the consent form"}</Button></div>
      <div>
        <h3 className="text-lg">Signed forms</h3>
        {signed.length === 0 ? <p className="mt-1 text-sm text-muted">None yet.</p> : (
          <ul className="mt-2 divide-y divide-rule border border-rule" data-testid="desk-signed-list">
            {signed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <FileText aria-hidden className="size-4 text-faint" />
                <span className="min-w-0 flex-1">{s.action === "withdraw" ? "Withdrawal of consent" : "Consent form"} · {s.signer ?? "name erased"} ({RELATION[s.relation as keyof typeof RELATION] ?? s.relation}, {s.method === "drawn" ? "drawn" : "typed"}) · {new Date(s.signedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
                <a href={`/api/signed-consents/${s.id}/pdf`} target="_blank" rel="noopener" className="underline underline-offset-4">Open or print (PDF)</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
