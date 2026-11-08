"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Notice } from "./status";

export type RecordedNote = { blob: Blob; url: string; seconds: number };

const MAX_SECONDS = 300; // about 1.2 MB at 32 kbit/s: one request, well under the server's 3.5 MB cap
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * An optional spoken note for the visit, queued with the pages and encrypted the same way (FR-OFF-03). Staff hear only the
 * note they have just recorded, before saving; once synced, only Records and Clinicians can play it.
 */
export function AudioNote({ note, setNote }: { note: RecordedNote | null; setNote: (n: RecordedNote | null) => void }) {
  const rec = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "recording" | "unavailable">("idle");
  const [secs, setSecs] = useState(0);

  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSecs(s);
      if (s >= MAX_SECONDS) rec.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [state]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setState("unavailable");
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
      const parts: Blob[] = [];
      const began = Date.now();
      r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.current = null;
        setState("idle");
        const blob = new Blob(parts, { type: (r.mimeType || mimeType || "audio/webm").split(";")[0] });
        if (blob.size) setNote({ blob, url: URL.createObjectURL(blob), seconds: Math.max(1, Math.round((Date.now() - began) / 1000)) });
      };
      rec.current = r;
      r.start(1000);
      setSecs(0);
      setState("recording");
    } catch {
      setState("unavailable"); // denied or no microphone: pages can still be saved
    }
  }

  const discard = () => { if (note) URL.revokeObjectURL(note.url); setNote(null); };

  return (
    <div className="grid gap-3">
      {state === "unavailable" && <Notice tone="unverified" title="The microphone is not available here">Save the pages without a note, or allow the microphone and try again.</Notice>}
      {note ? (
        <div className="flex flex-wrap items-center gap-3">
          <audio controls src={note.url} className="h-9" aria-label="Your audio note, not saved yet" />
          <span className="font-mono text-xs text-muted">{mmss(note.seconds)}</span>
          <Button variant="ghost" size="sm" onClick={discard} icon={<Trash2 aria-hidden />}>Delete note</Button>
        </div>
      ) : state === "recording" ? (
        <Button size="lg" variant="danger" onClick={() => rec.current?.stop()} icon={<Square aria-hidden />}>
          Stop recording · {mmss(secs)}
        </Button>
      ) : (
        <Button size="lg" variant="secondary" onClick={start} loading={state === "starting"} icon={state === "unavailable" ? <MicOff aria-hidden /> : <Mic aria-hidden />}>
          Record audio note
        </Button>
      )}
    </div>
  );
}
