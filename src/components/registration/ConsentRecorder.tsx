"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button, type Lang } from "@/components/ui";
import { postJson } from "./api";
import { ConsentCapture, consentBody, consentConfirm, DEFAULT_CONSENT, type ConsentValue, type Purposes } from "./ConsentCapture";
import { Notice } from "./Notice";

/** Records new consent for an existing patient (first grant, changed purposes, or re-consent after a withdrawal). */
export function ConsentRecorder({
  patientId,
  initialPurposes,
  language = "en",
  onDone,
}: {
  patientId: string;
  initialPurposes?: Purposes;
  language?: Lang;
  onDone: () => void;
}) {
  const [value, setValue] = useState<ConsentValue>({ ...DEFAULT_CONSENT, language, purposes: initialPurposes ?? DEFAULT_CONSENT.purposes });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    const confirm = consentConfirm(value);
    if (!value.purposes.store) return setError("Keeping and organising the record is required. To stop, use Withdraw consent.");
    if (!confirm) return setError(value.method === "otp" ? "Enter the 6-digit code from the SMS." : "Tick the witness confirmation.");
    setSaving(true);
    const r = await postJson(`/api/patients/${patientId}/consent`, { action: "record", ...consentBody(value), confirm });
    setSaving(false);
    if (r.ok) onDone();
    else setError(r.message);
  }

  return (
    <div className="grid gap-5">
      <ConsentCapture
        value={value}
        onChange={setValue}
        canSendCode
        contactHint="A code goes to the primary contact's phone."
        sendCode={async () => {
          const r = await postJson(`/api/patients/${patientId}/consent/otp`, { target: "primary" });
          return r.ok ? null : r.message;
        }}
      />
      {error && <Notice tone="conflict" title={error} />}
      <div>
        <Button onClick={save} loading={saving} icon={<Save aria-hidden />}>Save consent</Button>
      </div>
    </div>
  );
}
