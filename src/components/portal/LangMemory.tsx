"use client";

import { useEffect } from "react";
import type { Lang } from "@/core/types";

/** Remembers the language on this phone (a plain cookie, one year) so a bookmark or an SMS link opens the same language. */
export function LangMemory({ lang }: { lang: Lang }) {
  useEffect(() => {
    try {
      document.cookie = `os_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
    } catch { /* cookies blocked: the choice simply is not remembered */ }
  }, [lang]);
  return null;
}
