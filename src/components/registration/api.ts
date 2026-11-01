// Browser-side helper for the registration screens. Same-origin JSON POST; never throws on HTTP errors.
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; data: Record<string, unknown> }

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return { ok: true, status: res.status, data: data as T }
    const err = (data.error ?? {}) as { code?: string; message?: string; issues?: { path: string; message: string }[] }
    const issue = err.issues?.[0]
    return {
      ok: false, status: res.status, code: err.code ?? 'error', data,
      message: issue ? `${issue.path ? `${issue.path}: ` : ''}${issue.message}` : err.message ?? 'Something went wrong. Try again.',
    }
  } catch {
    return { ok: false, status: 0, code: 'network', message: 'Could not reach the server. Check the connection and try again.', data: {} }
  }
}

/** The one-time card token travels from the wizard / reissue to the card page in this tab's sessionStorage only. */
export const cardKey = (patientId: string) => `os:card:${patientId}`
export function stashCardToken(patientId: string, token: string) {
  try { sessionStorage.setItem(cardKey(patientId), token) } catch { /* private mode: the card page offers a reissue */ }
}
