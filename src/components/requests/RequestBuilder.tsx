'use client'
// Records request builder (FR-REQ-01/02): from completeness items (prefilled) or manual. Creates the letter only;
// nothing goes to the hospital (FR-REQ-05).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Mail } from 'lucide-react'
import { Button, ButtonLink, Checkbox, Dialog, Field, Input, Select, useToast, type ButtonSize, type ButtonVariant } from '@/components/ui'
import { INSTITUTION_TYPES, type Disclosure, type InstitutionType, type Lang } from '@/core/types'
import { tr } from '@/i18n/requests'
import { DEFAULT_REQUEST_DOCS, requestDocLabel, type RequestDocKey } from '@/server/requests/letter'
import { api, ApiError } from './api'

const ORDER: RequestDocKey[] = [
  ...DEFAULT_REQUEST_DOCS, 'ihc_molecular_report', 'lab_report', 'procedure_note', 'consult_note', 'chemo_daycare_record',
  'radiotherapy_summary', 'prescription_printed', 'prescription_handwritten', 'bill_insurance', 'other',
]

export type RequestPrefill = { missingIds: string[]; institution?: string; documents?: RequestDocKey[]; dateRange?: { from?: string; to?: string } }

export function RequestBuilder({
  patientId, actor, lang = 'en', disclosure, prefill, label, variant = 'secondary', size = 'sm',
}: {
  patientId: string
  actor: 'staff' | 'patient'
  lang?: Lang
  /** Labels follow disclosure on the patient side; staff pass 'cleared' for clinical labels. */
  disclosure: Disclosure
  prefill?: RequestPrefill
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [institution, setInstitution] = useState(prefill?.institution ?? '')
  const [institutionType, setInstitutionType] = useState<InstitutionType | ''>('')
  const [uhid, setUhid] = useState('')
  const [docs, setDocs] = useState<Set<RequestDocKey>>(new Set(prefill?.documents?.length ? prefill.documents : DEFAULT_REQUEST_DOCS))
  const [from, setFrom] = useState(prefill?.dateRange?.from ?? '')
  const [to, setTo] = useState(prefill?.dateRange?.to ?? '')
  const [letterLang, setLetterLang] = useState<Lang>(lang)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ field?: 'institution' | 'documents'; text: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const t = (k: Parameters<typeof tr>[1], v?: Record<string, string | number>) => tr(lang, k, v)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (institution.trim().length < 2) return setError({ field: 'institution', text: t('institutionRequired') })
    if (!docs.size) return setError({ field: 'documents', text: t('documentsRequired') })
    setError(null)
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/api/requests', {
        ...(actor === 'staff' ? { patientId } : {}),
        missingIds: prefill?.missingIds ?? [], institution: institution.trim(), institutionType: institutionType || undefined,
        institutionPatientId: uhid.trim() || undefined,
        documents: ORDER.filter((k) => docs.has(k)), lang: letterLang,
        dateRange: from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined,
      })
      setCreated(r.id)
      toast({ title: t('created'), tone: 'verified' })
      router.refresh()
    } catch (err) {
      setError({ text: actor === 'staff' && err instanceof ApiError ? err.message : t('genericError') })
    } finally {
      setBusy(false)
    }
  }

  const close = () => { setOpen(false); setCreated(null) }
  return (
    <>
      <Button variant={variant} size={size} icon={<Mail />} onClick={() => setOpen(true)}>{label ?? t('newRequest')}</Button>
      <Dialog open={open} onClose={close} title={t('builderTitle')} description={t('builderIntro')}
        footer={created ? <Button variant="ghost" onClick={close}>{t('cancel')}</Button> : (
          <>
            <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
            <Button type="submit" form="request-builder" loading={busy}>{busy ? t('creating') : t('create')}</Button>
          </>
        )}>
        {created ? (
          <div className="grid gap-4">
            <p className="text-[15px]">{t('created')}. {t('noAuto')}</p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/print/request/${created}?lang=en`} target="_blank" variant="secondary" icon={<FileText />}>{t('letterEn')}</ButtonLink>
              <ButtonLink href={`/print/request/${created}?lang=hi`} target="_blank" variant="secondary" icon={<FileText />}>{t('letterHi')}</ButtonLink>
            </div>
          </div>
        ) : (
          <form id="request-builder" onSubmit={submit} className="grid gap-5" noValidate>
            <Field label={t('institutionLabel')} hint={t('institutionHint')} error={error?.field === 'institution' ? error.text : undefined}>
              <Input value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} autoComplete="off" required />
            </Field>
            <Field label={t('institutionTypeLabel')} hint={t('institutionTypeHint')} optional>
              <Select value={institutionType} onChange={(e) => setInstitutionType(e.target.value as InstitutionType | '')}>
                <option value="">{t('institutionTypeNone')}</option>
                {INSTITUTION_TYPES.map((k) => <option key={k} value={k}>{t(`instType_${k}`)}</option>)}
              </Select>
            </Field>
            <fieldset className="grid gap-1">
              <legend className="ds-kicker mb-1 text-muted">{t('documentsLabel')}</legend>
              <div className="grid sm:grid-cols-2 sm:gap-x-6">
                {ORDER.map((k) => (
                  <Checkbox key={k} label={requestDocLabel(k, disclosure, lang) ?? k} checked={docs.has(k)}
                    onChange={(e) => setDocs((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n })} />
                ))}
              </div>
              {error?.field === 'documents' && <p className="text-sm text-madder-ink">{error.text}</p>}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('fromLabel')} optional><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={t('toLabel')} optional><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
              <p className="-mt-1 text-sm text-faint sm:col-span-2">{t('dateRangeHint')}</p>
            </div>
            <Field label={t('uhidLabel')} hint={t('uhidHint')} optional>
              <Input value={uhid} onChange={(e) => setUhid(e.target.value)} maxLength={60} autoComplete="off" />
            </Field>
            <Field label={t('langLabel')}>
              <Select value={letterLang} onChange={(e) => setLetterLang(e.target.value as Lang)}>
                <option value="en">{t('langEn')}</option>
                <option value="hi">{t('langHi')}</option>
              </Select>
            </Field>
            {error && !error.field && <p role="alert" className="text-sm text-madder-ink">{error.text}</p>}
          </form>
        )}
      </Dialog>
    </>
  )
}
