"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailPlus, RefreshCw, X } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select } from "@/components/ui";
import { postJson } from "@/components/registration/api";
import { Notice } from "@/components/registration/Notice";
import { WRAP } from "@/components/registration/style";

export type DropContact = { id: string; emailMasked: string; caregiverId: string | null; verifiedBy: string; verifiedAt: string; revoked: boolean };
type Caregiver = { id: string; name: string; relation: string; active: boolean };

const DAY = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** FR-ING-04 on the consent tab: the drop address, and the addresses staff verified in person (only those may send). */
export function EmailDropPanel({ patientId, configured, address, contacts, caregivers, canManage }: {
  patientId: string; configured: boolean; address: string | null; contacts: DropContact[]; caregivers: Caregiver[]; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rotate, setRotate] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", owner: "", checked: false });
  const who = (c: DropContact) => {
    const cg = caregivers.find((g) => g.id === c.caregiverId);
    return cg ? `${cg.name} (${cg.relation})` : "Patient";
  };

  async function act(key: string, path: string, body: unknown, ok: string) {
    setBusy(key); setError(null); setDone(null);
    const r = await postJson(`/api/patients/${patientId}/${path}`, body);
    setBusy(null);
    if (!r.ok) { setError(r.message); return false; }
    setDone(ok);
    router.refresh();
    return true;
  }

  async function add() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Enter the email address.");
    if (!form.checked) return setError("Tick the confirmation that you checked the address in person.");
    const ok = await act("add", "contact-emails", { email: form.email.trim(), caregiverId: form.owner || null, verifiedInPerson: true }, "Address verified. Mail from it to the drop address is accepted.");
    if (ok) { setForm({ email: "", owner: "", checked: false }); setAdding(false); }
  }

  if (!configured) return <p className="text-muted">Email drop is not set up on this server.</p>;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 border border-rule bg-surface p-4">
        <p className="ds-kicker text-muted">Drop address</p>
        {address ? (
          <p className="font-mono text-[15px] break-all" data-testid="drop-address">{address}</p>
        ) : (
          <p className="text-muted">No drop address yet.</p>
        )}
        <p className="text-sm text-muted">Attachments sent here from a verified address below are added to this record (PDF, JPEG, PNG or HEIC, up to 4 MB each, 10 per mail). Mail from any other address is refused and nothing is kept.</p>
        {canManage && (
          <div>
            {address ? (
              <Button variant="secondary" className={WRAP} icon={<RefreshCw aria-hidden />} onClick={() => setRotate(true)}>Replace address</Button>
            ) : (
              <Button variant="secondary" className={WRAP} icon={<MailPlus aria-hidden />} loading={busy === "alias"} onClick={() => act("alias", "inbound-alias", {}, "Drop address created.")}>Create drop address</Button>
            )}
          </div>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-muted">No verified address yet.</p>
      ) : (
        <ul className="grid divide-y divide-rule border-y border-rule" aria-label="Verified addresses">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-mono text-[15px] break-all">{c.emailMasked} <span className="font-sans text-muted">· {who(c)}</span></span>
                <span className="text-xs text-faint">Verified in person by {c.verifiedBy} on {DAY.format(new Date(c.verifiedAt))}</span>
              </div>
              {c.revoked ? (
                <Badge tone="shadow">Revoked</Badge>
              ) : canManage ? (
                <Button variant="secondary" size="sm" loading={busy === c.id} icon={<X aria-hidden />} onClick={() => act(c.id, `contact-emails/${c.id}/revoke`, {}, "Address revoked. Mail from it is refused from now on.")}>Revoke</Button>
              ) : (
                <Badge tone="verified">Verified</Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <Notice tone="conflict" title={error} />}
      {done && <Notice tone="verified" title={done} />}

      {canManage && (!adding ? (
        <div><Button variant="secondary" onClick={() => setAdding(true)} icon={<MailPlus aria-hidden />}>Add a verified address</Button></div>
      ) : (
        <div className="grid gap-4 border border-rule bg-surface p-4">
          <p className="ds-kicker">New verified address</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email address"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></Field>
            <Field label="Whose address">
              <Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                <option value="">Patient</option>
                {caregivers.filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.relation})</option>)}
              </Select>
            </Field>
          </div>
          <Checkbox
            label="I checked this address in person with its owner (the patient or the caregiver named above)."
            checked={form.checked} onChange={(e) => setForm({ ...form, checked: e.target.checked })}
          />
          <div className="flex gap-2">
            <Button onClick={add} loading={busy === "add"}>Add address</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ))}

      <Dialog
        open={rotate} onClose={() => setRotate(false)} title="Replace the drop address"
        description="The current address stops working at once. Give the new one to the patient or caregiver."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRotate(false)}>Cancel</Button>
            <Button loading={busy === "alias"} onClick={async () => { if (await act("alias", "inbound-alias", {}, "New drop address created. The old one no longer works.")) setRotate(false); }}>Replace now</Button>
          </>
        }
      />
    </div>
  );
}
