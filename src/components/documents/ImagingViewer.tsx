"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, Pause, Play, ScanLine } from "lucide-react";
import { bodyLabel, fmtDay } from "@/server/records/core";

export type ImagingDetails = {
  label: string; modality: string | null; studyDate: string | null; bodyPart: string | null; institution: string | null
  patientName: string | null; patientSex: string | null; patientAge: string | null; instances: number; frames: number; synthetic: boolean
}

/** CT window presets (names only; the preview route holds the numbers). Other scans keep the window written in the file. */
const CT_WINDOWS = [["", "As in the file"], ["soft", "Soft tissue"], ["lung", "Lung"], ["bone", "Bone"]] as const;
/** Cine: the next image is asked for this long after the current one has arrived (at most four a second). */
const CINE_MS = 250;

/**
 * A picture of the scan (the middle image first) with the header details as written in the file. Nothing is read from the picture:
 * no findings, no measurements. A slider appears when there is more than one image; the mouse wheel over the picture steps through them,
 * and Play steps through them on its own, stopping at the last one. A CT can be shown with a soft-tissue, lung or bone window.
 * `seriesLabel` names the slider for a screen reader when two studies are side by side; `showNote` is switched off for the second one so
 * the "not interpreted" line appears once; `enlargeHref` adds a "Larger view" link (size only, no tools).
 */
export function ImagingViewer({ documentId, details, canView, compact = false, seriesLabel, showNote = true, enlargeHref }: {
  documentId: string; details: ImagingDetails; canView: boolean; compact?: boolean; seriesLabel?: string; showNote?: boolean; enlargeHref?: string
}) {
  const slices = details.instances > 1 ? details.instances : details.frames;
  const [i, setI] = useState(Math.floor(slices / 2));
  const [failed, setFailed] = useState<string | null>(null);
  const [win, setWin] = useState<(typeof CT_WINDOWS)[number][0]>("");
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(-1); // the image on screen, so cine never runs ahead of the server
  const ct = details.modality === "CT" || details.modality === "PET-CT";
  const running = playing && i < slices - 1;
  useEffect(() => {
    if (!running || shown !== i) return;
    const t = setTimeout(() => setI((v) => Math.min(slices - 1, v + 1)), CINE_MS);
    return () => clearTimeout(t);
  }, [running, shown, i, slices]);
  const play = () => {
    if (running) { setPlaying(false); return; }
    setFailed(null);
    if (i >= slices - 1) setI(0);
    setPlaying(true);
  };
  const frame = useRef<HTMLDivElement>(null);
  // The wheel steps through the images. A native listener, because React's wheel handler cannot stop the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el || slices <= 1 || !canView) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      setFailed(null);
      setPlaying(false);
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
              src={`/api/documents/${documentId}/preview?frame=${i}${win ? `&window=${win}` : ""}`} alt={`Preview picture of ${details.label}, image ${i + 1} of ${slices}`}
              className={compact ? "h-[18rem] w-auto max-w-full object-contain" : "h-[26rem] max-h-[32rem] w-auto max-w-full object-contain"}
              onLoad={() => setShown(i)} onError={() => { setPlaying(false); setFailed("Preview not available for this compression — file stored"); }}
            />
          ) : (
            <p className="flex items-center gap-2 px-4 py-10 text-center text-sm text-gallery"><ScanLine aria-hidden className="size-5" />{failed ?? "Preview not available — file stored"}</p>
          )}
        </div>
        {slices > 1 && canView && (
          <label className="grid gap-1 text-sm">
            <span className="flex justify-between gap-2"><span>Image {i + 1} of {slices}{i === middle ? " (opens on the middle image)" : ""}</span><span className="text-muted">drag or use the mouse wheel</span></span>
            <input type="range" min={0} max={slices - 1} value={i} onChange={(e) => { setFailed(null); setPlaying(false); setI(Number(e.target.value)); }} aria-label={seriesLabel ?? "Scroll through the images"} data-testid="slice-slider" />
          </label>
        )}
        {canView && (slices > 1 || ct) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {slices > 1 && (
              <button type="button" onClick={play} aria-pressed={running} className="inline-flex min-h-9 items-center gap-1.5 border border-rule px-3 rounded-md" data-testid="cine-toggle">
                {running ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}{running ? "Pause" : "Play through the images"}
              </button>
            )}
            {ct && (
              <div role="group" aria-label="Window (brightness and contrast) for CT" className="flex flex-wrap items-center gap-1.5" data-testid="window-presets">
                <span className="text-muted">Window:</span>
                {CT_WINDOWS.map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={win === key} onClick={() => { setFailed(null); setWin(key); }}
                    className={`min-h-9 border px-2.5 ${win === key ? "border-setu-ink bg-surface font-medium" : "border-rule"} rounded-md`}>{label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {enlargeHref && canView && (
          <Link href={enlargeHref} className="inline-flex min-h-9 w-fit items-center gap-1.5 text-sm text-setu-ink underline decoration-link underline-offset-4">
            <Maximize2 aria-hidden className="size-3.5" />Larger view
          </Link>
        )}
        {showNote && <p className="text-sm text-muted">This is a picture of the file. OncoSetu does not interpret images and shows no findings.</p>}
      </div>
      {compact ? (
        <details className="border border-rule bg-surface p-3 text-[14px] rounded-lg">
          <summary className="cursor-pointer text-sm underline underline-offset-4">Header of the file, as written</summary>
          <Header rows={rows} synthetic={details.synthetic} />
        </details>
      ) : (
        <div className="border border-rule bg-surface p-4 text-[15px] rounded-lg"><p className="ds-kicker mb-2">Header of the file, as written</p><Header rows={rows} synthetic={details.synthetic} /></div>
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
      {synthetic && <p className="mt-1 border border-dashed border-rule px-2 py-1 text-[13px] font-medium rounded-md">Synthetic sample, not a real scan</p>}
    </dl>
  );
}
