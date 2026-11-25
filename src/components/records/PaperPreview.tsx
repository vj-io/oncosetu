'use client'

import { PdfPages } from '@/components/documents/SourceViewer'

/** The original paper as it was received: a PDF drawn page by page, the page pictures, or a video. Nothing is read from it here. */
/** `only`: the pages of one report inside a file of several (E-DOC-10); they are drawn from the stored page images. */
export function PaperPreview({ id, mime, pages, pageImages, only, className }: { id: string; mime: string; pages: number | null; pageImages: number[]; only?: number[]; className?: string }) {
  if (mime === 'application/pdf' && !(only && pageImages.length)) return <div className={className}><PdfPages src={`/api/documents/${id}/file?kind=original`} pages={pages ?? 1} /></div>
  if (pageImages.length) {
    return (
      <div className={`grid gap-2 rounded-lg border border-paper-rule bg-paper p-2 ${className ?? ''}`}>
        {pageImages.map((n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={n} src={`/api/documents/${id}/file?kind=page&page=${n}`} alt={`Page ${n} of the paper as it was received`} className="block h-auto w-full border border-paper-rule bg-white" />
        ))}
      </div>
    )
  }
  if (mime.startsWith('video/')) return <video controls preload="metadata" className={`max-h-[28rem] w-full border border-rule bg-obsidian ${className ?? ''}`} src={`/api/documents/${id}/file?kind=original`} />
  return (
    <p className="border border-dashed border-control bg-gallery p-5 text-[15px] text-muted rounded-lg">
      This kind of file cannot be drawn here. <a className="underline underline-offset-4" href={`/api/documents/${id}/file?kind=original`}>Open the original</a>.
    </p>
  )
}
