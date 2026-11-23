import { PageLoading } from '@/components/shell/PageLoading'

// Patient pages draw their own frame, so this is a plain placeholder; neutral wording, no brand (FR-CON-07).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      <PageLoading label="Loading / लोड हो रहा है" rows={2} />
    </div>
  )
}
