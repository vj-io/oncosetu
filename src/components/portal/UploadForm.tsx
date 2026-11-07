"use client";

import type { Lang } from "@/core/types";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CircleCheck, FileText, Images, LoaderCircle, RotateCw, X } from "lucide-react";
import { ONE_SHOT_BYTES } from "@/core/limits";
import { capFor, needsChunks, uploadChunked } from "@/lib/chunked-upload";
import { tp } from "@/i18n/patient";
import { ErrorNote, PButton, PLink } from "./ui";

const MAX_BYTES = ONE_SHOT_BYTES; // a request body is capped at 4.5 MB; bigger files go in chunks
const MAX_SIDE = 2400;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
// The server sniffs every file by its content; this only stops obvious mistakes. DICOM files often have no extension at all.
const BAD_EXT = new Set(["exe", "dll", "bat", "cmd", "msi", "js", "html", "htm", "svg", "apk", "sh", "scr", "com", "jar"]);

type State = "waiting" | "preparing" | "uploading" | "done" | "duplicate" | "failed" | "tooLarge" | "badType";
type Item = { id: string; file: File; clientFileId: string; state: State; pct: number; blob?: Blob; name: string };

const typeOf = (f: File) => f.type || "";
const extOf = (f: File) => (f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "");

/** Photos become JPEG ≤ 2400px (EXIF rotation applied, metadata dropped) and ≤ 4 MB; PDFs are sent as they are. */
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const c = canvas.getContext("2d");
  if (!c) throw new Error("no canvas");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("too large");
}

function send(blob: Blob, name: string, clientFileId: string, onPct: (n: number) => void): Promise<{ status: number; duplicate: boolean }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", blob, name);
    fd.append("clientFileId", clientFileId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/p/documents");
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      let duplicate = false;
      try {
        duplicate = !!JSON.parse(xhr.responseText).duplicate;
      } catch { /* not JSON: leave false */ }
      resolve({ status: xhr.status, duplicate });
    };
    xhr.send(fd);
  });
}

export function UploadForm({ lang, canStore }: { lang: Lang; canStore: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [paused, setPaused] = useState(!canStore);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);

  const patch = useCallback((id: string, p: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((i) => (i.id === id ? { ...i, ...p } : i));
    setItems(itemsRef.current);
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    for (;;) {
      const next = itemsRef.current.find((i) => i.state === "waiting");
      if (!next) break;
      const type = typeOf(next.file);
      if (BAD_EXT.has(extOf(next.file))) { patch(next.id, { state: "badType" }); continue; }
      patch(next.id, { state: "preparing" });
      let blob: Blob | undefined = next.blob;
      let name = next.file.name;
      if (!blob) {
        if (PHOTO_TYPES.has(type)) {
          try {
            blob = await toJpeg(next.file);
            name = `${name.replace(/\.[^.]+$/, "") || "photo"}.jpg`;
          } catch {
            blob = next.file; // e.g. HEIC the browser cannot decode: send as is (the server converts it)
          }
        } else blob = next.file;
        if (!blob || blob.size > capFor(next.file.name)) { patch(next.id, { state: "tooLarge" }); continue; }
        patch(next.id, { blob, name });
      } else name = next.name;
      patch(next.id, { state: "uploading", pct: 0 });
      try {
        const res = needsChunks(blob.size)
          ? await uploadChunked("/api/p/uploads", blob, name, (pct) => patch(next.id, { pct }))
          : await send(blob, name, next.clientFileId, (pct) => patch(next.id, { pct }));
        if (res.status === 200) patch(next.id, { state: res.duplicate ? "duplicate" : "done", pct: 100 });
        else if (res.status === 401) { router.replace(`/p/login?lang=${lang}`); break; }
        else if (res.status === 403) { setPaused(true); patch(next.id, { state: "failed" }); }
        else patch(next.id, { state: res.status === 413 ? "tooLarge" : res.status === 415 ? "badType" : "failed" });
      } catch {
        patch(next.id, { state: "failed" });
        setError(tp(lang, "offlineError"));
      }
    }
    running.current = false;
  }, [lang, patch, router]);

  useEffect(() => () => { running.current = false; }, []);

  function add(list: FileList | null) {
    if (!list?.length || paused) return;
    setError(null);
    const added: Item[] = [...list].map((file) => ({
      id: crypto.randomUUID(), clientFileId: crypto.randomUUID(), file, name: file.name, state: "waiting", pct: 0,
    }));
    itemsRef.current = [...itemsRef.current, ...added];
    setItems(itemsRef.current);
    void run();
  }

  const retry = (id: string) => { setError(null); patch(id, { state: "waiting" }); void run(); };
  const remove = (id: string) => { itemsRef.current = itemsRef.current.filter((i) => i.id !== id); setItems(itemsRef.current); };

  const busy = items.some((i) => ["waiting", "preparing", "uploading"].includes(i.state));
  const received = items.some((i) => i.state === "done" || i.state === "duplicate");

  return (
    <div className="mt-8 grid gap-6">
      {paused && (
        <div role="note" className="grid gap-3 border border-amber bg-amber-tint px-4 py-4 text-[15px] text-amber-ink">
          <p>{tp(lang, "uploadPaused")}</p>
          <PLink href={`/p/consent?lang=${lang}`} variant="secondary" big className="w-full sm:w-auto">
            {tp(lang, "goToConsent")}
          </PLink>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <PButton big icon={<Camera />} disabled={paused} onClick={() => cam.current?.click()} className="min-h-16 w-full">
          {tp(lang, "takePhoto")}
        </PButton>
        <PButton big variant="secondary" icon={<Images />} disabled={paused} onClick={() => pick.current?.click()} className="min-h-16 w-full">
          {tp(lang, "chooseFiles")}
        </PButton>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={pick} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      <p className="text-[15px] text-muted">{tp(lang, "uploadKeepNote")}</p>

      {error && <ErrorNote>{error}</ErrorNote>}

      {items.length > 0 && (
        <ul className="grid gap-2" aria-label={tp(lang, "navUpload")}>
          {items.map((i) => (
            <li key={i.id} className="grid gap-2 border border-rule bg-surface px-4 py-3">
              <div className="flex items-start gap-3">
                <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 break-words text-[15px]">{i.file.name}</span>
                {(i.state === "failed" || i.state === "tooLarge" || i.state === "badType" || i.state === "done" || i.state === "duplicate") && (
                  <button type="button" onClick={() => remove(i.id)} aria-label={tp(lang, "remove")} className="-m-2 grid size-11 shrink-0 place-items-center hover:bg-spotlight">
                    <X aria-hidden className="size-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]" aria-live="polite">
                {i.state === "waiting" && <span className="text-muted">{tp(lang, "fileWaiting")}</span>}
                {i.state === "preparing" && <span className="inline-flex items-center gap-2 text-muted"><LoaderCircle aria-hidden className="ds-spin size-4" />{tp(lang, "filePreparing")}</span>}
                {i.state === "uploading" && <span className="text-muted">{tp(lang, "fileUploading", { pct: i.pct })}</span>}
                {(i.state === "done" || i.state === "duplicate") && (
                  <span className="inline-flex items-center gap-2 text-sage-ink"><CircleCheck aria-hidden className="size-4" />{tp(lang, i.state === "done" ? "fileDone" : "fileDuplicate")}</span>
                )}
                {i.state === "failed" && (
                  <>
                    <span className="text-madder-ink">{tp(lang, "fileFailed")}</span>
                    <button type="button" onClick={() => retry(i.id)} className="inline-flex h-11 items-center gap-1.5 underline underline-offset-4"><RotateCw aria-hidden className="size-4" />{tp(lang, "retry")}</button>
                  </>
                )}
                {i.state === "tooLarge" && <span className="text-madder-ink">{tp(lang, "fileTooLarge")}</span>}
                {i.state === "badType" && <span className="text-madder-ink">{tp(lang, "fileBadType")}</span>}
              </div>
              {i.state === "uploading" && (
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.pct} aria-label={i.file.name} className="h-2 border border-rule bg-alcove">
                  <div className="h-full bg-setu transition-[width] duration-200" style={{ width: `${i.pct}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {busy && <p role="status" className="text-[15px] text-muted">{tp(lang, "uploadSending")}</p>}
      {!busy && received && (
        <div role="status" className="grid gap-3 border border-sage bg-sage-tint px-4 py-4">
          <p className="flex items-start gap-2 text-[17px] text-sage-ink"><CircleCheck aria-hidden className="mt-1 size-5 shrink-0" />{tp(lang, "uploadReceived")}</p>
          <div className="flex flex-wrap gap-3">
            <PButton variant="secondary" onClick={() => cam.current?.click()}>{tp(lang, "uploadAddMore")}</PButton>
            <Link href={`/p?lang=${lang}`} className="inline-flex h-11 items-center underline underline-offset-4">{tp(lang, "backHome")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
