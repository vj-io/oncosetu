"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Camera, CameraOff, KeyRound, Search, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, Checkbox, Field, Frame, Input } from "@/components/ui";
import { postJson } from "./api";
import { ConsentRecorder } from "./ConsentRecorder";
import { Notice } from "./Notice";
import { WRAP } from "./style";

export type DeskHit = { id: string; initials: string; accession: string };
type Mode = "scan" | "phone" | "mrn" | "name";
const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: "scan", label: "Scan QR", placeholder: "Card code, for example ABCD-EFGH-…" },
  { key: "phone", label: "Phone", placeholder: "Mobile number" },
  { key: "mrn", label: "MRN / UHID", placeholder: "MRN or UHID" },
  { key: "name", label: "Name", placeholder: "Full or partial name" },
];

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const detectorCtor = () => (typeof window === "undefined" ? undefined : (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector);

/**
 * Identify, then verify. A scan or lookup shows initials and "verification required" only (FR-ID-02): the record
 * opens after a code sent to the primary contact, or an in-person witnessed consent event.
 */
export function DeskLookup({ preselected }: { preselected?: DeskHit | null }) {
  const [mode, setMode] = useState<Mode>("scan");
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<DeskHit[] | null>(preselected ? [preselected] : null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<DeskHit | null>(preselected ?? null);

  const lookup = useCallback(async (m: Mode, v: string) => {
    if (!v.trim()) return;
    setBusy(true);
    setMessage(null);
    setSelected(null);
    const r = await postJson<{ status: string; results: DeskHit[] }>("/api/desk/lookup", { mode: m === "scan" ? "token" : m, value: v });
    setBusy(false);
    if (!r.ok) { setHits(null); return setMessage(r.message); }
    setHits(r.data.results);
    if (r.data.status === "revoked") setMessage("This card has been revoked. Ask for the replacement card, or look the patient up another way.");
    else if (!r.data.results.length) setMessage("No matching patient in this organisation.");
    else if (r.data.results.length === 1) setSelected(r.data.results[0]);
  }, []);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Frame matte>
        <div className="grid gap-5 p-4 sm:p-6">
          <div role="tablist" aria-label="Look up by" className="flex flex-wrap gap-1 border-b border-rule">
            {MODES.map((m) => (
              <button
                key={m.key} type="button" role="tab" aria-selected={mode === m.key}
                onClick={() => { setMode(m.key); setValue(""); setHits(null); setMessage(null); setSelected(null); }}
                className={clsx("h-11 border-b-2 px-3 text-sm", mode === m.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "scan" && <Scanner onCode={(c) => { setValue(c); lookup("scan", c); }} />}

          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); lookup(mode, value); }}>
            <Field label={mode === "scan" ? "Or type the code printed on the card" : MODES.find((m) => m.key === mode)!.label}>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={MODES.find((m) => m.key === mode)!.placeholder} autoComplete="off" inputMode={mode === "phone" ? "tel" : undefined} />
            </Field>
            <Button type="submit" loading={busy} icon={<Search aria-hidden />}>Look up</Button>
          </form>

          {message && <Notice tone={hits && !hits.length ? "neutral" : "unverified"} title={message} />}

          {hits && hits.length > 0 && (
            <ul aria-label="Matches" className="grid gap-2">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button" onClick={() => setSelected(h)} aria-pressed={selected?.id === h.id}
                    className={clsx("flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-2 border px-4 py-2 text-left hover:bg-spotlight", selected?.id === h.id ? "border-ink bg-matte" : "border-rule")}
                  >
                    <span className="grid size-10 place-items-center border border-rule bg-matte font-display text-lg">{h.initials}</span>
                    <span className="font-mono text-xs tracking-[0.1em] text-faint">ACC. {h.accession}</span>
                    <Badge tone="unverified" className="ml-auto">Verification required</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Frame>

      {selected && <Verification key={selected.id} hit={selected} />}
    </div>
  );
}

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Decided after mount: the server cannot know whether this browser has BarcodeDetector and a camera.
  const supported = useSyncExternalStore(
    () => () => {},
    () => !!detectorCtor() && !!navigator.mediaDevices?.getUserMedia,
    () => null,
  );

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);
    try {
      const Ctor = detectorCtor()!;
      const detector = new Ctor({ formats: ["qr_code"] });
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setOn(true);
      requestAnimationFrame(() => {
        if (!video.current || !stream.current) return;
        video.current.srcObject = stream.current;
        video.current.play().catch(() => {});
      });
      timer.current = setInterval(async () => {
        if (!video.current || video.current.readyState < 2) return;
        const found = await detector.detect(video.current).catch(() => []);
        if (found[0]?.rawValue) { stop(); onCode(found[0].rawValue); }
      }, 300);
    } catch {
      stop();
      setError("The camera could not be opened. Type the code printed on the card instead.");
    }
  }

  if (supported === null) return <div className="h-11" aria-hidden />;
  if (!supported) return <p className="text-sm text-muted">This browser cannot scan QR codes. Type the code printed under the QR on the card.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <Button variant="secondary" className={WRAP} onClick={stop} icon={<CameraOff aria-hidden />}>Stop camera</Button>
        ) : (
          <Button variant="secondary" className={WRAP} onClick={start} icon={<Camera aria-hidden />}>Scan the card with the camera</Button>
        )}
        <p className="text-sm text-muted">Scanning identifies only. It never opens the record.</p>
      </div>
      {on && <video ref={video} muted playsInline aria-label="Camera preview" className="aspect-video w-full max-w-md border border-rule bg-obsidian object-cover" />}
      {error && <p className="text-sm text-madder-ink">{error}</p>}
    </div>
  );
}

function Verification({ hit }: { hit: DeskHit }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState<"send" | "verify" | "witness" | null>(null);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);
  const [needConsent, setNeedConsent] = useState<string | null>(null);

  const done = (data: { patientUrl: string; consentActive: boolean }) => {
    if (data.consentActive) router.push(data.patientUrl);
    else setNeedConsent(data.patientUrl);
  };

  async function send() {
    setBusy("send"); setError(null);
    const r = await postJson("/api/desk/verify/start", { patientId: hit.id });
    setBusy(null);
    if (r.ok) setSent(true);
    else setError({ text: r.message, code: r.code });
  }
  async function verify() {
    setBusy("verify"); setError(null);
    const r = await postJson<{ patientUrl: string; consentActive: boolean }>("/api/desk/verify/code", { patientId: hit.id, code });
    setBusy(null);
    if (r.ok) done(r.data);
    else setError({ text: r.message, code: r.code });
  }
  async function witness() {
    setBusy("witness"); setError(null);
    const r = await postJson<{ patientUrl: string; consentActive: boolean }>("/api/desk/verify/witnessed", { patientId: hit.id, attest: true });
    setBusy(null);
    if (r.ok) done(r.data);
    else setError({ text: r.message, code: r.code });
  }

  if (needConsent) {
    return (
      <Frame matte>
        <div className="grid gap-4 p-4 sm:p-6">
          <Notice title="There is no active consent for this patient">The record stays closed until new consent is recorded. Take it now, then the record opens.</Notice>
          <ConsentRecorder patientId={hit.id} onDone={() => router.push(needConsent)} />
        </div>
      </Frame>
    );
  }

  return (
    <Frame matte>
      <div className="grid gap-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-14 place-items-center border border-rule bg-matte font-display text-2xl shadow-placard">{hit.initials}</span>
          <div className="grid gap-1">
            <p className="ds-kicker">ACC. {hit.accession}</p>
            <Badge tone="unverified" icon={<KeyRound />}>Verification required</Badge>
          </div>
        </div>
        <p className="max-w-2xl text-muted">
          Nothing more is shown until the person is verified. A code is sent to the registered contact (the caregiver when the caregiver is primary).
        </p>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Button variant="secondary" className={WRAP} onClick={send} loading={busy === "send"} icon={<Send aria-hidden />}>{sent ? "Send a new code" : "Send code"}</Button>
          <Field label="Code from the SMS" hint={sent ? "Sent to the registered contact. Demo: see the Demo phone drawer." : undefined}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6 digits" />
          </Field>
          <Button className={WRAP} onClick={verify} loading={busy === "verify"} disabled={code.length < 6} icon={<ShieldCheck aria-hidden />}>Verify and open</Button>
        </div>
        {error && <Notice tone="conflict" title={error.text} />}

        <div className="grid gap-3 border-t border-rule pt-4">
          <p className="ds-kicker">Or in person</p>
          <Checkbox
            checked={attest} onChange={(e) => setAttest(e.target.checked)}
            label="The patient or caregiver is here, I have checked who they are, and they re-confirmed consent in person."
            description="For people without a phone, or when no code arrives. Recorded as a witnessed consent event under your name."
          />
          <div><Button variant="secondary" className={WRAP} disabled={!attest} loading={busy === "witness"} onClick={witness}>Open with witnessed consent</Button></div>
        </div>
      </div>
    </Frame>
  );
}

