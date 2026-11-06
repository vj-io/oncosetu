'use client'
// Records requests for one patient (FR-REQ-03..05), for staff or for the patient/caregiver portal.
// Tracking is computed on the server on every read (demo clock aware); reminders go to the primary contact only.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CalendarCheck, FileText, Info, Undo2 } from 'lucide-react'
import clsx from 'clsx'
import { Button, ButtonLink, Dialog, EmptyState, Field, Frame, Input, Skeleton, StatusBadge, Textarea, useToast } from '@/components/ui'
import { formatDateIN, inLang, istDate } from '@/core/copy'
import type { Lang, RequestState } from '@/core/types'
import { tr, type RequestKey } from '@/i18n/requests'
import type { RequestView } from '@/server/requests/requests'
import { api, ApiError } from './api'
import { sideStyle } from './side'

const ACTIVE: RequestState[] = ['sent', 'reminder_due', 'open_21d']
const OPEN: RequestState[] = ['drafted', ...ACTIVE]
const linkCls = 'text-setu-ink underline decoration-brass underline-offset-4'

export function RequestList({ patientId, actor, lang = 'en' }: { patientId: string; actor: 'staff' | 'patient'; lang?: Lang }) {
  const router = useRouter()
  const { toast } = useToast()
  const url = actor === 'staff' ? `/api/requests?patientId=${patientId}` : '/api/p/requests'
  const t = (k: RequestKey, v?: Record<string, string | number>) => tr(lang, k, v)
  const ui = sideStyle(actor, lang)
  const [rows, setRows] = useState<RequestView[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [sentFor, setSentFor] = useState<string | null>(null)
  const [sentOn, setSentOn] = useState('')
  const [ask, setAsk] = useState<null | { kind: 'withdraw' | 'unobtainable'; id: string }>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    api<{ requests: RequestView[] }>(url)
      .then((d) => { if (alive) { setRows(d.requests); setLoadError(false) } })
      .catch(() => { if (alive) setLoadError(true) })
    return () => { alive = false }
  }, [url, tick])

  const fail = (e: unknown) => toast({ title: actor === 'staff' && e instanceof ApiError ? e.message : t('genericError'), tone: 'conflict' })
  async function act(key: string, path: string, body: unknown = {}) {
    setBusy(key)
    try {
      await api(path, body)
      setAsk(null)
      setSentFor(null)
      setTick((n) => n + 1)
      router.refresh()
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(null)
    }
  }

  if (loadError) return <p role="alert" className="text-madder-ink">{t('genericError')}</p>
  if (!rows) return <div className="grid gap-3" aria-label={t('loading')}><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
  if (!rows.length) return <EmptyState icon={<FileText />} title={t('listEmpty')} description={t('noAuto')} />

  const today = istDate(new Date().toISOString())
  return (
    <>
      <ul className="grid gap-5">
        {rows.map((r) => {
          const date = r.state === 'fulfilled' ? r.fulfilledAt : r.sentAt
          const period = r.dateRange?.from && r.dateRange?.to
            ? t('period', { from: formatDateIN(r.dateRange.from, lang), to: formatDateIN(r.dateRange.to, lang) })
            : r.dateRange?.from ? t('periodFrom', { from: formatDateIN(r.dateRange.from, lang) })
              : r.dateRange?.to ? t('periodTo', { to: formatDateIN(r.dateRange.to, lang) }) : null
          return (
            <li key={r.id} id={`r-${r.id}`} className="scroll-mt-24">
              <Frame className="grid gap-4 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <p className={clsx('ds-kicker', ui.kicker)}>{t('builderTitle')}</p>
                    <h3 className="text-xl leading-snug tracking-[-0.02em] break-words">{r.institution}</h3>
                  </div>
                  <StatusBadge status={r.state} label={actor === 'staff' ? undefined : ui.plain(t(`state_${r.state}` as RequestKey, { date: date ? formatDateIN(istDate(date), lang) : '' }))} />
                </div>
                <div className="grid gap-1 text-[15px]">
                  <p>{t('recordsList', { list: r.documents.map((x) => inLang(x.label, lang)).join(', ') })}</p>
                  {period && <p className="text-muted">{period}</p>}
                  {r.institutionPatientId && <p className="font-mono text-[13px] text-muted">{t('letterUhid')} {r.institutionPatientId}</p>}
                  {actor === 'staff' && <p className="text-muted">{t(`state_${r.state}` as RequestKey, { date: date ? formatDateIN(istDate(date), lang) : '' })}{r.daysOpen != null ? ` · ${t('daysOpen', { n: r.daysOpen })}` : ''}</p>}
                  {(r.reminder7SentAt || r.reminder21SentAt) && (
                    <p className="font-mono text-[12px] text-faint">{[r.reminder7SentAt, r.reminder21SentAt].filter(Boolean).map((x) => t('reminderSent', { date: formatDateIN(istDate(x!), lang) })).join(' · ')}</p>
                  )}
                </div>
                {ACTIVE.includes(r.state) && (
                  <p className="flex items-start gap-2 border-l-[3px] border-l-setu bg-setu-tint px-3 py-2 text-[14px] text-setu-ink"><Info aria-hidden className="mt-0.5 size-4 shrink-0" />{t('refNote')}</p>
                )}
                {r.state === 'open_21d' && (
                  <p><a className={linkCls} href={`/print/escalation?lang=${lang}`} target="_blank" rel="noopener">{t('escalation')}</a></p>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
                  <ButtonLink size={ui.size} className={ui.btn} variant="secondary" icon={<FileText />} href={`/print/request/${r.id}?lang=en`} target="_blank">{t('letterEn')}</ButtonLink>
                  <ButtonLink size={ui.size} className={ui.btn} variant="secondary" icon={<FileText />} href={`/print/request/${r.id}?lang=hi`} target="_blank">{t('letterHi')}</ButtonLink>
                  {r.state === 'drafted' && sentFor !== r.id && (
                    <Button size={ui.size} className={ui.btn} icon={<CalendarCheck />} onClick={() => { setSentFor(r.id); setSentOn(today); setFormError(null) }}>{t('markSent')}</Button>
                  )}
                  {OPEN.includes(r.state) && <Button size={ui.size} className={ui.btn} variant="ghost" icon={<Ban />} onClick={() => { setReason(''); setFormError(null); setAsk({ kind: 'unobtainable', id: r.id }) }}>{t('unobtainable')}</Button>}
                  {OPEN.includes(r.state) && <Button size={ui.size} className={ui.btn} variant="ghost" icon={<Undo2 />} onClick={() => setAsk({ kind: 'withdraw', id: r.id })}>{t('withdraw')}</Button>}
                </div>
                {sentFor === r.id && (
                  <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
                    e.preventDefault()
                    if (sentOn > today) return setFormError(t('dateFuture'))
                    void act(`sent-${r.id}`, `/api/requests/${r.id}/sent`, { sentOn })
                  }}>
                    <Field label={ui.plain(t('sentOnLabel'))} error={formError ?? undefined} className="min-w-56">
                      <Input type="date" value={sentOn} max={today} onChange={(e) => setSentOn(e.target.value)} required />
                    </Field>
                    <Button type="submit" size="md" className={ui.btn} loading={busy === `sent-${r.id}`}>{t('saveDate')}</Button>
                    <Button variant="ghost" size="md" className={ui.btn} onClick={() => setSentFor(null)}>{t('cancel')}</Button>
                  </form>
                )}
              </Frame>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">{t('noAuto')}</p>

      <Dialog open={ask?.kind === 'withdraw'} onClose={() => setAsk(null)} title={t('withdraw')} description={t('withdrawConfirm')}
        footer={<>
          <Button variant="ghost" className={ui.btn} onClick={() => setAsk(null)}>{t('cancel')}</Button>
          <Button variant="danger" className={ui.btn} loading={busy === 'withdraw'} onClick={() => act('withdraw', `/api/requests/${ask!.id}/withdraw`)}>{t('withdraw')}</Button>
        </>} />
      <Dialog open={ask?.kind === 'unobtainable'} onClose={() => setAsk(null)} title={t('unobtainable')}
        footer={<>
          <Button variant="ghost" className={ui.btn} onClick={() => setAsk(null)}>{t('cancel')}</Button>
          <Button className={ui.btn} loading={busy === 'unobtainable'} onClick={() => {
            if (!reason.trim()) return setFormError(t('reasonRequired'))
            void act('unobtainable', `/api/requests/${ask!.id}/unobtainable`, { reason: reason.trim() })
          }}>{t('confirm')}</Button>
        </>}>
        <Field label={ui.plain(t('unobtainableReason'))} error={ask?.kind === 'unobtainable' ? formError ?? undefined : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
        </Field>
      </Dialog>
    </>
  )
}
