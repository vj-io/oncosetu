// Which language a /p page is shown in. Pure, so it can be tested without the database.
import type { Lang } from '@/core/types'

/** The cookie that remembers the language a family member chose (set by LangMemory, read by context.ts). */
export const LANG_COOKIE = 'os_lang'

/** `?lang=hi|en|hinglish` (first value wins) or null. */
export function langParam(raw: string | string[] | undefined): Lang | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'hi' || v === 'en' || v === 'hinglish' ? v : null
}

/** The language in the address (just chosen), else the remembered choice, else the fallback. */
export function pickLang(fromUrl: Lang | null, remembered: string | undefined, fallback: Lang): Lang {
  return fromUrl ?? langParam(remembered) ?? fallback
}
