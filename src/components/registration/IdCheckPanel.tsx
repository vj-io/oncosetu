"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { ID_TYPE_LABEL, ID_TYPE_LIST, type IdTypeName } from "@/core/idcheck";
import { postJson } from "./api";
import { Notice } from "./Notice";

/** Optional ID check at the desk. Only the last 4 characters are typed and stored; a longer value is refused by the server. */
export function IdCheckPanel({ patientId, record }: { patientId: string; record: { idType: IdTypeName; masked: string; verifiedBy: string; verifiedAt: string } | null }) {
  const router = useRouter();
  const [idType, setIdType] = useState<IdTypeName>("aadhaar");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setBusy(true); setError(null); setDone(false);
    const r = await postJson(`/api/patients/${patientId}/id-verification`, { idType, last4 });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setLast4(""); setDone(true);
    router.refresh();
  }

  return (
    <div className="grid max-w-xl gap-4">
      {record ? (
        <p data-testid="id-record-desk" className="text-[15px]">
          On file: <strong>{ID_TYPE_LABEL[record.idType].en} {record.masked}</strong>, checked by {record.verifiedBy} on {new Date(record.verifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.
        </p>
      ) : (
        <p className="text-[15px] text-muted">No ID check recorded. It is optional.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ID type">
          <Select value={idType} onChange={(e) => setIdType(e.target.value as IdTypeName)}>
            {ID_TYPE_LIST.map((t) => <option key={t} value={t}>{ID_TYPE_LABEL[t].en}</option>)}
          </Select>
        </Field>
        <Field label="Last 4 characters only" hint="Never type the full number.">
          <Input value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="text" autoComplete="off" maxLength={40} data-testid="id-last4" />
        </Field>
      </div>
      {error && <Notice tone="conflict" title={error} />}
      {done && <Notice tone="verified" title="ID check recorded" />}
      <div><Button onClick={save} loading={busy} disabled={busy || !last4.trim()}>Record that I checked this ID</Button></div>
      <p className="text-sm text-muted">Stored: the ID type, the last 4 characters, your name and the time. A full Aadhaar number is never stored.</p>
    </div>
  );
}
