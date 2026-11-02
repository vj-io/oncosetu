// Transport: the sandbox client's request shapes (stubbed fetch; no live sandbox account exists) and the in-process HIP.
import { describe, expect, it } from 'vitest'
import { decryptEntry, ephemeral } from './crypto'
import { abdmTransport, entryChecksum, InProcessGateway, SandboxGateway, type ConsentRequestInit } from './transport'

const NOW = new Date('2026-11-02T06:00:00.000Z')
const init: ConsentRequestInit = {
  patientId: '00-1111-2222-0001', hiuId: 'HIU-OS', purpose: { text: 'Care Management', code: 'CAREMGT', refUri: 'http://terminology.hl7.org/ValueSet/v3-PurposeOfUse' },
  requester: { name: 'Records officer', identifier: { type: 'REGNO', value: 'staff-1', system: 'https://oncosetu.example/staff' } },
  hiTypes: ['DischargeSummary', 'Prescription'], dateRange: { from: '2025-01-01T00:00:00.000Z', to: '2026-11-01T23:59:59.999Z' }, dataEraseAt: '2026-12-02T06:00:00.000Z',
}

function stub(status = 202) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const f = (async (url: string, o: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: o.headers, body: JSON.parse(o.body) })
    if (url.endsWith('/gateway/v3/sessions')) return new Response(JSON.stringify({ accessToken: 'tok-1', expiresIn: 1200 }), { status: 200 })
    return new Response(null, { status })
  }) as unknown as typeof fetch
  return { calls, gw: new SandboxGateway({ baseUrl: 'https://dev.abdm.gov.in/api/hiecm/', clientId: 'cid', clientSecret: 'sec', hiuId: 'HIU-OS', fetch: f, now: () => NOW }) }
}

describe('SandboxGateway request shapes', () => {
  it('session token once, then gateway calls with the documented headers', async () => {
    const { calls, gw } = stub()
    const r = await gw.initConsentRequest(init)
    await gw.consentStatus('cr-1')
    expect(calls.map((c) => c.url)).toEqual([
      'https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions',
      'https://dev.abdm.gov.in/api/hiecm/consent/v3/request/init',
      'https://dev.abdm.gov.in/api/hiecm/consent/v3/request/status',
    ])
    expect(calls[0].body).toEqual({ clientId: 'cid', clientSecret: 'sec', grantType: 'client_credentials' })
    expect(calls[0].headers).toMatchObject({ 'X-CM-ID': 'sbx', TIMESTAMP: NOW.toISOString() })
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(calls[1].headers).toMatchObject({ Authorization: 'Bearer tok-1', 'X-CM-ID': 'sbx', 'X-HIU-ID': 'HIU-OS', TIMESTAMP: NOW.toISOString(), 'REQUEST-ID': r.requestId })
    expect(r.consentRequestId).toBeNull() // arrives on the on-init callback
    expect(calls[1].body).toEqual({
      consent: {
        purpose: init.purpose, patient: { id: init.patientId }, hiu: { id: 'HIU-OS' }, requester: init.requester, hiTypes: init.hiTypes,
        permission: { accessMode: 'VIEW', dateRange: init.dateRange, dataEraseAt: init.dataEraseAt, frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
      },
    })
    expect(calls[2].body).toEqual({ consentRequestId: 'cr-1' })
  })

  it('fetch, health-information request (with HIU key material) and notify', async () => {
    const { calls, gw } = stub()
    const keys = ephemeral(new Date('2026-11-02T07:00:00Z'))
    expect(await gw.fetchArtefact('ca-1')).toBeNull()
    expect(await gw.requestHealthInformation({ consentId: 'ca-1', dateRange: init.dateRange, dataPushUrl: 'https://hiu.example/push', keyMaterial: keys.keyMaterial }))
      .toEqual({ transactionId: null, push: null })
    await gw.notifyTransfer({ consentId: 'ca-1', transactionId: 'tx-1', doneAt: NOW.toISOString(), hipId: 'HIP-1', sessionStatus: 'TRANSFERRED', statusResponses: [{ careContextReference: 'CC-1', hiStatus: 'OK', description: 'Delivered' }] })
    const [, fetchCall, hiCall, notifyCall] = calls
    expect(fetchCall).toMatchObject({ url: expect.stringMatching(/\/consent\/v3\/fetch$/), body: { consentId: 'ca-1' } })
    expect(hiCall.url).toMatch(/\/data-flow\/v3\/health-information\/request$/)
    expect(hiCall.body).toEqual({ hiRequest: { consent: { id: 'ca-1' }, dateRange: init.dateRange, dataPushUrl: 'https://hiu.example/push', keyMaterial: keys.keyMaterial } })
    expect((hiCall.body.hiRequest as { keyMaterial: { dhPublicKey: { parameters: string } } }).keyMaterial.dhPublicKey.parameters).toBe('Curve25519/32byte random key')
    expect(notifyCall.url).toMatch(/\/data-flow\/v3\/health-information\/notify$/)
    expect(notifyCall.body).toEqual({ notification: { consentId: 'ca-1', transactionId: 'tx-1', doneAt: NOW.toISOString(), notifier: { type: 'HIU', id: 'HIU-OS' },
      statusNotification: { sessionStatus: 'TRANSFERRED', hipId: 'HIP-1', statusResponses: [{ careContextReference: 'CC-1', hiStatus: 'OK', description: 'Delivered' }] } } })
    expect(calls.filter((c) => c.url.endsWith('/sessions'))).toHaveLength(1) // token reused
  })

  it('a refused call is an error', async () => {
    await expect(stub(401).gw.consentStatus('x')).rejects.toMatchObject({ code: 'gateway_http_401' })
  })

  it('abdmTransport(): in-process by default, sandbox only with all three ABDM_* variables', () => {
    expect(abdmTransport({}).kind).toBe('in_process')
    expect(abdmTransport({ ABDM_CLIENT_ID: 'a', ABDM_CLIENT_SECRET: 'b', ABDM_BASE_URL: 'https://x' }).kind).toBe('sandbox')
    expect(() => abdmTransport({ ABDM_CLIENT_ID: 'a' })).toThrow('abdm_env_incomplete')
  })
})

describe('InProcessGateway (consent manager + HIP)', () => {
  it('grant → artefact → encrypted push of the granted HI types in range, decryptable by the HIU only', async () => {
    const gw = new InProcessGateway(() => NOW)
    const { consentRequestId } = await gw.initConsentRequest(init)
    const n = gw.decide(consentRequestId!, init, 'GRANTED')
    expect(n).toMatchObject({ status: 'GRANTED', consentArtefacts: [{ id: expect.any(String) }] })
    const a = await gw.fetchArtefact(n.consentArtefacts[0].id)
    expect(a).toMatchObject({ status: 'GRANTED', patient: { id: init.patientId }, hiTypes: init.hiTypes, permission: { dateRange: init.dateRange, dataEraseAt: init.dataEraseAt } })
    const hiu = ephemeral(new Date(NOW.getTime() + 600_000))
    const { push } = await gw.requestHealthInformation({ consentId: a!.consentId, dateRange: init.dateRange, dataPushUrl: 'in-process', keyMaterial: hiu.keyMaterial })
    expect(push!.entries.map((e) => e.careContextReference).sort()).toEqual(['GMH-IP-2026-0309', 'GMH-RX-2026-0402']) // no lab / imaging / OP: not granted
    for (const e of push!.entries) {
      const plain = decryptEntry(e.content, hiu, push!.keyMaterial, NOW)
      expect(entryChecksum(plain)).toBe(e.checksum)
      expect(JSON.parse(plain.toString()).resourceType).toBe('Bundle')
      expect(() => decryptEntry(e.content, ephemeral(new Date('2027-01-01')), push!.keyMaterial, NOW)).toThrow()
    }
  })

  it('narrower date range → fewer entries; unknown ABHA → none; denied, revoked or out-of-range → refused', async () => {
    const gw = new InProcessGateway(() => NOW)
    const n = gw.decide('cr', init, 'GRANTED')
    const id = n.consentArtefacts[0].id
    const hiu = ephemeral(new Date(NOW.getTime() + 600_000))
    const req = (dateRange = init.dateRange, consentId = id) => gw.requestHealthInformation({ consentId, dateRange, dataPushUrl: 'x', keyMaterial: hiu.keyMaterial })
    expect((await req({ from: '2026-04-01T00:00:00.000Z', to: '2026-11-01T23:59:59.999Z' })).push!.entries.map((e) => e.careContextReference)).toEqual(['GMH-RX-2026-0402'])
    await expect(req({ from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'date_range_outside_consent' })
    const other = gw.decide('cr2', { ...init, patientId: '00-9999-9999-9999' }, 'GRANTED')
    expect((await req(init.dateRange, other.consentArtefacts[0].id)).push!.entries).toEqual([])
    expect(gw.decide('cr3', init, 'DENIED')).toEqual({ consentRequestId: 'cr3', status: 'DENIED', consentArtefacts: [] })
    gw.revoke('cr', id)
    await expect(req()).rejects.toMatchObject({ code: 'consent_not_active' })
    await expect(req(init.dateRange, 'nope')).rejects.toMatchObject({ code: 'unknown_consent' })
  })
})
