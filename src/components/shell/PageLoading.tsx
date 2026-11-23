import { Skeleton } from '@/components/ui'

/**
 * Shown the moment a link is clicked, while the server renders the page (Next `loading.tsx`): the shell stays, the content
 * area shows placeholders. With a loading boundary, Next also prefetches this shell for links in view, so the click
 * answers at once. `label` is read by screen readers.
 */
export function PageLoading({ label = 'Loading', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-5 py-6" data-testid="page-loading">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
      </div>
    </div>
  )
}
