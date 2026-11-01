// Tiny JSON POST helper for the ledger's client components.
export type ApiResult<T = Record<string, unknown>> = { ok: boolean; status: number; data: T & { error?: { code: string; message: string } } }

export async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: { code: 'network', message: 'Network error. Nothing was saved; try again.' } } as ApiResult<T>['data'] }
  }
}
