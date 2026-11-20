"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, ScanLine } from "lucide-react";
import { bodyLabel, fmtDay } from "@/server/records/core";

export type ImagingDetails = {
  label: string; modality: string | null; studyDate: string | null; bodyPart: string | null; institution: string | null
  patientName: string | null; patientSex: string | null; patientAge: string | null; instances: number; frames: number; synthetic: boolean
}

/**
 * A picture of the scan (the middle image first) with the header details as written in the file. Nothing is read from the picture:
 * no findings, no measurements. A slider appears when there is more than one image; the mouse wheel over the picture steps through them.
 * `seriesLabel` names the slider for a screen reader when two studies are side by side; `showNote` is switched off for the second one so
 * the "not interpreted" line appears once; `enlargeHref` adds a "Larger view" link (size only, no tools).
 */
export function ImagingViewer({ documentId, details, canView, compact = false, seriesLabel, showNote = true, enlargeHref }: {
  documentId: string; details: ImagingDetails; canView: boolean; compact?: boolean; seriesLabel?: string; showNote?: boolean; enlargeHref?: string
}) {
  const slices = details.instances > 1 ? details.instances : details.frames;
  const [i, setI] = useState(Math.floor(slices / 2));
  const [failed, setFailed] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  // The wheel steps through the images. A native listener, because React's wheel handler cannot stop the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el || slices <= 1 || !canView) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      setFailed(null);
      setI((v) => Math.min(slices - 1, Math.max(0, v + (e.deltaY > 0 ? 1 : -1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [slices, canView]);
  const rows: [string, string | null][] = [
    ["Type", details.label], ["Study date", details.studyDate ? fmtDay(details.studyDate) : null], ["Body part", bodyLabel(details.bodyPart)], ["Institution", details.institution],
    ["Patient name (as written in the file)", details.patientName], ["Sex", details.patientSex], ["Age", details.patientAge],
    ["Images in this study", slices > 1 ? String(slices) : null],
  ];
  const middle = Math.floor(slices / 2);
  return (
    <div className={compact ? "grid min-w-0 gap-3" : "grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] [&>*]:min-w-0"} data-testid="imaging-viewer">
      <div className="grid content-start gap-3">
        <div ref={frame} className="relative grid min-h-64 place-items-center border border-rule bg-obsidian">
          {canView && !failed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i} src={`/api/documents/${documentId}/preview?frame=${i}`} alt={`Preview picture of ${details.label}, image ${i + 1} of ${slices}`}
              className={compact ? "h-[18rem] w-auto max-w-full object-contain" : "h-[26rem] max-h-[32rem] w-auto max-w-full object-contain"} onError={() => setFailed("Preview not available for this compression — file stored")}
            />
          ) : (
            <p className="flex items-center gap-2 px-4 py-10 text-center text-sm text-gallery"><ScanLine aria-hidden className="size-5" />{failed ?? "Preview not available — file stored"}</p>
          )}
        </div>
        {slices > 1 && canView && (
          <label className="grid gap-1 text-sm">
            <span className="flex justify-between gap-2"><span>Image {i + 1} of {slices}{i === middle ? " (opens on the middle image)" : ""}</span><span className="text-muted">drag or use the mouse wheel</span></span>
            <input type="range" min={0} max={slices - 1} value={i} onChange={(e) => { setFailed(null); setI(Number(e.target.value)); }} aria-label={seriesLabel ?? "Scroll through the images"} data-testid="slice-slider" />
          </label>
        )}
        {enlargeHref && canView && (
          <Link href={enlargeHref} className="inline-flex min-h-9 w-fit items-center gap-1.5 text-sm text-setu-ink underline decoration-brass underline-offset-4">
            <Maximize2 aria-hidden className="size-3.5" />Larger view
          </Link>
        )}
        {showNote && <p className="text-sm text-muted">This is a picture of the file. OncoSetu does not interpret images and shows no findings.</p>}
      </div>
      {compact ? (
        <details className="border border-rule bg-surface p-3 text-[14px]">
          <summary className="cursor-pointer text-sm underline underline-offset-4">Header of the file, as written</summary>
          <Header rows={rows} synthetic={details.synthetic} />
        </details>
      ) : (
        <div className="border border-rule bg-surface p-4 text-[15px]"><p className="ds-kicker mb-2">Header of the file, as written</p><Header rows={rows} synthetic={details.synthetic} /></div>
      )}
    </div>
  );
}

function Header({ rows, synthetic }: { rows: [string, string | null][]; synthetic: boolean }) {
  return (
    <dl className="mt-2 grid content-start gap-2">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="grid gap-0.5"><dt className="ds-kicker">{k}</dt><dd className="break-words">{v}</dd></div>
      ))}
      {synthetic && <p className="mt-1 border border-dashed border-rule px-2 py-1 font-mono text-[11px] tracking-[0.1em] uppercase">Synthetic sample, not a real scan</p>}
    </dl>
  );
}
