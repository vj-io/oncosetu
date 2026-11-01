"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Clock, LoaderCircle, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Button, EmptyState, Placard, type Tone } from "@/components/ui";
import { QUEUE_ALERT_MS, type CaptureMeta, type CaptureState } from "@/lib/offline/queue-state";
import { openCapturePatient } from "@/lib/offline/store";

const STATE: Record<CaptureState, { label: string; tone: Tone; icon: React.ReactNode }> = {
  pending: { label: "Pending", tone: "shadow", icon: <Clock /> },
  syncing: { label: "Syncing", tone: "setu", icon: <LoaderCircle className="ds-spin" /> },
  failed: { label: "Failed", tone: "conflict", icon: <TriangleAlert /> },
  synced: { label: "Synced", tone: "verified", icon: <CircleCheck /> },
};

const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function why(c: CaptureMeta): string | null {
  if (c.state !== "failed") return null;
  const retry = c.nextAttemptAt ? ` Retrying automatically around ${hhmm(c.nextAttemptAt)}.` : "";
  if (c.lastError === "network") return `No connection to the server.${retry}`;
  if (c.lastError === "unreadable") return "This capture could not be decrypted on this device. Discard it and capture again.";
  if (c.lastError === "http_403") return "The server refused this upload (consent or access). Check the patient's consent, then retry.";
  if (c.lastError === "http_404") return "The patient or encounter was not found. Discard and capture again.";
  return `Upload failed (${c.lastError ?? "error"}).${retry || " Retry when ready."}`;
}

export function QueuePanel({
  caps, now, unlocked, getKey, onRetry, onDiscard,
}: { caps: CaptureMeta[]; now: number; unlocked: boolean; getKey: () => CryptoKey | null; onRetry: (c: CaptureMeta) => void; onDiscard: (c: CaptureMeta) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});

  // Patient names are ciphertext at rest: decrypted only while unlocked, only in memory (the parent remounts this on lock).
  useEffect(() => {
    const key = getKey();
    if (!unlocked || !key) return;
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const c of caps) {
        try { const p = await openCapturePatient(key, c.id); out[c.id] = `${p.name}${p.mrn ? ` · ${p.mrn}` : ""}`; } catch { out[c.id] = "Unreadable capture"; }
      }
      if (alive) setNames(out);
    })();
    return () => { alive = false; };
  }, [caps, unlocked, getKey]);

  return (
    <Placard kicker="Queue · this device" title="Waiting to sync" what="Encrypted captures not yet confirmed by the server" footer={<span className="ds-kicker">{caps.length} item{caps.length === 1 ? "" : "s"}</span>}>
      {caps.length === 0 ? (
        <EmptyState className="border-0 px-0 py-6" title="Nothing waiting" description="Captures leave this device as soon as the server confirms them." />
      ) : (
        <ul className="grid gap-4" aria-label="Queued captures">
          {caps.map((c) => {
            const s = STATE[c.state];
            const age = now - c.capturedAt;
            return (
              <li key={c.id} className="grid gap-2 border-t border-rule pt-3 first:border-t-0 first:pt-0" data-state={c.state}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
                  {age >= QUEUE_ALERT_MS && <Badge tone="unverified" icon={<Clock />}>Waiting {Math.floor(age / 3600_000)} h</Badge>}
                  <span className="ml-auto font-mono text-xs text-faint">{c.pageCount} page{c.pageCount === 1 ? "" : "s"} · {hhmm(c.capturedAt)}</span>
                </div>
                <p className="text-[15px] break-words text-ink">{unlocked ? (names[c.id] ?? "…") : "Locked · unlock to view"}</p>
                {why(c) && <p className="text-sm text-muted">{why(c)}</p>}
                {(c.state === "failed" || c.state === "pending") && (
                  <div className="flex flex-wrap gap-2">
                    {c.state === "failed" && <Button size="sm" variant="secondary" onClick={() => onRetry(c)} icon={<RefreshCw aria-hidden />}>Retry now</Button>}
                    <Button size="sm" variant="ghost" onClick={() => onDiscard(c)} icon={<Trash2 aria-hidden />}>Discard</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Placard>
  );
}
