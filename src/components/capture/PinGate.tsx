"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Lock } from "lucide-react";
import { Button, Dialog, Field, Frame, Input } from "@/components/ui";
import { PIN_RE, WrongPinError } from "@/lib/offline/crypto";

type Props =
  | { mode: "setup"; onSetup: (pin: string, deviceLabel: string) => Promise<void>; defaultLabel: string }
  | { mode: "locked"; onUnlock: (pin: string) => Promise<void>; onReset: () => Promise<void>; waiting: number };

const pinProps = { type: "password", inputMode: "numeric", pattern: "\\d{6}", maxLength: 6, autoComplete: "off" } as const;

/** First use: choose the 6-digit device PIN. After a reload: enter it. The PIN never leaves the device. */
export function PinGate(props: Props) {
  const [label, setLabel] = useState(props.mode === "setup" ? props.defaultLabel : "");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const setup = props.mode === "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!PIN_RE.test(pin)) return setError("The PIN is exactly 6 digits.");
    if (setup && pin !== again) return setError("The two PINs do not match.");
    setBusy(true);
    try {
      if (props.mode === "setup") await props.onSetup(pin, label.trim() || props.defaultLabel);
      else await props.onUnlock(pin);
    } catch (err) {
      setError(err instanceof WrongPinError ? "Wrong PIN." : "Could not open secure storage on this device.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame matte className="mx-auto max-w-md">
      <form onSubmit={submit} className="grid gap-5 p-5 sm:p-6" noValidate>
        <header className="grid gap-2">
          <p className="ds-kicker flex items-center gap-2">
            {setup ? <KeyRound aria-hidden className="size-4" /> : <Lock aria-hidden className="size-4" />}
            {setup ? "First use on this device" : "Locked"}
          </p>
          <h2 className="text-2xl leading-tight">{setup ? "Set a device PIN" : "Enter your PIN"}</h2>
          <p className="text-[15px] text-muted">
            {setup
              ? "Captures are encrypted on this device with a key protected by this PIN. They stay readable only here, until they sync."
              : props.waiting > 0
                ? `${props.waiting} capture${props.waiting === 1 ? "" : "s"} waiting on this device. Unlock to view and sync.`
                : "Unlock to capture and sync."}
          </p>
        </header>

        {setup && (
          <Field label="Device name" hint="Shown to your administrator, who can switch this device off if it is lost.">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </Field>
        )}
        <Field label={setup ? "6-digit PIN" : "PIN"} error={error}>
          <Input {...pinProps} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus />
        </Field>
        {setup && (
          <Field label="Repeat PIN">
            <Input {...pinProps} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} />
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy} size="lg">
            {setup ? "Set PIN and start" : "Unlock"}
          </Button>
          {!setup && (
            <Button variant="ghost" onClick={() => setResetOpen(true)}>
              Forgot PIN
            </Button>
          )}
        </div>
      </form>

      {props.mode === "locked" && (
        <Dialog
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          title="Reset this device?"
          description={
            props.waiting > 0
              ? `${props.waiting} capture${props.waiting === 1 ? "" : "s"} not yet synced will be deleted. This cannot be undone.`
              : "The saved key and cached patient list are deleted. You will set a new PIN."
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>
                Keep PIN
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await props.onReset();
                  setResetOpen(false);
                }}
              >
                Delete and reset
              </Button>
            </>
          }
        />
      )}
    </Frame>
  );
}
