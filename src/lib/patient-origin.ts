// Where patients, families and outside doctors open the links staff hand them (the sign-in QR code, share links).
// The staff address can carry the product name, which a patient who has not been told the diagnosis would see in the
// browser (FR-CON-07), so a deployment can set a neutral address in NEXT_PUBLIC_PATIENT_ORIGIN (inlined at build time).
// Anything that is not a plain https origin is ignored and the page's own origin is used instead.
export function patientOrigin(own: string, configured = process.env.NEXT_PUBLIC_PATIENT_ORIGIN): string {
  const v = configured?.trim().replace(/\/+$/, '')
  return v && /^https:\/\/[a-z0-9.-]+$/i.test(v) ? v : own
}

/** True when a request's host (X-Forwarded-Host or Host) is the configured neutral patient address. */
export function isPatientHost(host: string | null | undefined, configured = process.env.NEXT_PUBLIC_PATIENT_ORIGIN): boolean {
  const neutral = patientOrigin('', configured)
  return Boolean(neutral && host && new URL(neutral).host === host.toLowerCase())
}
