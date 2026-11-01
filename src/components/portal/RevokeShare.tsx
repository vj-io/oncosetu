"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tp } from "@/i18n/patient";
import { ErrorNote, PButton } from "./ui";

/** Switches a share link off with one tap; the link answers "gone" from the next request. */
export function RevokeShare({ lang, shareId }: { lang: "en" | "hi"; shareId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shares/${shareId}/revoke`, { method: "POST" }) // Radar-share's endpoint: allows the patient or caregiver of the link's patient;
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(tp(lang, "genericError"));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <PButton variant="secondary" loading={busy} onClick={revoke}>{tp(lang, "shareRevoke")}</PButton>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
