// Without text messages (no SMS provider, not the demo) a code would never arrive: the confirm step offers only in-person
// witnessed confirmation and switches the value to it, and the pre-visit link is not offered. With SMS, both stay as before.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SmsContext } from '@/lib/sms-context'
import { ConfirmStep, EMPTY_CONFIRM, confirmOf, witnessPatch } from './ConsentCapture'
import { PreVisitLinkButton } from './PreVisitLinkButton'
import { smsAvailable } from '@/server/sms/provider'

const within = (sms: boolean, demo: boolean, el: ReactNode) => renderToStaticMarkup(createElement(SmsContext.Provider, { value: { sms, demo } }, el))
const confirm = (sms: boolean) => within(sms, false, createElement(ConfirmStep, { value: EMPTY_CONFIRM, onChange: () => {}, sendCode: async () => null, canSendCode: true, contactHint: 'A code goes to the patient.' }))

describe('no SMS provider: in-person confirmation only', () => {
  it('the confirm step shows no send-a-code controls, says why, and shows the witness attestation', () => {
    const out = confirm(false)
    expect(out).not.toContain('Code sent by SMS')
    expect(out).not.toContain('Send code')
    expect(out).toContain('Text messages are not set up at this clinic')
    expect(out).toContain('I witnessed this')
  })
  it('ticking the witness box makes the confirmation complete as in-person, from the default (SMS) state', () => {
    expect(confirmOf(EMPTY_CONFIRM)).toBeNull()
    expect(confirmOf({ ...EMPTY_CONFIRM, ...witnessPatch(true) })).toEqual({ method: 'witnessed', attest: true })
    expect(confirmOf({ ...EMPTY_CONFIRM, ...witnessPatch(false) })).toBeNull()
  })
  it('with SMS the choice and the send button are there as before', () => {
    const out = confirm(true)
    expect(out).toContain('Code sent by SMS')
    expect(out).toContain('Send code')
  })
  it('the pre-visit link is offered only when it can be sent', () => {
    expect(within(false, false, createElement(PreVisitLinkButton, { patientId: 'p' }))).toBe('')
    expect(within(true, false, createElement(PreVisitLinkButton, { patientId: 'p' }))).toContain('Send pre-visit link')
  })
  it('smsAvailable: a provider, or the demo; otherwise not', () => {
    vi.stubEnv('DEMO_MODE', ''); vi.stubEnv('TWILIO_ACCOUNT_SID', ''); vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    expect(smsAvailable()).toBe(false)
    vi.stubEnv('DEMO_MODE', 'true')
    expect(smsAvailable()).toBe(true)
    vi.stubEnv('DEMO_MODE', ''); vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC1'); vi.stubEnv('TWILIO_AUTH_TOKEN', 't'); vi.stubEnv('TWILIO_FROM', '+10000000000')
    expect(smsAvailable()).toBe(true)
    vi.unstubAllEnvs()
  })
})
