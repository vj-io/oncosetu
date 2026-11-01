"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import { EmptyState, Input } from "@/components/ui";
import type { CapturePatient } from "@/lib/offline/store";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Today's encounters. Online this is the live list; offline it is the encrypted copy saved at the last contact. */
export function PatientPicker({
  items, value, onChange, source, savedAt,
}: { items: CapturePatient[]; value: string | null; onChange: (encounterId: string) => void; source: "live" | "cache"; savedAt: number | null }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((p) => p.name.toLowerCase().includes(needle) || (p.mrn ?? "").toLowerCase().includes(needle)) : items;

  if (items.length === 0) {
    return (
      <EmptyState
        title="No encounters to attach to"
        description={source === "cache" ? "This device has no saved patient list yet. Connect once to download today's list." : "Start an encounter for the patient at the desk first, then capture their pages here."}
      />
    );
  }
  return (
    <div className="grid gap-3">
      <Input type="search" placeholder="Search by name or MRN" aria-label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} />
      {source === "cache" && savedAt && (
        <p className="ds-kicker">Saved list from {new Date(savedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
      )}
      <div role="radiogroup" aria-label="Patient for this capture" className="grid gap-2">
        {shown.map((p) => {
          const on = p.encounterId === value;
          return (
            <label
              key={p.encounterId}
              className={clsx(
                "flex min-h-14 cursor-pointer items-center gap-3 border bg-matte px-4 py-2.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink",
                on ? "border-ink bg-spotlight" : "border-rule hover:border-control",
              )}
            >
              <input type="radio" name="patient" className="sr-only" checked={on} onChange={() => onChange(p.encounterId)} />
              <span aria-hidden className={clsx("grid size-5 shrink-0 place-items-center border", on ? "border-ink bg-ink text-matte" : "border-control")}>
                {on && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[15px] font-medium">{p.name}</span>
                <span className="font-mono text-xs tracking-[0.06em] text-faint">
                  {[p.mrn ?? "no MRN", p.ageYears != null ? `${p.ageYears} y` : null, `${p.type} · ${time(p.startedAt)}`].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
        {shown.length === 0 && <p className="text-sm text-muted">No match for “{q}”.</p>}
      </div>
    </div>
  );
}
