// Drawn PDF pages, kept in this browser tab while a file is being viewed. Without it, switching Page → Words → Page, a
// remount, or each report section of one file downloaded the whole original again (an audit row and a decrypt on the
// server every time) and redrew every page with PDF.js. Memory only: never browser storage, and the file route stays
// `no-store`. A file is kept for one viewing (the 30 minutes the server's audit counts as one, VIEWING_MS in
// src/server/audit.ts), at most MAX_FILES at once, and everything is dropped at sign-out (clearDrawnPages).
type PDFDocumentProxy = Awaited<ReturnType<typeof import('unpdf')['getDocumentProxy']>>

export const KEEP_MS = 30 * 60_000
export const MAX_FILES = 3

type Pdf = { numPages: number; destroy?: () => unknown }
type Entry<P> = { at: number; pdf: Promise<P>; pages: Map<number, Promise<string>> }

export function makePageCache<P extends Pdf>(deps: { load: (src: string) => Promise<P>; render: (pdf: P, n: number) => Promise<string>; now?: () => number }) {
  const now = deps.now ?? Date.now
  const files = new Map<string, Entry<P>>()
  const drop = (src: string) => {
    const e = files.get(src)
    files.delete(src)
    void e?.pdf.then((p) => p.destroy?.(), () => {})
  }
  return {
    open(src: string) {
      const cached = files.get(src)
      if (cached && now() - cached.at >= KEEP_MS) drop(src)
      let e = files.get(src)
      if (!e) {
        const entry: Entry<P> = { at: now(), pdf: deps.load(src), pages: new Map() }
        entry.pdf.catch(() => { if (files.get(src) === entry) files.delete(src) })
        files.set(src, entry)
        while (files.size > MAX_FILES) drop(files.keys().next().value!)
        e = entry
      }
      const entry = e
      return {
        pdf: entry.pdf,
        page(n: number): Promise<string> {
          let p = entry.pages.get(n)
          if (!p) {
            p = entry.pdf.then((pdf) => deps.render(pdf, n))
            const mine = p
            p.catch(() => { if (entry.pages.get(n) === mine) entry.pages.delete(n) })
            entry.pages.set(n, p)
          }
          return p
        },
      }
    },
    clear() { for (const src of [...files.keys()]) drop(src) },
  }
}

const drawn = makePageCache<PDFDocumentProxy>({
  load: async (src) => {
    const { getDocumentProxy } = await import('unpdf')
    return getDocumentProxy(new Uint8Array(await (await fetch(src, { credentials: 'same-origin' })).arrayBuffer()))
  },
  render: async (pdf, n) => (await import('unpdf')).renderPageAsImage(pdf, n, { width: 1100, toDataURL: true, format: 'png' }),
})

/** The original PDF at `src`, downloaded once per viewing; `page(n)` is its page n drawn as an image URL. */
export const openDrawn = (src: string) => drawn.open(src)
/** Sign-out: nothing drawn for one person stays in the tab for the next. */
export const clearDrawnPages = () => drawn.clear()
