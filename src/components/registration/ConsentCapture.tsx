"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { Printer, Send } from "lucide-react";
import { Badge, Button, Checkbox, Field, Input, LanguageToggle, Switch, type Lang } from "@/components/ui";
import { htmlLang } from "@/core/copy";
import { CONSENT_NOTICE_VERSION, consentCopy, type ConsentPurposeKey } from "@/i18n/consent";
import { Notice, PRINT_CSS } from "./Notice";
import { WRAP } from "./style";

export type Purposes = Record<ConsentPurposeKey, boolean>;
export type ConsentValue = { purposes: Purposes; language: Lang; method: "otp" | "witnessed"; code: string; attest: boolean };

export const DEFAULT_CONSENT: ConsentValue = {
  purposes: { store: true, ai: false, share: false, abdm: false, metrics: false },
  language: "en",
  method: "otp",
  code: "",
  attest: false,
};

const PURPOSES: ConsentPurposeKey[] = ["store", "ai", "share", "abdm", "metrics"];
const LETTERS = ["a", "b", "c", "d", "e"];

/** The `confirm` object the API expects, or null while the screen is incomplete. */
export function consentConfirm(v: ConsentValue): { method: "otp"; code: string } | { method: "witnessed"; attest: true } | null {
  if (v.method === "otp") return /^\d{4,12}$/.test(v.code.trim()) ? { method: "otp", code: v.code.trim() } : null;
  return v.attest ? { method: "witnessed", attest: true } : null;
}

export const consentBody = (v: ConsentValue) => ({ purposes: v.purposes, language: v.language, noticeVersion: CONSENT_NOTICE_VERSION });

/**
 * The consent screen: plain-language notice (English and Hindi, versioned), five separate toggles, and either an OTP to
 * the primary contact or an in-person witnessed acknowledgement with a printable notice (FR-CON-01, FR-CON-06).
 */
export function ConsentCapture({
  value,
  onChange,
  sendCode,
  canSendCode,
  contactHint,
}: {
  value: ConsentValue;
  onChange: (v: ConsentValue) => void;
  /** Sends the code; resolves to an error message, or null when sent. */
  sendCode: () => Promise<string | null>;
  canSendCode: boolean;
  contactHint: string;
}) {
  const lang = value.language;
  const set = (patch: Partial<ConsentValue>) => onChange({ ...value, ...patch });
  const setPurpose = (k: ConsentPurposeKey, on: boolean) => set({ purposes: { ...value.purposes, [k]: on } });

  return (
    <div className="grid gap-6">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ds-kicker">Notice · {CONSENT_NOTICE_VERSION}</p>
        <LanguageToggle value={lang} onChange={(l) => set({ language: l })} />
      </div>

      <div lang={htmlLang(lang)} className={clsx("grid gap-5 border border-rule bg-surface p-4 sm:p-6", lang === "hi" && "font-deva")}>
        <h3 className="text-2xl leading-snug tracking-[-0.02em]">{consentCopy.title[lang]}</h3>
        <p className="max-w-2xl text-[17px] leading-relaxed">{consentCopy.intro[lang]}</p>
        <ul className="grid divide-y divide-rule border-y border-rule">
          {PURPOSES.map((k, i) => (
            <li key={k} className="py-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-faint">({LETTERS[i]})</span>
                {k === "store" && <Badge tone="setu">{consentCopy.tagRequired[lang]}</Badge>}
              </div>
              <Switch
                label={consentCopy[k].label[lang]}
                description={consentCopy[k].detail[lang]}
                checked={value.purposes[k]}
                onChange={(e) => setPurpose(k, e.target.checked)}
              />
            </li>
          ))}
        </ul>
        {!value.purposes.store && (
          <Notice tone="conflict" title="Keeping and organising the record is required">
            Without it a record cannot be kept. To stop an existing record, use Withdraw consent instead.
          </Notice>
        )}
        {!value.purposes.ai && (
          <p className="text-sm text-muted">AI processing is off: staff will key in facts manually and nothing is sent to an AI provider.</p>
        )}
        <p className="text-[15px] text-muted">{consentCopy.withdraw[lang]}</p>
      </div>

      <ConfirmStep
        value={value}
        onChange={onChange}
        sendCode={sendCode}
        canSendCode={canSendCode}
        contactHint={contactHint}
        printable
      />

      <PrintableNotice />
    </div>
  );
}

/** How a sensitive action is confirmed: a code to someone's phone, or in person with a witness. Shared by every screen. */
export type ConfirmState = Pick<ConsentValue, "method" | "code" | "attest">;
export const EMPTY_CONFIRM: ConfirmState = { method: "otp", code: "", attest: false };

/** The `confirm` object the API expects, or null while incomplete. */
export const confirmOf = (v: ConfirmState) => consentConfirm({ ...DEFAULT_CONSENT, ...v });

export function ConfirmStep<T extends ConfirmState>({
  value,
  onChange,
  sendCode,
  canSendCode,
  contactHint,
  witnessText = "I witnessed this. The notice was handed over or read aloud in a language they understand, and the patient or caregiver acknowledged it in person.",
  printable = false,
}: {
  value: T;
  onChange: (v: T) => void;
  sendCode: () => Promise<string | null>;
  canSendCode: boolean;
  contactHint: string;
  witnessText?: string;
  printable?: boolean;
}) {
  const id = useId();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const change = (patch: Partial<ConfirmState>) => onChange({ ...value, ...patch });

  async function send() {
    setSending(true);
    setSendError(null);
    const err = await sendCode();
    setSending(false);
    if (err) setSendError(err);
    else setSent(true);
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="ds-kicker mb-1">How is this confirmed?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["otp", "witnessed"] as const).map((m) => (
          <label key={m} className={clsx("flex min-h-11 cursor-pointer items-start gap-3 border p-3 has-checked:border-ink has-checked:bg-matte", value.method === m ? "border-ink" : "border-rule")}>
            <input type="radio" name={`${id}-method`} className="mt-1 size-4 accent-obsidian" checked={value.method === m} onChange={() => change({ method: m })} />
            <span className="grid gap-0.5">
              <span className="text-[15px] font-medium">{m === "otp" ? "Code sent by SMS" : "In person, witnessed"}</span>
              <span className="text-sm text-muted">{m === "otp" ? contactHint : "For people without a phone (FR-CON-06). You are recorded as the witness."}</span>
            </span>
          </label>
        ))}
      </div>

      {value.method === "otp" ? (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <Button variant="secondary" className={WRAP} onClick={send} loading={sending} disabled={!canSendCode} icon={<Send aria-hidden />}>
            {sent ? "Send a new code" : "Send code"}
          </Button>
          <Field label="Code from the SMS" hint={sent ? "Sent. Demo: the simulated SMS is in the Demo phone drawer." : undefined} error={sendError}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value.code} onChange={(e) => change({ code: e.target.value.replace(/\D/g, "") })} placeholder="6 digits" />
          </Field>
          {!canSendCode && <p className="text-sm text-muted sm:col-span-2">No phone number is available yet. Enter one first, or use in-person witnessed confirmation.</p>}
        </div>
      ) : (
        <div className="grid gap-3">
          <Checkbox checked={value.attest} onChange={(e) => change({ attest: e.target.checked })} label={witnessText} />
          {printable && (
            <div>
              <Button variant="secondary" className={WRAP} icon={<Printer aria-hidden />} onClick={() => window.print()}>
                Print notice (English and हिन्दी)
              </Button>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Both languages on paper, with space for the acknowledgement. Invisible on screen. */
function PrintableNotice() {
  return (
    <div className="print-area hidden text-[12pt] leading-snug print:block">
      {(["en", "hi"] as const).map((lang) => (
        <section key={lang} lang={lang} className="mb-8 break-inside-avoid">
          <h2 className="text-[16pt] font-semibold">{consentCopy.title[lang]}</h2>
          <p className="mt-2">{consentCopy.intro[lang]}</p>
          <ol className="mt-3 grid gap-3">
            {PURPOSES.map((k, i) => (
              <li key={k}>
                <p className="font-semibold">
                  ({LETTERS[i]}) {consentCopy[k].label[lang]} {k === "store" ? `— ${consentCopy.tagRequired[lang]}` : ""}
                </p>
                <p>{consentCopy[k].detail[lang]}</p>
                <p className="mt-1">
                  ☐ {consentCopy.yes[lang]} &nbsp;&nbsp; ☐ {consentCopy.no[lang]}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-3">{consentCopy.withdraw[lang]}</p>
          <p className="mt-3">{consentCopy.acknowledgement[lang]}</p>
        </section>
      ))}
      <p className="mt-6">Name / नाम: ______________________________ &nbsp; Signature or mark / हस्ताक्षर: ______________________</p>
      <p className="mt-4">Witness / गवाह: ______________________________ &nbsp; Date / तारीख़: ______________</p>
      <p className="mt-4 font-mono text-[9pt]">{CONSENT_NOTICE_VERSION}</p>
    </div>
  );
}
