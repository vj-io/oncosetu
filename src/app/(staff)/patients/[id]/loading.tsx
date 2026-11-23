import { PageLoading } from '@/components/shell/PageLoading'

// Inside the patient workspace layout: the header and tabs stay put, only the tab's content waits.
export default function Loading() {
  return <PageLoading rows={2} />
}
