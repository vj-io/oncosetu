"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import { EmptyState, Input } from "@/components/ui";
import type { CapturePatient, RecentPatient } from "@/lib/offline/store";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
/** Picker value for "open a new visit for this patient" (the visit id is made on this device when the capture is saved). */
export const NEW_VISIT = "new:";

type Row = { key: string; name: string; mrn: string | null; meta: string };

/**
 * Today's encounters. Online this is the live list; offline it is the encrypted copy saved at the last contact.
 * Records and clinicians also see patients from recent visits, to open a new visit for them even while offline.
 */
export function PatientPicker({
  items, recent = [], value, onChange, source, savedAt,
}: { items: CapturePatient[]; recent?: RecentPatient[]; value: string | null; onChange: (key: string) => void; source: "live" | "cache"; savedAt: number | null }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (p: { name: string; mrn: string | null }) => !needle || p.name.toLowerCase().includes(needle) || (p.mrn ?? "").toLowerCase().includes(needle);
  const age = (a: number | null) => (a != null ? `${a} y` : null);
  const today: Row[] = items.filter(match).map((p) => ({
    key: p.encounterId, name: p.name, mrn: p.mrn,
    meta: [p.mrn ?? "no MRN", age(p.ageYears), `${p.newEncounter ? "new visit" : p.type} · ${time(p.startedAt)}`].filter(Boolean).join(" · "),
  }));
  const fresh: Row[] = recent.filter(match).map((p) => ({
    key: NEW_VISIT + p.patientId, name: p.name, mrn: p.mrn,
    meta: [p.mrn ?? "no MRN", age(p.ageYears), `last visit ${day(p.lastVisitAt)}`].filter(Boolean).join(" · "),
  }));

  if (items.length === 0 && recent.length === 0) {
    return (
      <EmptyState
        title="No encounters to attach to"
        description={source === "cache" ? "This device has no saved patient list yet. Connect once to download today's list." : "Start an encounter for the patient at the desk first, then capture their pages here."}
      />
    );
  }
  const group = (rows: Row[], label: string) => (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {rows.map((p) => {
        const on = p.key === value;
        return (
          <label
            key={p.key}
            className={clsx(
              "flex min-h-14 cursor-pointer items-center gap-3 border bg-matte px-4 py-2.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink",
              on ? "border-ink bg-spotlight" : "border-rule hover:border-control",
            )}
          >
            <input type="radio" name="patient" className="sr-only" checked={on} onChange={() => onChange(p.key)} />
            <span aria-hidden className={clsx("grid size-5 shrink-0 place-items-center border", on ? "border-ink bg-ink text-matte" : "border-control")}>
              {on && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-[15px] font-medium">{p.name}</span>
              <span className="font-mono text-xs tracking-[0.06em] text-faint">{p.meta}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
  return (
    <div className="grid gap-3">
      <Input type="search" placeholder="Search by name or MRN" aria-label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} />
      {source === "cache" && savedAt && (
        <p className="ds-kicker">Saved list from {new Date(savedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
      )}
      {today.length > 0 && group(today, "Patient for this capture")}
      {fresh.length > 0 && (
        <>
          <p className="ds-kicker mt-3">Or open a new visit · seen in the last 30 days</p>
          {group(fresh, "Open a new visit for")}
        </>
      )}
      {today.length === 0 && fresh.length === 0 && <p className="text-sm text-muted">No match for “{q}”.</p>}
    </div>
  );
}
