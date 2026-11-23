import { PageLoading } from '@/components/shell/PageLoading'

// A loading boundary on this section only: one above the patient workspace would stream its notFound() as a 200.
export default function Loading() {
  return <PageLoading />
}
