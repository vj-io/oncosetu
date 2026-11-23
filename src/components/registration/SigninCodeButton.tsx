"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import { postJson } from "./api";
import { WRAP } from "./style";

type Issued = { code: string; phone: string; toCaregiver: boolean; minutes: number };

const TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

/**
 * Shows a one-time patient-portal sign-in code on this screen, for the primary contact to type on their own phone with
 * their number. The way in where no SMS can reach the patient; works alongside SMS too. The QR opens the sign-in page only.
 */
export function SigninCodeButton({ patientId }: { patientId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [got, setGot] = useState<(Issued & { until: number; url: string }) | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    if (!got) return;
    let alive = true;
    QRCode.toString(got.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => alive && setQr(s));
    return () => { alive = false; };
  }, [got]);

  async function issue() {
    setBusy(true);
    setError(null);
    const r = await postJson<Issued>(`/api/patients/${patientId}/signin-code`);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setGot({ ...r.data, until: Date.now() + r.data.minutes * 60_000, url: `${window.location.origin}/p/login` });
  }

  return (
    <div className="grid gap-2">
      <div><Button variant="secondary" className={WRAP} loading={busy} onClick={issue} icon={<KeyRound aria-hidden />}>{got ? "New sign-in code" : "Give sign-in code"}</Button></div>
      {error && <p role="alert" className="text-sm text-madder-ink">{error}</p>}
      {got && (
        <div data-testid="signin-code-panel" className="flex flex-wrap items-start gap-4 rounded-lg border border-rule bg-surface p-4">
          <div className="grid gap-1.5">
            <p className="text-sm text-muted">Sign-in code for the {got.toCaregiver ? "caregiver" : "patient"} (phone {got.phone})</p>
            <p data-testid="signin-code" className="font-mono text-3xl tracking-[0.3em]">{got.code}</p>
            <p className="text-sm text-muted">Works once, until {TIME.format(got.until)}. On their own phone they open <span className="font-medium text-ink">{got.url}</span> (or scan the code), enter this phone number and the 6 digits.</p>
          </div>
          {qr && <div aria-label="QR code that opens the patient sign-in page" role="img" className="size-28 shrink-0 bg-white p-1 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />}
        </div>
      )}
    </div>
  );
}
