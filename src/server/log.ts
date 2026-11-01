// JSON-lines logger. Never logs names, phones, emails, quotes, document text or bodies (PRD §15.1).
type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

// Keys ending in one of these words (camelCase or snake_case), or exactly "code".
const SENSITIVE_KEY = /(name|phone|dob|quote|text|body|email|password|totp|token|transcript|secret|cookie|authorization|passcode|otp|address|mrn|abha)$|^code$/i
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi
const PHONE = /(?<![\w-])\+?\d(?:[\s().-]?\d){8,13}(?![\w-])/g // 9–14 digits, not inside ids/uuids

/** Deep-redacts sensitive keys and phone/email-looking substrings. Exported for the redaction test. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (typeof value === 'string') return value.replace(EMAIL, '[email]').replace(PHONE, '[phone]')
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1), code: (value as { code?: unknown }).code }
  if (value && typeof value === 'object') {
    const out: Fields = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)
    return out
  }
  return value
}

function emit(level: Level, msg: string, fields: Fields, base: Fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact({ ...base, ...fields }) as Fields) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export type Logger = Record<Level, (msg: string, fields?: Fields) => void> & { child: (f: Fields) => Logger }

function make(base: Fields): Logger {
  return {
    debug: (m, f = {}) => { if (process.env.LOG_DEBUG === 'true') emit('debug', m, f, base) },
    info: (m, f = {}) => emit('info', m, f, base),
    warn: (m, f = {}) => emit('warn', m, f, base),
    error: (m, f = {}) => emit('error', m, f, base),
    child: (f) => make({ ...base, ...f }),
  }
}

export const log: Logger = make({})
export const logger = (requestId: string): Logger => make({ requestId })
