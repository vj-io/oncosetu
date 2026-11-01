"use client";

import { useState } from "react";
import { MessageSquareShare } from "lucide-react";
import { Button } from "@/components/ui";
import { postJson } from "./api";
import { WRAP } from "./style";

/** Sends the neutral pre-visit SMS (with the patient-portal login link) to the primary contact. */
export function PreVisitLinkButton({ patientId }: { patientId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    setBusy(true);
    setMsg(null);
    const r = await postJson(`/api/patients/${patientId}/pre-visit-link`);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Sent to the primary contact (simulated SMS)." } : { ok: false, text: r.message });
  }
  return (
    <div className="grid gap-2">
      <div><Button variant="secondary" className={WRAP} loading={busy} onClick={send} icon={<MessageSquareShare aria-hidden />}>Send pre-visit link</Button></div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-sage-ink" : "text-sm text-madder-ink"}>{msg.text}</p>}
    </div>
  );
}
