// Tiny JSON fetch for the Radar-share client components: keeps the server's error code (the UI branches on it).
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message)
  }
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the server')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Request failed (${res.status})`, json ?? {})
  return json as T
}
