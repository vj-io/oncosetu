"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";

export type ImagingDetails = {
  label: string; modality: string | null; studyDate: string | null; bodyPart: string | null; institution: string | null
  patientName: string | null; patientSex: string | null; patientAge: string | null; instances: number; frames: number; synthetic: boolean
}

/**
 * A picture of the scan (the middle slice first) with the header details as written in the file. Nothing is read from the
 * picture: no findings, no measurements. A slider appears when there is more than one image.
 */
export function ImagingViewer({ documentId, details, canView }: { documentId: string; details: ImagingDetails; canView: boolean }) {
  const slices = details.instances > 1 ? details.instances : details.frames;
  const [i, setI] = useState(Math.floor(slices / 2));
  const [failed, setFailed] = useState<string | null>(null);
  const rows: [string, string | null][] = [
    ["Type", details.label], ["Study date", details.studyDate], ["Body part", details.bodyPart], ["Institution", details.institution],
    ["Patient name (as written in the file)", details.patientName], ["Sex", details.patientSex], ["Age", details.patientAge],
    ["Images in this study", slices > 1 ? String(slices) : null],
  ];
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" data-testid="imaging-viewer">
      <div className="grid content-start gap-3">
        <div className="relative grid min-h-64 place-items-center border border-rule bg-obsidian">
          {canView && !failed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i} src={`/api/documents/${documentId}/preview?frame=${i}`} alt={`Preview picture of ${details.label}, image ${i + 1} of ${slices}`}
              className="h-[26rem] max-h-[32rem] w-auto max-w-full object-contain" onError={() => setFailed("Preview not available for this compression — file stored")}
            />
          ) : (
            <p className="flex items-center gap-2 px-4 py-10 text-center text-sm text-gallery"><ScanLine aria-hidden className="size-5" />{failed ?? "Preview not available — file stored"}</p>
          )}
        </div>
        {slices > 1 && canView && (
          <label className="grid gap-1 text-sm">
            <span className="flex justify-between"><span>Image {i + 1} of {slices}</span><span className="text-muted">drag to scroll through the study</span></span>
            <input type="range" min={0} max={slices - 1} value={i} onChange={(e) => { setFailed(null); setI(Number(e.target.value)); }} aria-label="Scroll through the images" data-testid="slice-slider" />
          </label>
        )}
        <p className="text-sm font-medium" data-testid="imaging-note">Imaging file — stored, not read</p>
        <p className="text-sm text-muted">This is a picture of the file. OncoSetu does not interpret images and shows no findings.</p>
      </div>
      <dl className="grid content-start gap-2 border border-rule bg-surface p-4 text-[15px]">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="grid gap-0.5"><dt className="ds-kicker">{k}</dt><dd>{v}</dd></div>
        ))}
        {details.synthetic && <p className="mt-1 border border-dashed border-rule px-2 py-1 font-mono text-[11px] tracking-[0.1em] uppercase">Synthetic sample, not a real scan</p>}
      </dl>
    </div>
  );
}
