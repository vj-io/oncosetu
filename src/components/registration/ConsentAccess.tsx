"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Eraser, ShieldOff, UserPlus, UserX } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select } from "@/components/ui";
import { postJson, stashCardToken } from "./api";
import { ConfirmStep, confirmOf, EMPTY_CONFIRM, type ConfirmState, type Purposes } from "./ConsentCapture";
import { ConsentRecorder } from "./ConsentRecorder";
import { Notice } from "./Notice";
import { WRAP } from "./style";
import type { Lang } from "@/core/types";

/** Runs a POST, shows the outcome inline, refreshes the server data on success. */
function useAction(patientId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(key: string, path: string, body: unknown, ok: (data: Record<string, unknown>) => string | void) {
    setBusy(key); setError(null); setDone(null);
    const r = await postJson<Record<string, unknown>>(`/api/patients/${patientId}/${path}`, body);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    const msg = ok(r.data);
    if (msg) setDone(msg);
    router.refresh();
  }
  return { busy, error, done, run, setError };
}

const Status = ({ error, done }: { error: string | null; done: string | null }) => (
  <>
    {error && <Notice tone="conflict" title={error} />}
    {done && <Notice tone="verified" title={done} />}
  </>
);

export function ConsentActions({ patientId, current, language }: { patientId: string; current: Purposes | null; language: Lang }) {
  const router = useRouter();
  const a = useAction(patientId);
  const [open, setOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className={WRAP} onClick={() => setOpen((o) => !o)}>{open ? "Close" : current ? "Change purposes or re-confirm" : "Record new consent"}</Button>
        {current && <Button variant="danger" className={WRAP} onClick={() => setWithdraw(true)} icon={<ShieldOff aria-hidden />}>Withdraw consent</Button>}
      </div>
      <Status error={a.error} done={a.done} />
      {open && <ConsentRecorder patientId={patientId} initialPurposes={current ?? undefined} language={language} onDone={() => { setOpen(false); router.refresh(); }} />}
      <Dialog
        open={withdraw} onClose={() => setWithdraw(false)} title="Withdraw consent"
        description="Takes effect on the next request. Staff can no longer open this record, and every share link stops working."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdraw(false)}>Cancel</Button>
            <Button variant="danger" disabled={!asked} loading={a.busy === "withdraw"} onClick={() => a.run("withdraw", "consent", { action: "withdraw" }, (d) => { setWithdraw(false); return `Consent withdrawn. ${d.revokedShareLinks as number} share link${d.revokedShareLinks === 1 ? "" : "s"} revoked.`; })}>
              Withdraw now
            </Button>
          </>
        }
      >
        <Checkbox checked={asked} onChange={(e) => setAsked(e.target.checked)} label="The patient (or their caregiver) asked me to withdraw consent." />
      </Dialog>
    </div>
  );
}

type Cg = { id: string; name: string; relation: string; phoneMasked: string; isGuardian: boolean; active: boolean };

export function CaregiverPanel({ patientId, caregivers, minor, patientCanReceiveCode }: { patientId: string; caregivers: Cg[]; minor: boolean; patientCanReceiveCode: boolean }) {
  const a = useAction(patientId);
  const [form, setForm] = useState({ name: "", relation: "", phone: "", isGuardian: false });
  const [confirm, setConfirm] = useState<ConfirmState>({ ...EMPTY_CONFIRM, method: patientCanReceiveCode ? "otp" : "witnessed" });
  const [adding, setAdding] = useState(false);

  async function add() {
    a.setError(null);
    const c = confirmOf(confirm);
    if (form.name.trim().length < 2 || form.relation.trim().length < 2 || form.phone.replace(/\D/g, "").length < 10) return a.setError("Enter the caregiver's name, relation and 10-digit mobile number.");
    if (!c) return a.setError(confirm.method === "otp" ? "Enter the 6-digit code from the SMS." : "Tick the witness confirmation.");
    await a.run("add", "caregivers", { name: form.name.trim(), relation: form.relation.trim(), phone: form.phone, isGuardian: minor && form.isGuardian, confirm: c }, () => {
      setForm({ name: "", relation: "", phone: "", isGuardian: false });
      setConfirm({ ...EMPTY_CONFIRM, method: confirm.method });
      setAdding(false);
      return "Caregiver added.";
    });
  }

  return (
    <div className="grid gap-4">
      {caregivers.length === 0 ? (
        <p className="text-muted">No caregiver is recorded.</p>
      ) : (
        <ul className="grid divide-y divide-rule border-y border-rule">
          {caregivers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-[15px]">{c.name} <span className="text-muted">· {c.relation}</span></span>
                <span className="font-mono text-xs text-faint">{c.phoneMasked}</span>
              </div>
              {c.isGuardian && <Badge tone="setu">Guardian</Badge>}
              {c.active ? (
                <Button variant="secondary" size="sm" loading={a.busy === c.id} onClick={() => a.run(c.id, `caregivers/${c.id}/revoke`, {}, () => "Access ended. Their sessions stop on the next request.")} icon={<UserX aria-hidden />}>Revoke</Button>
              ) : (
                <Badge tone="shadow">Revoked</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <Status error={a.error} done={a.done} />
      {!adding ? (
        <div><Button variant="secondary" onClick={() => setAdding(true)} icon={<UserPlus aria-hidden />}>Add a caregiver</Button></div>
      ) : (
        <div className="grid gap-4 border border-rule bg-surface p-4">
          <p className="ds-kicker">New caregiver</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></Field>
            <Field label="Relation"><Input value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} /></Field>
            <Field label="Mobile number"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" /></Field>
          </div>
          {minor && <Checkbox label="Legal guardian" checked={form.isGuardian} onChange={(e) => setForm({ ...form, isGuardian: e.target.checked })} />}
          <ConfirmStep
            value={confirm} onChange={setConfirm} canSendCode={patientCanReceiveCode}
            contactHint={minor ? "A code goes to the guardian's phone." : "A code goes to the PATIENT's phone, never the caregiver's."}
            witnessText="The patient (or guardian) is here, agreed to add this caregiver in person, and I witnessed it."
            sendCode={async () => { const r = await postJson(`/api/patients/${patientId}/consent/otp`, { target: "patient" }); return r.ok ? null : r.message; }}
          />
          <div className="flex gap-2">
            <Button onClick={add} loading={a.busy === "add"}>Add caregiver</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const REASONS: [string, string][] = [
  ["patient_informed", "The patient has been informed"],
  ["patient_asked_not_to_be_told", "The patient asked not to be told"],
  ["family_request", "The family asked for it"],
  ["clinician_assessment", "Clinical assessment"],
  ["status_recorded_in_error", "Recorded in error"],
];

export function DisclosurePanel({ patientId, current, canEdit }: { patientId: string; current: "cleared" | "not_cleared" | "unknown"; canEdit: boolean }) {
  const a = useAction(patientId);
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState(REASONS[0][0]);
  if (!canEdit) return <p className="text-muted">Only a clinician can change the disclosure status. It is currently <strong className="font-medium text-ink">{current.replace("_", " ")}</strong>.</p>;
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Disclosure status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="unknown">Unknown</option><option value="not_cleared">Not cleared</option><option value="cleared">Cleared</option>
          </Select>
        </Field>
        <Field label="Reason" hint="Saved with the change as a code; the audit log holds no free text.">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
      </div>
      <Status error={a.error} done={a.done} />
      <div><Button disabled={status === current} loading={a.busy === "d"} onClick={() => a.run("d", "disclosure", { status, reason }, () => "Disclosure status updated and audited.")}>Save disclosure status</Button></div>
    </div>
  );
}

export function PrimaryContactPanel({ patientId, current, minor }: { patientId: string; current: "patient" | "caregiver"; minor: boolean }) {
  const a = useAction(patientId);
  const [v, setV] = useState(current);
  return (
    <div className="grid gap-3">
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,16rem)_auto]">
        <Field label="Primary contact" hint={minor ? "Always the guardian for a patient under 18." : "Receives links, codes and read-backs."}>
          <Select value={v} disabled={minor} onChange={(e) => setV(e.target.value as typeof v)}><option value="patient">The patient</option><option value="caregiver">The caregiver</option></Select>
        </Field>
        <Button className="sm:mt-6" variant="secondary" disabled={minor || v === current} loading={a.busy === "p"} onClick={() => a.run("p", "consent/primary-contact", { primaryContact: v }, () => "Primary contact updated.")}>Save</Button>
      </div>
      <Status error={a.error} done={a.done} />
    </div>
  );
}

export function CardPanel({ patientId, revoked, canManage }: { patientId: string; revoked: boolean; canManage: boolean }) {
  const router = useRouter();
  const a = useAction(patientId);
  async function reissue() {
    a.setError(null);
    await a.run("t", "token", { action: "reissue" }, (d) => { stashCardToken(patientId, d.token as string); router.push(`/patients/${patientId}/card`); });
  }
  return (
    <div className="grid gap-3">
      <p className="text-muted">{revoked ? "The current card was revoked." : "A card is issued. The old card stops working the moment a replacement is issued."}</p>
      <div className="flex flex-wrap gap-2">
        {canManage && <Button variant="secondary" className={WRAP} loading={a.busy === "t"} onClick={reissue} icon={<CreditCard aria-hidden />}>Card lost: revoke and issue a new one</Button>}
      </div>
      <Status error={a.error} done={a.done} />
    </div>
  );
}

export function StatusPanel({ patientId, deceased, canSetDeceased, canTransfer, patientCanReceiveCode }: { patientId: string; deceased: boolean; canSetDeceased: boolean; canTransfer: boolean; patientCanReceiveCode: boolean }) {
  const a = useAction(patientId);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>({ ...EMPTY_CONFIRM, method: patientCanReceiveCode ? "otp" : "witnessed" });
  const [ack, setAck] = useState(false);
  const rows: ReactNode[] = [];
  if (canTransfer) {
    rows.push(
      <div key="t" className="grid gap-3">
        <Notice tone="unverified" title="This patient has turned 18">Control of the record passes to the patient. Guardian access ends, and the patient should confirm their own consent afterwards.</Notice>
        {!open ? (
          <div><Button variant="secondary" className={WRAP} onClick={() => setOpen(true)}>Hand control to the patient</Button></div>
        ) : (
          <div className="grid gap-4 border border-rule bg-surface p-4">
            <ConfirmStep
              value={confirm} onChange={setConfirm} canSendCode={patientCanReceiveCode} contactHint="A code goes to the PATIENT's own phone."
              witnessText="The patient is here, asked to take control of the record in person, and I witnessed it."
              sendCode={async () => { const r = await postJson(`/api/patients/${patientId}/consent/otp`, { target: "patient" }); return r.ok ? null : r.message; }}
            />
            <div><Button loading={a.busy === "x"} onClick={() => { const c = confirmOf(confirm); if (!c) return a.setError("Complete the confirmation first."); a.run("x", "consent/transfer-control", { confirm: c }, () => "Control transferred. Guardian access has ended."); }}>Transfer control</Button></div>
          </div>
        )}
      </div>,
    );
  }
  if (canSetDeceased) {
    rows.push(
      <div key="d" className="grid gap-3">
        <p className="text-muted">{deceased ? "Recorded as deceased: patient and caregiver access is closed." : "Recording a death closes patient and caregiver access on the next request. Legal-heir access follows the hospital's policy."}</p>
        {!deceased && <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="I confirm this patient has died." />}
        <div>
          <Button variant="secondary" disabled={!deceased && !ack} loading={a.busy === "dec"} icon={<Eraser aria-hidden />} onClick={() => a.run("dec", "consent/deceased", { deceased: !deceased }, () => (deceased ? "Deceased flag removed." : "Recorded as deceased. Patient-facing access is closed."))}>
            {deceased ? "Remove the deceased flag" : "Record as deceased"}
          </Button>
        </div>
      </div>,
    );
  }
  return rows.length ? <div className="grid gap-6">{rows}<Status error={a.error} done={a.done} /></div> : <p className="text-muted">Nothing to change.</p>;
}
