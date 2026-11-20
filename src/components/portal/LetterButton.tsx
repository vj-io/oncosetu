"use client";

import type { Lang } from "@/core/types";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { api, ApiError } from "@/components/requests/api";
import { tp } from "@/i18n/patient";
import { ErrorNote, PButton } from "./ui";

/**
 * "Make a letter for this hospital": the family makes the request letter for one missing paper themselves.
 * Calls POST /api/p/requests { missingId, lang } and, once the letter exists, opens it on the Requests page.
 * If the server cannot make it (offline, not switched on yet, nothing to ask for) the family sees one plain sentence.
 */
export function LetterButton({ lang, missingId, hospital, className }: { lang: Lang; missingId: string; hospital: boolean; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function make() {
    setBusy(true);
    setFailed(false);
    try {
      const made = await api<{ requestId: string }>("/api/p/requests", { missingId, lang });
      router.push(`/p/requests?lang=${lang}#r-${made.requestId}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/p/login?lang=${lang}`);
        return;
      }
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <PButton variant="secondary" icon={<FileText />} loading={busy} onClick={make} className={className}>
        {busy ? tp(lang, "lookingLetterBusy") : tp(lang, hospital ? "lookingLetter" : "lookingLetterGeneric")}
      </PButton>
      {failed && <ErrorNote>{tp(lang, "lookingLetterError")}</ErrorNote>}
    </div>
  );
}
