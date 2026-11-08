"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Camera, CameraOff, Crop, ImagePlus, RefreshCw, Trash2, X } from "lucide-react";
import { Badge, Button, EmptyState, Frame } from "@/components/ui";
import { pageFromFile, pageFromSource, revokePage, switchCrop, type CapturedPage } from "@/lib/offline/image";
import { ISSUE_TEXT } from "@/lib/offline/quality";
import { Notice } from "./status";

type Camera = "off" | "starting" | "on" | "unavailable";

/** Multi-page capture: rear camera (or the file picker), a quality check per page, cut to the page edges, retake, reorder, delete. */
export function PageCapture({ pages, setPages }: { pages: CapturedPage[]; setPages: React.Dispatch<React.SetStateAction<CapturedPage[]>> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<Camera>("off");
  const [busy, setBusy] = useState(false);
  const [retakeId, setRetakeId] = useState<string | null>(null); // the next capture replaces this page
  const [promptId, setPromptId] = useState<string | null>(null); // page whose quality check just failed
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera("off");
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamera("on");
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (v) { v.srcObject = stream; void v.play(); }
      });
    } catch {
      setCamera("unavailable"); // denied, no camera, or insecure context: the file picker still works
    }
  }

  /** Append the pages, or let the first one replace the page being retaken. */
  function accept(added: CapturedPage[]) {
    setPages((cur) => {
      let next = [...cur];
      const rest = [...added];
      if (retakeId) {
        const i = next.findIndex((p) => p.id === retakeId);
        const first = rest.shift();
        if (i >= 0 && first) { revokePage(next[i]); next[i] = first; } else if (first) next.push(first);
      }
      next = [...next, ...rest];
      return next;
    });
    setRetakeId(null);
    const bad = added.find((p) => !p.quality.ok);
    setPromptId(bad?.id ?? null);
  }

  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      accept([await pageFromSource(v, v.videoWidth, v.videoHeight)]);
    } catch {
      setError("Could not take that picture. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: CapturedPage[] = [];
    let failed = 0;
    for (const f of [...files]) {
      try { added.push(await pageFromFile(f)); } catch { failed++; }
    }
    if (added.length) accept(added);
    if (failed) setError(`${failed} file${failed === 1 ? "" : "s"} could not be read as a photo (use JPEG or PNG).`);
    setBusy(false);
  }

  const move = (from: number, to: number) =>
    setPages((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur;
      const next = [...cur];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  const remove = (id: string) => {
    const p = pages.find((x) => x.id === id);
    if (p) revokePage(p);
    setPages((cur) => cur.filter((x) => x.id !== id));
  };
  const toggleCrop = (id: string) => setPages((cur) => cur.map((x) => (x.id === id ? switchCrop(x) : x)));

  const flagged = pages.find((p) => p.id === promptId);
  const flaggedNo = flagged ? pages.indexOf(flagged) + 1 : 0;

  return (
    <div className="grid gap-5">
      <Frame matte caption={camera === "on" ? "Rear camera · fit the whole page in the frame" : "Camera"}>
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-alcove">
          <video ref={videoRef} playsInline muted aria-label="Camera preview" className={clsx("size-full object-contain", camera !== "on" && "hidden")} />
          {camera !== "on" && (
            <div className="grid justify-items-center gap-3 p-6 text-center">
              {camera === "unavailable" ? <CameraOff aria-hidden className="size-8 text-faint" strokeWidth={1.25} /> : <Camera aria-hidden className="size-8 text-faint" strokeWidth={1.25} />}
              <p className="max-w-xs text-[15px] text-muted">
                {camera === "unavailable" ? "The camera is not available here. Use the file picker to add photos." : "Open the camera to photograph each page, or add photos from the file picker."}
              </p>
            </div>
          )}
          {retakeId && camera === "on" && (
            <p className="absolute top-3 left-3 bg-obsidian px-2.5 py-1.5 font-mono text-[11px] tracking-[0.12em] text-gallery uppercase">
              Retaking page {pages.findIndex((p) => p.id === retakeId) + 1}
            </p>
          )}
        </div>
      </Frame>

      <div className="flex flex-wrap gap-3">
        {camera === "on" ? (
          <>
            <Button size="lg" onClick={snap} loading={busy} icon={<Camera aria-hidden />}>
              Capture page
            </Button>
            <Button variant="secondary" size="lg" onClick={stopCamera} icon={<X aria-hidden />}>
              Close camera
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={startCamera} loading={camera === "starting"} disabled={camera === "unavailable"} icon={<Camera aria-hidden />}>
            Open camera
          </Button>
        )}
        <label className={clsx("relative inline-flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-xs border border-obsidian px-7 font-mono text-[13px] font-medium tracking-[0.14em] whitespace-nowrap uppercase hover:bg-spotlight has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink", busy && "pointer-events-none opacity-45")}>
          <ImagePlus aria-hidden className="size-4" />
          Add photos
          <input type="file" accept="image/*" multiple data-testid="page-file-input" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      {error && <Notice tone="conflict" title={error} />}

      {flagged && (
        <Notice
          tone="unverified"
          title={`Page ${flaggedNo} may be hard to read`}
          action={
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { setRetakeId(flagged.id); setPromptId(null); if (camera === "off") void startCamera(); }} icon={<RefreshCw aria-hidden />}>
                Retake
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPromptId(null)}>
                Keep anyway
              </Button>
            </span>
          }
        >
          {flagged.quality.issues.map((i) => ISSUE_TEXT[i]).join(" ")}
        </Notice>
      )}

      {pages.length === 0 ? (
        <EmptyState title="No pages yet" description="Photograph each page in order. You can reorder them before saving." />
      ) : (
        <ol aria-label="Captured pages" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              onDragEnd={() => setDragFrom(null)}
              className={clsx("grid gap-2", dragFrom === i && "opacity-50")}
            >
              <Frame caption={`Page ${i + 1}`} className={clsx("aspect-[3/4] cursor-grab overflow-hidden", retakeId === p.id && "outline-2 outline-ink")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Page ${i + 1}`} draggable={false} className="size-full object-contain" />
              </Frame>
              {!p.quality.ok && (
                <Badge tone="unverified" className="justify-self-start">
                  Check: {p.quality.issues.map((q) => q.replace("_", " ")).join(", ")}
                </Badge>
              )}
              {p.alt && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.cropped ? "verified" : "shadow"} icon={<Crop />}>{p.cropped ? "Cut to the page" : "Full photo"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => toggleCrop(p.id)} aria-label={`${p.cropped ? "Use the full photo" : "Use the cut page"} for page ${i + 1}`}>
                    {p.cropped ? "Use full photo" : "Use cut page"}
                  </Button>
                </div>
              )}
              <div className="flex" role="group" aria-label={`Page ${i + 1} actions`}>
                <Button variant="ghost" className="w-10 px-0!" aria-label={`Move page ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)} icon={<ArrowLeft aria-hidden />} />
                <Button variant="ghost" className="w-10 px-0!" aria-label={`Move page ${i + 1} later`} disabled={i === pages.length - 1} onClick={() => move(i, i + 1)} icon={<ArrowRight aria-hidden />} />
                <Button variant="ghost" className="w-10 px-0!" aria-label={`Retake page ${i + 1}`} onClick={() => { setRetakeId(p.id); if (camera === "off") void startCamera(); }} icon={<RefreshCw aria-hidden />} />
                <Button variant="ghost" className="w-10 px-0!" aria-label={`Delete page ${i + 1}`} onClick={() => remove(p.id)} icon={<Trash2 aria-hidden />} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
