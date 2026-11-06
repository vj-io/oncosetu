"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Plus, Trash2, UserRoundPlus } from "lucide-react";
import { Badge, Button, Checkbox, Field, Frame, Input, Select, TONE } from "@/components/ui";
import { istDate } from "@/core/copy";
import { ageOn } from "@/core/identity";
import { postJson, stashCardToken } from "./api";
import { ConsentCapture, consentBody, consentConfirm, DEFAULT_CONSENT, type ConsentValue } from "./ConsentCapture";
import { Notice } from "./Notice";
import { WRAP } from "./style";

type Role = "desk" | "records" | "clinician";
type Alias = { name: string; kind: "married" | "transliteration" | "other" };
type Candidate = {
  id: string; accession: string; initials: string; ageYears: number | null; mrn: string | null; phoneMasked: string | null
  reasons: string[]; strong: boolean; blocking: boolean
};

const REASON_LABEL: Record<string, string> = {
  abha: "Same ABHA number",
  identity: "Same name and date of birth",
  name_dob: "Similar name, same date of birth",
  name_phone: "Same name and phone",
  phone: "Same phone number (a family may share one)",
  mrn: "Same MRN / UHID",
};
const STEPS = ["Identity", "Contacts and disclosure", "Consent"] as const;

const todayIst = () => istDate(new Date().toISOString());

export function RegistrationWizard({ role }: { role: Role }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    fullName: "", dobMode: "dob" as "dob" | "age", dob: "", age: "", sex: "unknown", phone: "", mrn: "", abha: "",
    preferredLanguage: "en", disclosureStatus: "unknown", primaryContact: "patient",
    cgName: "", cgRelation: "", cgPhone: "", cgGuardian: false,
  });
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [consent, setConsent] = useState<ConsentValue>(DEFAULT_CONSENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [dupAck, setDupAck] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const age = useMemo(() => {
    if (f.dobMode === "dob") return /^\d{4}-\d{2}-\d{2}$/.test(f.dob) ? ageOn(f.dob, todayIst()) : null;
    return f.age !== "" && Number.isInteger(Number(f.age)) ? Number(f.age) : null;
  }, [f.dobMode, f.dob, f.age]);
  const minor = age !== null && age < 18;
  const primary = minor ? "caregiver" : f.primaryContact;
  const needsCaregiver = minor || primary === "caregiver";
  const hasCaregiver = !!(f.cgName.trim() || f.cgRelation.trim() || f.cgPhone.trim());
  const otpPhone = primary === "caregiver" ? f.cgPhone : f.phone || f.cgPhone;

  function validateIdentity() {
    const e: Record<string, string> = {};
    if (f.fullName.trim().length < 2) e.fullName = "Enter the full name.";
    if (f.dobMode === "dob") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dob)) e.dob = "Enter the date of birth.";
      else if (f.dob > todayIst()) e.dob = "The date of birth cannot be in the future.";
    } else if (age === null || age < 0 || age > 120) e.age = "Enter an age between 0 and 120.";
    if (f.abha && f.abha.replace(/\D/g, "").length !== 14) e.abha = "An ABHA number has 14 digits.";
    if (f.phone && f.phone.replace(/\D/g, "").length < 10) e.phone = "Enter a 10-digit mobile number.";
    aliases.forEach((a, i) => a.name && a.name.trim().length < 2 && (e[`alias${i}`] = "Too short."));
    setErrors(e);
    return !Object.keys(e).length;
  }

  function validateContacts() {
    const e: Record<string, string> = {};
    if (needsCaregiver || hasCaregiver) {
      if (f.cgName.trim().length < 2) e.cgName = "Enter the caregiver's name.";
      if (f.cgRelation.trim().length < 2) e.cgRelation = "Enter the relation, for example son or husband.";
      if (f.cgPhone.replace(/\D/g, "").length < 10) e.cgPhone = "Enter a 10-digit mobile number.";
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function toContacts() {
    setBanner(null);
    if (validateIdentity()) setStep(1);
  }

  async function toConsent() {
    setBanner(null);
    if (!validateContacts()) return;
    setChecking(true);
    const r = await postJson<{ candidates: Candidate[] }>("/api/desk/duplicate-check", {
      fullName: f.fullName.trim(), aliases: aliases.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim() })),
      dob: f.dobMode === "dob" ? f.dob : undefined, phone: f.phone || undefined, mrn: f.mrn.trim() || undefined, abhaNumber: f.abha || undefined,
    });
    setChecking(false);
    if (!r.ok) return setBanner(r.message);
    setCandidates(r.data.candidates);
    if (!r.data.candidates.length || dupAck) setStep(2);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    const confirm = consentConfirm(consent);
    if (!consent.purposes.store) return setBanner("Keeping and organising the record is required to register.");
    if (!confirm) return setBanner(consent.method === "otp" ? "Enter the 6-digit code from the SMS." : "Tick the witness confirmation.");
    setSaving(true);
    const r = await postJson<{ id: string; token: string; cardUrl: string }>("/api/patients", {
      fullName: f.fullName.trim(), aliases: aliases.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), kind: a.kind })),
      ...(f.dobMode === "dob" ? { dob: f.dob } : { age: Number(f.age) }),
      sex: f.sex, phone: f.phone || undefined, mrn: f.mrn.trim() || undefined, abhaNumber: f.abha || undefined,
      preferredLanguage: f.preferredLanguage, disclosureStatus: f.disclosureStatus, primaryContact: primary,
      caregiver: needsCaregiver || hasCaregiver
        ? { name: f.cgName.trim(), relation: f.cgRelation.trim(), phone: f.cgPhone, isGuardian: minor ? true : f.cgGuardian }
        : undefined,
      consent: { ...consentBody(consent), confirm },
      continueDespiteDuplicates: dupAck,
    });
    setSaving(false);
    if (r.ok) {
      stashCardToken(r.data.id, r.data.token);
      router.push(r.data.cardUrl);
      return;
    }
    if (r.code === "possible_duplicate") {
      setCandidates((r.data.candidates as Candidate[]) ?? []);
      setDupAck(false);
      setStep(1);
    } else if (r.code === "mrn_in_use") {
      setErrors({ mrn: r.message });
      setStep(0);
    }
    setBanner(r.message);
  }

  return (
    <form method="post" onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-8" noValidate>
      <ol aria-label="Registration steps" className="flex flex-wrap gap-x-6 gap-y-2">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={clsx("flex items-center gap-2 border-b-2 pb-1.5", i === step ? "border-ink text-ink" : "border-transparent text-faint")}>
            <span className="grid size-6 place-items-center border border-current font-mono text-[11px]">{i + 1}</span>
            <span className="text-sm">{s}</span>
          </li>
        ))}
      </ol>

      {banner && <Notice tone="conflict" title={banner} />}

      {step === 0 && (
        <Frame matte>
          <fieldset className="grid gap-5 p-4 sm:p-6">
            <legend className="ds-kicker px-2">1 · Identity</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Full name" error={errors.fullName} className="sm:col-span-2">
                <Input value={f.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="off" />
              </Field>

              <div className="grid gap-3 sm:col-span-2">
                <p className="ds-kicker text-muted">Other names (maiden name, spelling variants)</p>
                {aliases.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1fr_12rem_auto]">
                    <Field label={`Other name ${i + 1}`} error={errors[`alias${i}`]} className="col-span-2 sm:col-span-1">
                      <Input value={a.name} onChange={(e) => setAliases((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    </Field>
                    <Field label="Kind">
                      <Select value={a.kind} onChange={(e) => setAliases((xs) => xs.map((x, j) => (j === i ? { ...x, kind: e.target.value as Alias["kind"] } : x)))}>
                        <option value="married">Name after marriage</option>
                        <option value="transliteration">Spelling or script variant</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                    <Button variant="ghost" className="mt-6" aria-label={`Remove other name ${i + 1}`} onClick={() => setAliases((xs) => xs.filter((_, j) => j !== i))} icon={<Trash2 aria-hidden />} />
                  </div>
                ))}
                <div>
                  <Button variant="secondary" size="sm" onClick={() => setAliases((xs) => [...xs, { name: "", kind: "married" }])} icon={<Plus aria-hidden />}>
                    Add another name
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:col-span-2">
                <div role="radiogroup" aria-label="Date of birth or age" className="flex flex-wrap gap-2">
                  {(["dob", "age"] as const).map((m) => (
                    <label key={m} className={clsx("flex h-11 cursor-pointer items-center gap-2 border px-3 text-sm has-checked:border-ink has-checked:bg-matte", f.dobMode === m ? "border-ink" : "border-rule")}>
                      <input type="radio" className="accent-obsidian" name="dobMode" checked={f.dobMode === m} onChange={() => set("dobMode", m)} />
                      {m === "dob" ? "I know the date of birth" : "Age only (estimate)"}
                    </label>
                  ))}
                </div>
                {f.dobMode === "dob" ? (
                  <Field label="Date of birth" error={errors.dob} className="sm:max-w-xs">
                    <Input type="date" max={todayIst()} value={f.dob} onChange={(e) => set("dob", e.target.value)} />
                  </Field>
                ) : (
                  <Field label="Age in years" error={errors.age} hint="Saved as an estimated date of birth, flagged in the audit log." className="sm:max-w-xs">
                    <Input inputMode="numeric" value={f.age} onChange={(e) => set("age", e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </Field>
                )}
                {minor && (
                  <Notice tone="unverified" title="Under 18: a guardian is required">
                    The next step records the guardian, and the guardian becomes the primary contact for links and codes.
                  </Notice>
                )}
              </div>

              <Field label="Sex">
                <Select value={f.sex} onChange={(e) => set("sex", e.target.value)}>
                  <option value="unknown">Not stated</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Preferred language">
                <Select value={f.preferredLanguage} onChange={(e) => set("preferredLanguage", e.target.value)}>
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                  <option value="hinglish">Hinglish (Hindi in English letters)</option>
                </Select>
              </Field>
              <Field label="Mobile number" optional error={errors.phone} hint="Without a phone, consent is taken in person with a witness.">
                <Input type="tel" inputMode="tel" autoComplete="off" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="MRN / UHID" optional error={errors.mrn}>
                <Input value={f.mrn} onChange={(e) => set("mrn", e.target.value)} />
              </Field>
              <Field
                label={<span className="flex items-center gap-2">ABHA number <Badge tone="unverified">Unverified</Badge></span>}
                optional error={errors.abha} hint="Captured as given. It stays unverified until ABDM verification is available."
                className="sm:col-span-2 sm:max-w-md"
              >
                <Input inputMode="numeric" placeholder="14 digits" value={f.abha} onChange={(e) => set("abha", e.target.value)} />
              </Field>
            </div>
          </fieldset>
        </Frame>
      )}

      {step === 1 && (
        <Frame matte>
          <fieldset className="grid gap-5 p-4 sm:p-6">
            <legend className="ds-kicker px-2">2 · Contacts and disclosure</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Primary contact" hint={minor ? "Fixed to the guardian for a patient under 18." : "Who receives links, codes and read-backs. Chosen with the patient and caregiver."}>
                <Select value={primary} disabled={minor} onChange={(e) => set("primaryContact", e.target.value)}>
                  <option value="patient">The patient</option>
                  <option value="caregiver">The caregiver</option>
                </Select>
              </Field>
              <Field
                label="Disclosure status"
                hint={role === "clinician" ? "Whether the patient may be told the diagnosis. Neutral wording is used unless cleared." : "Stays 'unknown' until a clinician sets it. Neutral wording is used in everything the patient or family sees."}
              >
                <Select value={f.disclosureStatus} disabled={role !== "clinician"} onChange={(e) => set("disclosureStatus", e.target.value)}>
                  <option value="unknown">Unknown (default)</option>
                  {role === "clinician" && <option value="not_cleared">Not cleared</option>}
                  {role === "clinician" && <option value="cleared">Cleared</option>}
                </Select>
              </Field>
            </div>

            <div className="grid gap-5 border-t border-rule pt-5 sm:grid-cols-2">
              <p className="ds-kicker sm:col-span-2">
                Caregiver {needsCaregiver ? <Badge tone="setu">{minor ? "Guardian required" : "Required"}</Badge> : <span className="normal-case tracking-normal text-faint">(optional)</span>}
              </p>
              <Field label="Caregiver name" error={errors.cgName}>
                <Input value={f.cgName} onChange={(e) => set("cgName", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Relation" error={errors.cgRelation}>
                <Input value={f.cgRelation} onChange={(e) => set("cgRelation", e.target.value)} placeholder="son, husband, mother…" />
              </Field>
              <Field label="Caregiver mobile number" error={errors.cgPhone}>
                <Input type="tel" inputMode="tel" autoComplete="off" value={f.cgPhone} onChange={(e) => set("cgPhone", e.target.value)} />
              </Field>
              <Checkbox
                label="Legal guardian"
                description={minor ? "Required for a patient under 18." : undefined}
                checked={minor ? true : f.cgGuardian}
                disabled={minor}
                onChange={(e) => set("cgGuardian", e.target.checked)}
              />
            </div>
          </fieldset>
        </Frame>
      )}

      {step === 1 && candidates && candidates.length > 0 && (
        <DuplicateWarning
          candidates={candidates}
          role={role}
          acknowledged={dupAck}
          onContinue={() => { setDupAck(true); setStep(2); }}
        />
      )}

      {step === 2 && (
        <Frame matte>
          <div className="grid gap-5 p-4 sm:p-6">
            <p className="ds-kicker">3 · Consent</p>
            <ConsentCapture
              value={consent}
              onChange={setConsent}
              canSendCode={otpPhone.replace(/\D/g, "").length >= 10}
              contactHint={primary === "caregiver" ? "A code goes to the caregiver's phone." : f.phone ? "A code goes to the patient's phone." : "A code goes to the caregiver's phone (the patient has none on file)."}
              sendCode={async () => {
                const r = await postJson("/api/desk/consent-otp", { phone: otpPhone, language: consent.language });
                return r.ok ? null : r.message;
              }}
            />
          </div>
        </Frame>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" disabled={step === 0} onClick={() => { setBanner(null); setStep(step - 1); }} icon={<ArrowLeft aria-hidden />}>
          Back
        </Button>
        {step === 0 && <Button onClick={toContacts} icon={<ArrowRight aria-hidden />}>Continue</Button>}
        {step === 1 && <Button onClick={toConsent} loading={checking} icon={<ArrowRight aria-hidden />}>{candidates?.length && !dupAck ? "Check again" : "Continue to consent"}</Button>}
        {step === 2 && <Button type="submit" size="lg" loading={saving} icon={<UserRoundPlus aria-hidden />}>Register patient</Button>}
      </div>
    </form>
  );
}

function DuplicateWarning({ candidates, role, acknowledged, onContinue }: { candidates: Candidate[]; role: Role; acknowledged: boolean; onContinue: () => void }) {
  const blocked = candidates.some((c) => c.blocking);
  const t = TONE.unverified;
  return (
    <section aria-labelledby="dup-h" className={clsx("grid gap-4 border border-l-[3px] border-rule bg-surface p-5", t.bar)}>
      <div className="grid gap-1">
        <h2 id="dup-h" className="text-xl">This person may already be registered</h2>
        <p className="text-muted">Check before creating a second record. Merging two records is done by an administrator, not here.</p>
      </div>
      <ul className="grid gap-3">
        {candidates.map((c) => (
          <li key={c.id} className="grid gap-2 border border-rule bg-matte p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-lg">{c.initials}</span>
              <span className="font-mono text-xs tracking-[0.1em] text-faint">ACC. {c.accession}</span>
              {c.ageYears != null && <span className="text-sm text-muted">{c.ageYears} y</span>}
              {c.mrn && <span className="font-mono text-xs text-muted">MRN {c.mrn}</span>}
              {c.phoneMasked && <span className="font-mono text-xs text-muted">{c.phoneMasked}</span>}
              <Badge tone={c.blocking ? "conflict" : c.strong ? "unverified" : "neutral"}>{c.blocking ? "MRN in use" : c.strong ? "Strong match" : "Weak match"}</Badge>
            </div>
            <ul className="text-sm text-muted">
              {c.reasons.map((r) => <li key={r}>· {REASON_LABEL[r] ?? r}</li>)}
            </ul>
            <div>
              <Link className="text-sm underline" href={role === "desk" ? `/desk?patient=${c.id}` : `/patients/${c.id}/overview`}>
                Open the existing record{role === "desk" ? " (verification first)" : ""}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {blocked ? (
        <p className="text-sm text-madder-ink">That MRN / UHID already belongs to a record. Go back and correct it, or open the existing record.</p>
      ) : (
        <div>
          <Button variant="secondary" className={WRAP} onClick={onContinue} disabled={acknowledged}>I checked: this is a different person, continue</Button>
        </div>
      )}
    </section>
  );
}
