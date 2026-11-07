// Browser side of chunked uploads (files over the 4.5 MB request limit): start a session, send chunks of at most
// CHUNK_BYTES (resuming any the server already has), then finish. Progress is reported as a percentage of bytes sent.
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_ZIP_BYTES, ONE_SHOT_BYTES } from "@/core/limits";

export type ChunkedResult = { status: number; duplicate: boolean; skipped: { name: string; reason: string }[]; code?: string };

/** Largest size allowed for this file name (a ZIP gets the bigger cap). */
export const capFor = (name: string) => (/\.zip$/i.test(name) ? MAX_ZIP_BYTES : MAX_FILE_BYTES);
export const needsChunks = (size: number) => size > ONE_SHOT_BYTES;

export async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function postChunk(url: string, idx: number, part: Blob, onSent: (loaded: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("idx", String(idx));
    fd.append("chunk", part, `chunk-${idx}`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onSent(e.loaded);
    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => resolve(xhr.status);
    xhr.send(fd);
  });
}

const json = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;

/**
 * `base` is /api/p/uploads (patient) or /api/patients/<id>/uploads (staff). Retries each chunk three times; a damaged file
 * (checksum mismatch) is reported as code "checksum_mismatch" so the screen can offer a retry.
 */
export async function uploadChunked(base: string, blob: Blob, fileName: string, onPct: (n: number) => void): Promise<ChunkedResult> {
  const sha256 = await sha256Hex(blob);
  const totalChunks = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));
  const start = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName, totalSize: blob.size, totalChunks, sha256 }) });
  if (!start.ok) return { status: start.status, duplicate: false, skipped: [], code: ((await json(start)).error as { code?: string } | undefined)?.code };
  const { id } = (await json(start)) as { id: string };
  const have = new Set<number>(((await json(await fetch(`${base}/${id}`))) as { have?: number[] }).have ?? []);
  let sent = 0;
  for (let i = 0; i < totalChunks; i++) {
    const size = Math.min(CHUNK_BYTES, blob.size - i * CHUNK_BYTES);
    if (have.has(i)) { sent += size; onPct(Math.round((sent / blob.size) * 100)); continue; }
    const part = blob.slice(i * CHUNK_BYTES, i * CHUNK_BYTES + size);
    let status = 0;
    for (let attempt = 0; attempt < 3 && status !== 200; attempt++) {
      try { status = await postChunk(`${base}/${id}`, i, part, (l) => onPct(Math.round(((sent + l) / blob.size) * 100))); } catch { status = 0; }
    }
    if (status !== 200) return { status: status || 0, duplicate: false, skipped: [], code: "chunk_failed" };
    sent += size;
    onPct(Math.round((sent / blob.size) * 100));
  }
  const fin = await fetch(`${base}/${id}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await json(fin);
  return { status: fin.status, duplicate: !!body.duplicate, skipped: (body.skipped as ChunkedResult["skipped"]) ?? [], code: (body.error as { code?: string } | undefined)?.code };
}
