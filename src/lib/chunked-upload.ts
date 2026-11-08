// Browser side of chunked uploads (files over the 4.5 MB request limit): start a session, send chunks of at most
// CHUNK_BYTES (resuming any the server already has), then finish. Progress is reported as a percentage of bytes sent.
// The offline capture queue also passes a stored session id, so a reloaded browser carries on where it stopped.
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_ZIP_BYTES, ONE_SHOT_BYTES } from "@/core/limits";

export type ChunkedResult = { status: number; duplicate: boolean; skipped: { name: string; reason: string }[]; code?: string };

export type ChunkedOpts = {
  /** Smaller chunks lose less on a dropped connection (the server accepts 256 KB up to CHUNK_BYTES). */
  chunkBytes?: number;
  /** Extra start fields (clientFileId, intakeRoute, encounterId, clientCapturedAt) and request headers (x-device-id). */
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  /** A session this file started before (kept with a queued item): only the chunks it lacks are sent. */
  sessionId?: string | null;
  /** Called with a new session's id before any chunk is sent, so it can be stored for a resume. */
  onSession?: (id: string) => Promise<void>;
};

/** Largest size allowed for this file name (a ZIP gets the bigger cap). */
export const capFor = (name: string) => (/\.zip$/i.test(name) ? MAX_ZIP_BYTES : MAX_FILE_BYTES);
export const needsChunks = (size: number) => size > ONE_SHOT_BYTES;

export async function sha256Hex(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const codeOf = (body: unknown) => ((body as { error?: { code?: string } } | null)?.error?.code);

function postChunk(url: string, idx: number, part: Blob, headers: Record<string, string>, onSent: (loaded: number) => void): Promise<{ status: number; code?: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("idx", String(idx));
    fd.append("chunk", part, `chunk-${idx}`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onSent(e.loaded);
    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      resolve({ status: xhr.status, code: codeOf(body) });
    };
    xhr.send(fd);
  });
}

const json = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;

/**
 * `base` is /api/p/uploads (patient) or /api/patients/<id>/uploads (staff). Retries each chunk three times; a damaged file
 * (checksum mismatch) is reported as code "checksum_mismatch" so the screen can offer a retry.
 */
export async function uploadChunked(base: string, blob: Blob, fileName: string, onPct: (n: number) => void, opts: ChunkedOpts = {}): Promise<ChunkedResult> {
  const sha256 = await sha256Hex(blob);
  const chunk = opts.chunkBytes ?? CHUNK_BYTES;
  const headers = opts.headers ?? {};
  const totalChunks = Math.max(1, Math.ceil(blob.size / chunk));
  let id = opts.sessionId ?? null;
  let have = new Set<number>();
  if (id) { // resume: an expired, finished or unknown session is simply started again (a finished file answers "done")
    const res = await fetch(`${base}/${id}`, { headers, cache: "no-store" });
    if (res.ok) have = new Set(((await json(res)) as { have?: number[] }).have ?? []);
    else id = null;
  }
  if (!id) {
    const start = await fetch(base, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ...opts.fields, fileName, totalSize: blob.size, totalChunks, sha256 }) });
    const body = await json(start);
    if (!start.ok) return { status: start.status, duplicate: false, skipped: [], code: codeOf(body) };
    if (body.done) { onPct(100); return { status: 200, duplicate: false, skipped: [] }; } // this file arrived before
    id = body.id as string;
    await opts.onSession?.(id);
  }
  let sent = 0;
  for (let i = 0; i < totalChunks; i++) {
    const size = Math.min(chunk, blob.size - i * chunk);
    if (have.has(i)) { sent += size; onPct(Math.round((sent / blob.size) * 100)); continue; }
    const part = blob.slice(i * chunk, i * chunk + size);
    let r: { status: number; code?: string } = { status: 0 };
    for (let attempt = 0; attempt < 3 && r.status !== 200 && (r.status === 0 || r.status >= 500); attempt++) {
      try { r = await postChunk(`${base}/${id}`, i, part, headers, (l) => onPct(Math.round(((sent + l) / blob.size) * 100))); } catch { r = { status: 0 }; }
    }
    if (r.status !== 200) return { status: r.status, duplicate: false, skipped: [], code: r.code ?? "chunk_failed" };
    sent += size;
    onPct(Math.round((sent / blob.size) * 100));
  }
  const fin = await fetch(`${base}/${id}/finish`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
  const body = await json(fin);
  return { status: fin.status, duplicate: !!body.duplicate, skipped: (body.skipped as ChunkedResult["skipped"]) ?? [], code: (body.error as { code?: string } | undefined)?.code };
}
