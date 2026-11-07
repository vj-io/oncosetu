"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import type { Lang } from "@/core/types";
import { tp } from "@/i18n/patient";
import { tv } from "@/i18n/privacy";
import { formatDateTimeIN } from "@/server/portal/summary";
import { ErrorNote, PButton } from "./ui";

/** The privacy notice with a tick box. Saving records the notice version and the time (per person) and is audit-logged on the server. */
export function PrivacyNotice({ lang, version, initial }: { lang: Lang; version: string; initial: { version: string; at: string; current: boolean } | null }) {
  const router = useRouter();
  const [ack, setAck] = useState(initial);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/p/privacy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, lang }) });
      if (res.status === 401) { router.replace(`/p/login?lang=${lang}`); return; }
      if (!res.ok) throw new Error(String(res.status));
      setAck({ version, at: new Date().toISOString(), current: true });
      setSaved(true);
    } catch {
      setError(tp(lang, "genericError"));
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="notice-h" className="grid gap-4 border border-rule bg-surface px-5 py-5">
      <h2 id="notice-h" className="text-xl">{tv(lang, "noticeTitle")}</h2>
      <ul className="grid gap-2 text-[17px]">
        <li>{tv(lang, "noticeWhat")}</li>
        <li>{tv(lang, "noticeWhy")}</li>
        <li>{tv(lang, "noticeHow")}</li>
      </ul>
      <p className="text-[15px] text-muted">{tv(lang, "noticeVersion", { version })}</p>
      {saved && <p role="status" className="flex items-start gap-2 border border-sage bg-sage-tint px-4 py-3 text-sage-ink"><CircleCheck aria-hidden className="mt-1 size-5 shrink-0" />{tv(lang, "ackSaved")}</p>}
      {ack?.current ? (
        <p data-testid="ack-done" className="text-[17px]">{tv(lang, "ackDone", { date: formatDateTimeIN(new Date(ack.at), lang), version: ack.version })}</p>
      ) : (
        <div className="grid gap-3">
          {ack && !ack.current && <p className="text-[15px] text-muted">{tv(lang, "ackOld")}</p>}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[17px]">
            <input type="checkbox" className="size-5 accent-[var(--color-setu)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {tv(lang, "ackLabel")}
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <PButton big loading={busy} disabled={!checked || busy} onClick={save} className="w-full sm:w-auto">{tv(lang, "ackButton")}</PButton>
        </div>
      )}
    </section>
  );
}
