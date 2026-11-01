"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LockKeyholeOpen } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui";
import { postJson } from "./api";
import { Notice } from "./Notice";
import { WRAP } from "./style";

export function BreakGlassForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters.");
    setBusy(true);
    const r = await postJson(`/api/patients/${patientId}/break-glass`, { reason: reason.trim() });
    if (r.ok) {
      router.push(`/patients/${patientId}/overview`);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(r.message);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Reason for opening this record" error={error ?? undefined} hint="Recorded with your name. Visible to the administrator and in the patient's access log.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={500} />
      </Field>
      <div>
        <Button type="submit" className={WRAP} loading={busy} icon={<LockKeyholeOpen aria-hidden />}>Open the record for 4 hours</Button>
      </div>
      {error && <Notice tone="conflict" title={error} />}
    </form>
  )
}
