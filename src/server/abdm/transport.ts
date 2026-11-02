// FR-ING-ABDM-01: the ABDM HIU gateway behind one interface. The calls mirror the ABDM HIU flow (v3 gateway):
//   consent request init → status / hiu-notify (GRANTED|DENIED|EXPIRED|REVOKED + artefact ids) → fetch the artefact →
//   health-information request (HIU ephemeral X25519 key material + nonce, date range, consent id) → the HIP pushes
//   encrypted entries with its own key material → the HIU notifies the transfer outcome.
// Implementations:
//   InProcessGateway  default (no ABDM_* env): an in-process consent manager + HIP holding the synthetic FHIR bundles in
//                     data/abdm/ for their ABHA numbers. The HIP really encrypts (crypto.ts); the push is returned to the
//                     caller instead of POSTed to a dataPushUrl. `decide`/`revoke` stand in for the patient's ABHA app.
//   SandboxGateway    ABDM_CLIENT_ID + ABDM_CLIENT_SECRET + ABDM_BASE_URL: HTTP client for the sandbox gateway (session
//                     token, REQUEST-ID / TIMESTAMP / X-CM-ID / X-HIU-ID headers). The gateway answers 202 and delivers
//                     results to the HIU's callback URLs, so its methods return null where the answer arrives later.
//                     ponytail: the callback routes (on-init, hiu/notify, on-fetch, data push) are not built — no sandbox
//                     account (legal entity + HIU registration) exists to deliver or test them; unit-tested on request shapes only.
import { createHash, randomUUID } from 'node:crypto'
import { fhirDate, type HiType } from '@/core/fhir'
import hip from '../../../data/abdm/hip.json'
import heroDs from '../../../data/abdm/hero-discharge-summary.json'
import heroUsg from '../../../data/abdm/hero-imaging-usg.json'
import heroCbc from '../../../data/abdm/hero-lab-cbc.json'
import heroOp from '../../../data/abdm/hero-op-consult.json'
import heroRx from '../../../data/abdm/hero-prescription.json'
import retCt from '../../../data/abdm/returning-imaging-ct.json'
import retRx from '../../../data/abdm/returning-prescription.json'
import { abhaDigits } from '../registration/duplicates'
import { encryptEntry, ephemeral, type KeyMaterial } from './crypto'

export type ConsentStatus = 'GRANTED' | 'DENIED' | 'EXPIRED' | 'REVOKED'
export type DateRange = { from: string; to: string }
export type ConsentRequestInit = {
  /** The patient's ABHA identifier as registration captured it (14-digit ABHA number). */
  patientId: string
  hiuId: string
  requester: { name: string; identifier: { type: 'REGNO'; value: string; system: string } }
  purpose: { text: string; code: string; refUri: string }
  hiTypes: HiType[]
  dateRange: DateRange
  dataEraseAt: string
}
export type ConsentNotification = { consentRequestId: string; status: ConsentStatus; consentArtefacts: { id: string }[] }
export type ConsentArtefact = {
  consentId: string; status: ConsentStatus; createdAt: string
  patient: { id: string }; hip: { id: string } | null; hiu: { id: string }; hiTypes: HiType[]
  permission: { accessMode: 'VIEW'; dateRange: DateRange; dataEraseAt: string; frequency: { unit: 'HOUR'; value: number; repeats: number } }
}
export type HiRequest = { consentId: string; dateRange: DateRange; dataPushUrl: string; keyMaterial: KeyMaterial }
export type PushEntry = { content: string; media: 'application/fhir+json'; checksum: string; careContextReference: string }
export type DataPush = { transactionId: string; pageNumber: number; pageCount: number; entries: PushEntry[]; keyMaterial: KeyMaterial }
export type TransferNotice = {
  consentId: string; transactionId: string; doneAt: string; hipId: string | null; sessionStatus: 'TRANSFERRED' | 'FAILED'
  statusResponses: { careContextReference: string; hiStatus: 'OK' | 'ERRORED'; description: string }[]
}

export interface AbdmTransport {
  readonly kind: 'in_process' | 'sandbox'
  /** `consentRequestId` null: it arrives later on the gateway's on-init callback, keyed by `requestId`. */
  initConsentRequest(req: ConsentRequestInit): Promise<{ requestId: string; consentRequestId: string | null }>
  consentStatus(consentRequestId: string): Promise<ConsentNotification | null>
  fetchArtefact(consentId: string): Promise<ConsentArtefact | null>
  /** `push` null: the HIP POSTs it to `dataPushUrl` later. */
  requestHealthInformation(req: HiRequest): Promise<{ transactionId: string | null; push: DataPush | null }>
  notifyTransfer(n: TransferNotice): Promise<void>
}

export class AbdmTransportError extends Error {
  constructor(public code: string, public status = 502) {
    super(code)
    this.name = 'AbdmTransportError'
  }
}

/** MD5 hex of the plaintext bundle: the entry checksum the in-process HIP sends and the HIU verifies after decrypting. */
export const entryChecksum = (plain: Buffer | string) => createHash('md5').update(plain).digest('hex')

// ── in-process consent manager + HIP ─────────────────────────────────────────
type CareContext = { reference: string; display: string; hiType: string; bundle: string }
const BUNDLES: Record<string, unknown> = {
  'hero-discharge-summary.json': heroDs, 'hero-imaging-usg.json': heroUsg, 'hero-lab-cbc.json': heroCbc, 'hero-op-consult.json': heroOp,
  'hero-prescription.json': heroRx, 'returning-imaging-ct.json': retCt, 'returning-prescription.json': retRx,
}
export const IN_PROCESS_HIP = { id: hip.hipId, name: hip.hipName }

/** Care contexts the synthetic HIP holds for an ABHA number (empty for anyone else: most ABHAs have no linked records). */
export function hipCareContexts(abha: string): (CareContext & { body: unknown })[] {
  const p = (hip.patients as Record<string, { careContexts: CareContext[] }>)[abhaDigits(abha)]
  return (p?.careContexts ?? []).map((c) => ({ ...c, body: BUNDLES[c.bundle] }))
}

const compositionDate = (bundle: unknown) => {
  const comp = (bundle as { entry?: { resource?: { date?: unknown } }[] }).entry?.[0]?.resource
  return fhirDate(comp?.date)?.iso ?? null
}
const day = (iso: string) => iso.slice(0, 10)

export class InProcessGateway implements AbdmTransport {
  readonly kind = 'in_process' as const
  // Artefacts the CM issued, for the HIP to check. ponytail: memory only, so a re-fetch after a server restart is refused
  // (unknown_consent); every in-process transfer runs right after the grant, in the same request.
  private artefacts: Map<string, ConsentArtefact>
  constructor(private clock: () => Date = () => new Date()) {
    const g = globalThis as unknown as { __abdmArtefacts?: Map<string, ConsentArtefact> }
    this.artefacts = g.__abdmArtefacts ??= new Map()
  }

  async initConsentRequest(req: ConsentRequestInit) {
    if (abhaDigits(req.patientId).length !== 14) throw new AbdmTransportError('invalid_patient_id', 400)
    if (!req.hiTypes.length || !(req.dateRange.from <= req.dateRange.to)) throw new AbdmTransportError('invalid_consent_request', 400)
    return { requestId: randomUUID(), consentRequestId: randomUUID() }
  }

  /** The patient's answer in their ABHA app (here: the OncoSetu portal). GRANTED issues one artefact for the HIP. */
  decide(consentRequestId: string, req: ConsentRequestInit, status: 'GRANTED' | 'DENIED'): ConsentNotification {
    if (status === 'DENIED') return { consentRequestId, status, consentArtefacts: [] }
    const consentId = randomUUID()
    this.artefacts.set(consentId, {
      consentId, status: 'GRANTED', createdAt: this.clock().toISOString(), patient: { id: req.patientId }, hip: { id: IN_PROCESS_HIP.id },
      hiu: { id: req.hiuId }, hiTypes: req.hiTypes,
      permission: { accessMode: 'VIEW', dateRange: req.dateRange, dataEraseAt: req.dataEraseAt, frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
    })
    return { consentRequestId, status, consentArtefacts: [{ id: consentId }] }
  }

  /** The patient revokes in their ABHA app: the CM notifies the HIU (which must erase) and the HIP stops serving. */
  revoke(consentRequestId: string, consentId: string): ConsentNotification {
    const a = this.artefacts.get(consentId)
    if (a) a.status = 'REVOKED'
    return { consentRequestId, status: 'REVOKED', consentArtefacts: [{ id: consentId }] }
  }

  async consentStatus(): Promise<ConsentNotification | null> {
    return null // decisions reach the HIU through decide()/revoke() (the hiu/notify call)
  }

  async fetchArtefact(consentId: string) {
    const a = this.artefacts.get(consentId)
    return a ? structuredClone(a) : null
  }

  /** HIP side: checks the artefact, selects the patient's care contexts in range, encrypts each for the HIU. */
  async requestHealthInformation(req: HiRequest) {
    const a = this.artefacts.get(req.consentId)
    if (!a) throw new AbdmTransportError('unknown_consent', 409)
    if (a.status !== 'GRANTED' || Date.parse(a.permission.dataEraseAt) <= this.clock().getTime()) throw new AbdmTransportError('consent_not_active', 409)
    const p = a.permission.dateRange
    if (req.dateRange.from < p.from || req.dateRange.to > p.to) throw new AbdmTransportError('date_range_outside_consent', 409)
    const hipKeys = ephemeral(new Date(this.clock().getTime() + 30 * 60_000))
    const from = day(req.dateRange.from), to = day(req.dateRange.to)
    const entries = hipCareContexts(a.patient.id)
      .filter((c) => (a.hiTypes as string[]).includes(c.hiType))
      .filter((c) => { const d = compositionDate(c.body); return !!d && d >= from && d <= to })
      .map((c): PushEntry => {
        const plain = JSON.stringify(c.body)
        return { content: encryptEntry(plain, hipKeys, req.keyMaterial, this.clock()), media: 'application/fhir+json', checksum: entryChecksum(plain), careContextReference: c.reference }
      })
    const transactionId = randomUUID()
    return { transactionId, push: { transactionId, pageNumber: 1, pageCount: 1, entries, keyMaterial: hipKeys.keyMaterial } }
  }

  async notifyTransfer() { /* the in-process CM keeps no transfer log; OncoSetu records it in abdm_transfers */ }
}

// ── ABDM sandbox (v3 gateway) ────────────────────────────────────────────────
export type SandboxConfig = { baseUrl: string; clientId: string; clientSecret: string; hiuId: string; cmId?: string; fetch?: typeof fetch; now?: () => Date }

export class SandboxGateway implements AbdmTransport {
  readonly kind = 'sandbox' as const
  private token: { value: string; expiresAt: number } | null = null
  constructor(private cfg: SandboxConfig) {}

  private get f() { return this.cfg.fetch ?? fetch }
  private get now() { return (this.cfg.now ?? (() => new Date()))() }
  private url(path: string) { return `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}` }
  private base(requestId: string) {
    return { 'content-type': 'application/json', 'REQUEST-ID': requestId, TIMESTAMP: this.now.toISOString(), 'X-CM-ID': this.cfg.cmId ?? 'sbx' }
  }

  private async session(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now.getTime() + 30_000) return this.token.value
    const res = await this.f(this.url('/gateway/v3/sessions'), {
      method: 'POST', headers: this.base(randomUUID()),
      body: JSON.stringify({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret, grantType: 'client_credentials' }),
    })
    if (!res.ok) throw new AbdmTransportError(`session_http_${res.status}`)
    const j = (await res.json()) as { accessToken?: string; expiresIn?: number }
    if (!j.accessToken) throw new AbdmTransportError('session_no_token')
    this.token = { value: j.accessToken, expiresAt: this.now.getTime() + (j.expiresIn ?? 600) * 1000 }
    return j.accessToken
  }

  /** One gateway call. The gateway acknowledges with 202 (200 tolerated); the answer comes on a callback keyed by REQUEST-ID. */
  private async call(path: string, body: unknown): Promise<string> {
    const requestId = randomUUID()
    const res = await this.f(this.url(path), {
      method: 'POST', headers: { ...this.base(requestId), Authorization: `Bearer ${await this.session()}`, 'X-HIU-ID': this.cfg.hiuId },
      body: JSON.stringify(body),
    })
    if (res.status !== 202 && res.status !== 200) throw new AbdmTransportError(`gateway_http_${res.status}`)
    return requestId
  }

  async initConsentRequest(req: ConsentRequestInit) {
    const requestId = await this.call('/consent/v3/request/init', {
      consent: {
        purpose: req.purpose, patient: { id: req.patientId }, hiu: { id: req.hiuId }, requester: req.requester, hiTypes: req.hiTypes,
        permission: { accessMode: 'VIEW', dateRange: req.dateRange, dataEraseAt: req.dataEraseAt, frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
      },
    })
    return { requestId, consentRequestId: null }
  }
  async consentStatus(consentRequestId: string) { await this.call('/consent/v3/request/status', { consentRequestId }); return null }
  async fetchArtefact(consentId: string) { await this.call('/consent/v3/fetch', { consentId }); return null }
  async requestHealthInformation(req: HiRequest) {
    await this.call('/data-flow/v3/health-information/request', {
      hiRequest: { consent: { id: req.consentId }, dateRange: req.dateRange, dataPushUrl: req.dataPushUrl, keyMaterial: req.keyMaterial },
    })
    return { transactionId: null, push: null }
  }
  async notifyTransfer(n: TransferNotice) {
    await this.call('/data-flow/v3/health-information/notify', {
      notification: {
        consentId: n.consentId, transactionId: n.transactionId, doneAt: n.doneAt, notifier: { type: 'HIU', id: this.cfg.hiuId },
        statusNotification: { sessionStatus: n.sessionStatus, hipId: n.hipId, statusResponses: n.statusResponses },
      },
    })
  }
}

let inProcess: InProcessGateway | undefined
/** SandboxGateway when ABDM_CLIENT_ID, ABDM_CLIENT_SECRET and ABDM_BASE_URL are all set; the in-process gateway when none is. */
export function abdmTransport(env: Record<string, string | undefined> = process.env): AbdmTransport {
  const { ABDM_CLIENT_ID: id, ABDM_CLIENT_SECRET: secret, ABDM_BASE_URL: base } = env
  if (!id && !secret && !base) return (inProcess ??= new InProcessGateway())
  if (!id || !secret || !base) throw new AbdmTransportError('abdm_env_incomplete', 503)
  return new SandboxGateway({ baseUrl: base, clientId: id, clientSecret: secret, hiuId: env.ABDM_HIU_ID ?? id, cmId: env.ABDM_CM_ID })
}
