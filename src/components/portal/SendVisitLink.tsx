"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { Button } from "@/components/ui";

/** Staff: SMS the pre-visit link to whoever is the patient's primary contact. */
export function SendVisitLink({ patientId, recipient }: { patientId: string; recipient: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      // Registration's endpoint: a neutral SMS to the primary contact with the patient-portal login link
      const res = await fetch(`/api/patients/${patientId}/pre-visit-link`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (res.ok) setMsg({ ok: true, text: `Link sent to ${recipient}.` });
      else setMsg({ ok: false, text: body?.error?.code === "no_phone" ? "There is no phone number on file for that person. Add one on the Overview tab." : (body?.error?.message ?? "Could not send the link.") });
    } catch {
      setMsg({ ok: false, text: "Could not reach the server." });
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Send />} loading={busy} onClick={send}>Send pre-visit link</Button>
        <span className="text-sm text-muted">Goes to {recipient} by SMS. The link needs the one-time code to open.</span>
      </div>
      <p role="status" className={msg ? (msg.ok ? "flex items-start gap-1.5 text-sm text-sage-ink" : "flex items-start gap-1.5 text-sm text-madder-ink") : "sr-only"}>
        {msg && (msg.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />)}
        {msg?.text}
      </p>
    </div>
  );
}
