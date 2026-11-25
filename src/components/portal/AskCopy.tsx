"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Lang } from "@/core/types";
import { tp } from "@/i18n/patient";

/** "Ask the clinic for a copy" on a paper the patient cannot open (copies.ts). One press; the list comes back marked. */
export function AskCopy({ lang, documentId }: { lang: Lang; documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/p/documents/${documentId}/copy`, { method: "POST" });
      if (res.status === 401) { router.replace(`/p/login?next=/p&lang=${lang}`); return; }
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(tp(lang, "genericError"));
    }
    setBusy(false);
  }
  return (
    <span className="grid gap-1 justify-self-start">
      <button type="button" onClick={ask} disabled={busy} data-testid="ask-copy" className="inline-flex min-h-11 items-center text-[16px] font-medium text-setu-ink underline decoration-link underline-offset-4 disabled:opacity-60">
        {tp(lang, "copyAsk")}
      </button>
      {error && <span role="alert" className="text-[16px] text-madder-ink">{error}</span>}
    </span>
  );
}
