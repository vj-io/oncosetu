"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { Button, Field, Frame, Placard, QuoteHighlight, StageTracker, Stamp, StatusBadge, Textarea } from "@/components/ui";

// Synthetic page text. The gate below mirrors the product rule (FR-EXT-02): the quote must occur verbatim
// in the page text after whitespace normalisation only. Case and every character still count.
const PAGE = `DEMO GENERAL HOSPITAL · DEPARTMENT OF SURGERY
DISCHARGE SUMMARY                        Page 2 of 3

Name: [synthetic]          Age/Sex: 52 Y / F
UHID: DGH-204-118          Ward: Surgical II

Date of admission: 10/03/2026
Date of discharge: 15/03/2026

Procedure: Wide local excision, left breast,
done on 12/03/2026 under general anaesthesia.
Specimen sent for histopathology; report awaited.

Advice: review in surgical OPD with all
reports on 26/03/2026.`;

const PROPOSALS = [
  { id: "genuine", label: "Genuine", what: "Procedure documented", fact: "Wide local excision, 12/03/2026", quote: "Wide local excision, left breast, done on 12/03/2026" },
  { id: "fabricated", label: "Fabricated", what: "Pathology result", fact: "Margins clear", quote: "Histopathology report attached: margins clear." },
  { id: "altered", label: "One digit changed", what: "Procedure documented", fact: "Wide local excision, 13/03/2026", quote: "Wide local excision, left breast, done on 13/03/2026" },
  { id: "custom", label: "Your own quote", what: "Custom proposal", fact: "Text found verbatim on the page", quote: "" },
] as const;

type Phase = "idle" | "proposed" | "searching" | "accepted" | "rejected";
type Hit = { start: number; end: number };

function gate(page: string, quote: string): Hit | null {
  const q = quote.replace(/\s+/g, " ").trim();
  if (!q) return null;
  let norm = "";
  const map: number[] = [];
  let ws = false;
  for (let i = 0; i < page.length; i++) {
    if (/\s/.test(page[i])) {
      if (!ws && norm) {
        norm += " ";
        map.push(i);
      }
      ws = true;
    } else {
      norm += page[i];
      map.push(i);
      ws = false;
    }
  }
  const at = norm.indexOf(q);
  return at < 0 ? null : { start: map[at], end: map[at + q.length - 1] + 1 };
}

async function sha256(text: string) {
  if (!globalThis.crypto?.subtle) return "--------";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function EvidenceGateDemo() {
  const [choice, setChoice] = useState<(typeof PROPOSALS)[number]["id"]>("genuine");
  const [custom, setCustom] = useState("left breast, done on 12/03/2026");
  const [phase, setPhase] = useState<Phase>("idle");
  const [hit, setHit] = useState<Hit | null>(null);
  const [hash, setHash] = useState("");
  const [runId, setRunId] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const proposal = PROPOSALS.find((p) => p.id === choice)!;
  const quote = choice === "custom" ? custom : proposal.quote;
  const busy = phase === "proposed" || phase === "searching";

  function run() {
    timers.current.forEach(clearTimeout);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const result = gate(PAGE, quote);
    setHit(null);
    setRunId((n) => n + 1);
    setPhase("proposed");
    sha256(quote.replace(/\s+/g, " ").trim()).then(setHash);
    timers.current = [
      setTimeout(() => setPhase("searching"), reduce ? 0 : 650),
      setTimeout(
        () => {
          setHit(result);
          setPhase(result ? "accepted" : "rejected");
        },
        reduce ? 0 : 1800,
      ),
    ];
  }

  const stage = { idle: -1, proposed: 0, searching: 1, accepted: 3, rejected: 2 }[phase];

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
      <Frame matte caption="Synthetic page text · what the gate searches">
        <div className="ds-grain relative overflow-hidden px-4 py-5 font-mono text-[11.5px] leading-[1.85] text-label sm:px-6 sm:py-6 sm:text-[12.5px]">
          {phase === "searching" && (
            <span
              key={runId}
              aria-hidden
              className="ds-scan pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-transparent via-spotlight to-transparent opacity-0"
              style={{ "--scan-distance": "360px" } as CSSProperties}
            />
          )}
          {hit ? <QuoteHighlight key={runId} text={PAGE} start={hit.start} end={hit.end} delay={0} /> : <span className="whitespace-pre-wrap">{PAGE}</span>}
        </div>
      </Frame>

      <div className="grid content-start gap-6">
        <fieldset className="grid gap-2">
          <legend className="ds-kicker mb-3">What the extractor proposes</legend>
          {PROPOSALS.map((p) => (
            <label
              key={p.id}
              className={clsx(
                "flex min-h-11 cursor-pointer items-start gap-3 border px-4 py-3 transition-colors",
                choice === p.id ? "border-ink bg-matte" : "border-rule hover:bg-spotlight/60",
              )}
            >
              <input type="radio" name="proposal" value={p.id} checked={choice === p.id} onChange={() => setChoice(p.id)} className="mt-1 size-4 accent-[#111111]" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[15px]">
                  {p.label}
                  {p.id !== "custom" && <span className="text-muted"> · {p.what}</span>}
                </span>
                {p.quote && <span className="font-mono text-[12px] break-words text-muted">“{p.quote}”</span>}
              </span>
            </label>
          ))}
        </fieldset>

        {choice === "custom" && (
          <Field label="Your quote" hint="Copy any phrase from the page, or try to sneak one in. Whitespace is normalised; case and characters are not.">
            <Textarea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} />
          </Field>
        )}

        <div>
          <Button size="lg" onClick={run} loading={busy} disabled={!quote.trim()} icon={<ShieldCheck aria-hidden />}>
            Run the evidence gate
          </Button>
        </div>

        <div aria-live="polite" className="grid gap-5">
          {phase !== "idle" && (
            <StageTracker label="Evidence gate" stages={["Proposed", "Search page text", "Decision"]} current={stage} failed={phase === "rejected"} />
          )}
          {phase === "accepted" && hit && (
            <Placard
              key={runId}
              animate
              delay={350}
              kicker="Document index · new item"
              title={proposal.id === "custom" ? "Quoted text found" : proposal.what}
              status={<StatusBadge status="unverified" label="Unverified · awaiting records" />}
              what={proposal.fact}
              where={
                <>
                  Discharge summary · p.2 · chars {hit.start}–{hit.end}
                  <span className="mt-1 block font-mono text-[13px] text-muted">“{PAGE.slice(hit.start, hit.end).replace(/\s+/g, " ")}”</span>
                </>
              }
              who="Not yet verified; records staff check it against the source"
              when="Event date stays separate from document and received dates"
              accession={hash ? `${hash.slice(0, 4)}·${hash.slice(4, 8)}`.toUpperCase() : undefined}
              footer={<span className="font-mono text-[11px] tracking-[0.1em] text-faint">SHA-256 OF QUOTE</span>}
            />
          )}
          {phase === "rejected" && (
            <div className="grid gap-3 border border-madder/40 bg-madder-tint/50 px-5 py-5">
              <div>
                <Stamp key={runId} tone="conflict" animate rotate={-4}>
                  Rejected · quote not in page text
                </Stamp>
              </div>
              <p className="text-[15px] text-ink">
                Nothing is shown to the clinic. The proposal is logged as <code className="font-mono text-[13px] text-madder-ink">rejected_unsupported</code> for the evaluation set.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
