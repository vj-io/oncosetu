"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { Printer, RefreshCw } from "lucide-react";
import { Button, EmptyState, Wordmark } from "@/components/ui";
import { registrationCopy } from "@/i18n/registration";
import { cardKey, postJson, stashCardToken } from "./api";
import { Notice, PRINT_CSS } from "./Notice";
import { WRAP } from "./style";

const group = (t: string) => t.match(/.{1,4}/g)?.join("-") ?? t;

/**
 * The printable card. The QR encodes ONLY the opaque token (FR-ID-01). Only an HMAC of it is stored, so the plain token
 * exists in this browser tab from registration (or reissue) until it is closed; after that the card can only be replaced.
 */
export function QrCard({ patientId, brand, accession }: { patientId: string; brand: "OncoSetu" | "Setu Records"; accession: string }) {
  // The token only exists in this tab's sessionStorage (null on the server and in any other tab).
  const stored = useSyncExternalStore(
    () => () => {},
    () => { try { return sessionStorage.getItem(cardKey(patientId)); } catch { return null; } },
    () => null,
  );
  const [fresh, setFresh] = useState<string | null>(null);
  const token = fresh ?? stored;
  const [svg, setSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    QRCode.toString(token, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => alive && setSvg(s));
    return () => { alive = false; };
  }, [token]);

  async function reissue() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ token: string }>(`/api/patients/${patientId}/token`, { action: "reissue" });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    stashCardToken(patientId, r.data.token);
    setFresh(r.data.token);
  }

  if (!token) {
    return (
      <div className="grid gap-4">
        <EmptyState
          title="The card is not shown again"
          description="For safety only a scrambled form of the code is stored, so a printed card cannot be re-created. Issuing a replacement stops the old card from working."
          action={<Button className={WRAP} onClick={reissue} loading={busy} icon={<RefreshCw aria-hidden />}>Issue a replacement card</Button>}
        />
        {error && <Notice tone="conflict" title={error} />}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <style>{PRINT_CSS}</style>
      <div className="print-area">
        <article aria-label="Records card" className="grid w-full max-w-[24rem] gap-3 border border-ink bg-matte p-5 text-ink print:max-w-[90mm] print:break-inside-avoid">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Wordmark brand={brand} className="text-[1.15rem] whitespace-nowrap" />
            <span className="ds-kicker text-[10px]">{registrationCopy.card.heading.en} · {registrationCopy.card.heading.hi}</span>
          </header>
          <div className="mx-auto w-44 border border-rule bg-white p-1 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="QR code of the card code" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-center font-mono text-[13px] tracking-[0.08em]" aria-label={`${registrationCopy.card.code.en}: ${token}`}>{group(token)}</p>
          <p className="text-center font-mono text-[10px] tracking-[0.12em] text-faint">ACC. {accession}</p>
          <p className="text-[13px] leading-snug">{registrationCopy.card.identifies.en}</p>
          <p lang="hi" className="font-deva text-[13px] leading-snug">{registrationCopy.card.identifies.hi}</p>
          <p className="border-t border-rule pt-2 text-[12px] leading-snug text-muted">{registrationCopy.card.lost.en}</p>
          <p lang="hi" className="font-deva text-[12px] leading-snug text-muted">{registrationCopy.card.lost.hi}</p>
        </article>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()} icon={<Printer aria-hidden />}>Print card</Button>
        <Button variant="secondary" className={WRAP} onClick={reissue} loading={busy} icon={<RefreshCw aria-hidden />}>Replace card (old one stops working)</Button>
      </div>
      {error && <Notice tone="conflict" title={error} />}
    </div>
  );
}
