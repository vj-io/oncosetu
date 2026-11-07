import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Ban, Check, KeyRound, Link2, Timer, Undo2 } from "lucide-react";
import {
  Badge,
  BrassSeal,
  ButtonLink,
  Chip,
  EmptyFrame,
  Frame,
  KeyValue,
  Placard,
  QuoteHighlight,
  SectionHeader,
  Spotlight,
  StatusBadge,
  Wordmark,
} from "@/components/ui";
import { EvidenceGateDemo } from "@/components/landing/EvidenceGateDemo";

const HERO_TEXT = `Date of admission: 10/03/2026
Procedure: Wide local excision, left breast, done on 12/03/2026 under general anaesthesia.
Specimen sent for histopathology; report awaited.`;
const HERO_QUOTE = "Wide local excision, left breast, done on 12/03/2026";
const HERO_AT = HERO_TEXT.indexOf(HERO_QUOTE);

const STATS = [
  { figure: "≈1.57M", text: "new cancer cases projected in India for 2025", note: "National projection" },
  { figure: "55.7%", text: "of rural cancer survivors surveyed had sought a second or multiple opinion", note: "Community study, Rajasthan" },
  { figure: "4.3 h", text: "median travel time to a tertiary cancer centre", note: "Mixed-methods study, N = 192" },
  { figure: "46–54%", text: "of patients in published Indian studies were unaware of their diagnosis", note: "Why patient copy is neutral by default" },
];

const NEVER = ["complete history", "the AI is accurate", "clinically verified", "expected after surgery", "legally required within 72 hours", "available at any centre"];
const ALWAYS = [
  "every displayed fact is traceable to a verbatim source quote",
  "document index",
  "documents not in file",
  "records provided to OncoSetu",
];

function Room({
  n,
  title,
  medium,
  children,
  visual,
  className,
}: {
  n: string;
  title: string;
  medium: string;
  children: ReactNode;
  visual: ReactNode;
  className?: string;
}) {
  return (
    <li className={`ds-reveal grid content-start gap-5 ${className ?? ""}`}>
      <Frame matte className="h-full">
        <div className="grid h-full min-h-60 place-items-center bg-surface px-4 py-6 sm:px-6">{visual}</div>
      </Frame>
      <div className="grid gap-1.5 px-1">
        <p className="ds-kicker">Step {n}</p>
        <h3 className="text-xl tracking-[-0.02em]">{title}</h3>
        <p className="text-[15px] text-muted">{children}</p>
        <p className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">{medium}</p>
      </div>
    </li>
  );
}

export default function Home() {
  return (
    <div className="relative">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-obsidian focus:px-4 focus:py-3 focus:text-gallery">
        Skip to content
      </a>
      <header className="relative z-20 border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Wordmark />
          <span className="hidden font-mono text-[11px] tracking-[0.16em] text-faint uppercase md:inline">Records continuity for cancer care</span>
          <nav aria-label="Sign in" className="ml-auto flex items-center gap-2">
            <Link href="/p/login" className="hidden h-11 items-center px-3 font-mono text-[12px] tracking-[0.12em] text-muted uppercase hover:text-ink sm:inline-flex">
              Patient portal
            </Link>
            <ButtonLink href="/login" variant="secondary">
              Staff demo
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-x-clip">
          <Spotlight />
          <div className="relative mx-auto grid max-w-gallery items-center gap-14 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-28">
            <div>
              <p className="ds-kicker">Oncology records continuity · India</p>
              <h1 className="mt-5 text-display">Every fact on file points back to its source.</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                OncoSetu turns the papers a cancer patient carries between hospitals into a document index the next clinic can check. A fact is shown only
                when a verbatim quote in the source supports it. Any record the file mentions but does not contain is listed as missing, with a button to
                request it.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/login" size="lg">
                  Open the staff demo <ArrowRight aria-hidden />
                </ButtonLink>
                <ButtonLink href="/p/login" size="lg" variant="secondary">
                  Patient / caregiver portal
                </ButtonLink>
              </div>
              <p className="ds-kicker mt-7">Academic prototype · synthetic records only · does not diagnose, stage or recommend</p>
            </div>

            <div className="relative mx-auto w-full max-w-xl pt-6 lg:max-w-none">
              <Frame matte animate className="lg:ml-12">
                <div className="ds-grain px-5 py-6 font-mono text-[12px] leading-[1.95] text-label sm:px-7 sm:py-7 sm:text-[12.5px]">
                  <div className="mb-3 grid gap-0.5 border-b border-rule pb-2 text-[11px] leading-snug tracking-[0.12em] text-faint uppercase">
                    <span>Demo General Hospital · p.2</span>
                    <span>Discharge summary · synthetic</span>
                  </div>
                  <QuoteHighlight text={HERO_TEXT} start={HERO_AT} end={HERO_AT + HERO_QUOTE.length} delay={700} />
                </div>
              </Frame>
              <Placard
                animate
                delay={1300}
                className="relative z-10 mx-3 -mt-6 sm:mx-10 lg:mr-24 lg:-ml-4"
                kicker="Document index · one item"
                title="Surgery, as written"
                status={<StatusBadge status="verified_matches_source" />}
                what="Wide local excision · 12 Mar 2026"
                where="Discharge summary · page 2 · quote above"
                who="Checked against the page by records staff"
                when="Done 12 Mar · document dated 15 Mar · received 28 Oct 2026"
              />
              <div className="absolute -top-6 right-1 z-20 sm:-right-5">
                <BrassSeal animate delay={2000} code="S0·7F3A21" label="Sealed" size={104} />
              </div>
            </div>
          </div>
        </section>

        {/* The problem */}
        <section aria-labelledby="problem" className="border-t border-rule bg-surface/60">
          <div className="mx-auto max-w-gallery px-4 py-20 sm:px-8 sm:py-24">
            <SectionHeader
              kicker="The problem"
              title={<span id="problem">The patient carries the file.</span>}
              description="Cancer care in India crosses institutions. Reports travel as paper files, phone photos and WhatsApp PDFs. Each new centre starts from whatever the family remembered to bring."
            />
            <ul className="mt-10 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
              {STATS.map((s, i) => (
                <li key={s.figure} className="ds-reveal grid content-start gap-3 bg-matte px-6 py-7" style={{ animationDelay: `${i * 60}ms` }}>
                  <p className="font-display text-[2.75rem] leading-none tracking-[-0.04em] tabular-nums">{s.figure}</p>
                  <p className="text-[15px] leading-snug">{s.text}</p>
                  <p className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">{s.note}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-faint">Figures are from published Indian studies; the sources are listed in the project documents.</p>
            <div className="mt-12 grid max-w-3xl gap-2 border-l-2 border-ink pl-5">
              <p className="ds-kicker">What is not known</p>
              <p className="text-lg leading-relaxed">
                No one has measured how often outside records are missing at an oncology consultation in India. The pilot is built to count it. That count
                decides what happens next.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="walk" className="border-t border-rule">
          <div className="mx-auto max-w-gallery px-4 py-20 sm:px-8 sm:py-24">
            <SectionHeader
              kicker="How it works"
              title={<span id="walk">Seven steps, from paper to shared index.</span>}
              description="From the bag of papers at the desk to a link the next clinic can open. No hospital has to integrate with us."
            />
            <ol className="mt-12 grid gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
              <Room
                n="1"
                title="Collect the papers"
                medium="Desk camera · patient upload link · PDFs forwarded on WhatsApp"
                visual={
                  <div className="relative h-36 w-52">
                    {["WhatsApp PDF", "Phone photo", "Printed report · 4 pp"].map((l, i) => (
                      <div
                        key={l}
                        className="absolute inset-x-6 top-0 h-28 border border-rule bg-matte px-3 py-2 shadow-placard"
                        style={{ transform: `translate(${(i - 1) * 18}px, ${i * 10}px) rotate(${(i - 1) * 4}deg)` }}
                      >
                        <p className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">{l}</p>
                        <div className="mt-2 grid gap-1.5">
                          {[80, 64, 72, 48].map((w) => (
                            <span key={w} className="h-1 bg-alcove" style={{ width: `${w}%` }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                }
              >
                Paper, photos and forwarded PDFs. The same file is never added twice. Handwritten pages are kept as pictures and never read by the software. X-ray, CT, PET-CT, MRI, ultrasound and ECG reports can be uploaded and kept too: the index reads the written report, not the images themselves.
              </Room>
              <Room
                n="2"
                title="Every fact must show its words"
                medium="A fact is kept only if its exact words are on the page"
                className="lg:col-span-2"
                visual={
                  <div className="grid w-full max-w-lg gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-matte px-3 py-2.5">
                      <span className="font-mono text-[12px] text-label">
                        “…done on <mark className="ds-quote">12/03/2026</mark>…”
                      </span>
                      <Badge tone="verified" icon={<Check />}>
                        Found in page text
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-matte px-3 py-2.5">
                      <span className="font-mono text-[12px] text-muted line-through decoration-madder">“…margins clear…”</span>
                      <StatusBadge status="rejected_unsupported" />
                    </div>
                  </div>
                }
              >
                The software may suggest a fact, but it is kept only if the exact words are found on the page. A report with another patient’s name is held back, and anything read from a blurry photo is flagged for a person to check.
              </Room>
              <Room
                n="3"
                title="Document index"
                medium="What · Where · Who · When"
                visual={
                  <div className="w-full max-w-xs border border-rule bg-matte px-4 py-4 shadow-placard">
                    <KeyValue
                      className="text-[13px]"
                      items={[
                        { label: "What", value: "Excision documented" },
                        { label: "Where", value: "Discharge summary · p.2" },
                        { label: "Who", value: "Records officer" },
                        { label: "When", value: "12 Mar 2026" },
                      ]}
                    />
                  </div>
                }
              >
                Every line carries its source page, its quote, who verified it and three separate dates: event, document, received.
              </Room>
              <Room
                n="4"
                title="Missing papers"
                medium="Fixed rules, switched on only after a clinician has reviewed them"
                className="lg:col-span-2"
                visual={
                  <div className="grid w-full max-w-lg gap-6">
                    <EmptyFrame title="Histopathology report" detail="Mentioned in the discharge summary, page 2, for the surgery on 12 Mar 2026" />
                  </div>
                }
              >
                Documents the file refers to but does not contain are listed as missing. The wording is administrative only: never “care gaps”, never “should
                have been done”.
              </Room>
              <Room
                n="5"
                title="Records Request Kit"
                medium="EN / HI letter · reminders at day 7 and 21"
                visual={
                  <ol className="grid w-full max-w-[15rem] gap-2">
                    {(["drafted", "sent", "reminder_due", "fulfilled"] as const).map((s) => (
                      <li key={s} className="flex">
                        <StatusBadge status={s} />
                      </li>
                    ))}
                  </ol>
                }
              >
                Each missing document becomes a letter the patient or caregiver sends. It cites their right to records and does not claim a deadline. Time to
                fulfil is measured.
              </Room>
              <Room
                n="6"
                title="What’s new"
                medium="Everything that arrived since the last sealed visit"
                visual={
                  <div className="flex w-full max-w-sm items-center gap-4">
                    <ul className="grid flex-1 gap-1.5 text-[13px]">
                      {[
                        ["New since last visit", "3"],
                        ["Newly received older", "1"],
                        ["Conflicts", "1"],
                        ["Patient said", "2"],
                        ["Not in file", "1"],
                      ].map(([k, v]) => (
                        <li key={k} className="flex justify-between gap-3 border-b border-rule pb-1">
                          <span>{k}</span>
                          <span className="font-mono tabular-nums">{v}</span>
                        </li>
                      ))}
                    </ul>
                    <BrassSeal code="S1·C0DE" label="Sealed" size={84} />
                  </div>
                }
              >
                Returning visits open on what changed: new items, older records that just arrived (clearly labelled), conflicts and patient statements.
              </Room>
              <Room
                n="7"
                title="Share link"
                medium="Passcode · expiry date · can be switched off any time"
                visual={
                  <div className="grid w-full max-w-xs gap-3">
                    <p className="flex items-center gap-2 border border-rule bg-matte px-3 py-2 font-mono text-[12px] text-label">
                      <Link2 aria-hidden className="size-4 shrink-0 text-setu" />
                      <span className="truncate">/s/q7Hk2#k=…</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="setu" icon={<KeyRound />}>
                        Passcode on
                      </Badge>
                      <Badge icon={<Timer />}>7 days</Badge>
                      <Badge tone="shadow" icon={<Undo2 />}>
                        Revocable
                      </Badge>
                    </div>
                    <p className="ds-kicker text-[11px]">Document index, not a clinical summary</p>
                  </div>
                }
              >
                The next clinic opens the verified index without an account, with the list of documents not in the file printed on it.
              </Room>
            </ol>
          </div>
        </section>

        {/* Interactive demo */}
        <section aria-labelledby="gate" className="relative border-t border-rule bg-surface/60">
          <div className="mx-auto max-w-gallery px-4 py-20 sm:px-8 sm:py-24">
            <SectionHeader
              kicker="Try it"
              title={<span id="gate">Try to fool it.</span>}
              description="The software proposes a fact with a quote. We do not take its word: we search the page for those exact words. If they are there, the fact goes in the index. Change one digit and it is refused."
            />
            <div className="mt-12">
              <EvidenceGateDemo />
            </div>
            <p className="mt-8 max-w-3xl text-sm text-faint">
              What this check cannot catch: a line the software missed, right words attached to the wrong test, or a misread photo quoted faithfully. Those are measured separately and shown to the person checking.
            </p>
          </div>
        </section>

        {/* Safety boundary */}
        <section aria-labelledby="safety" className="border-t border-rule">
          <div className="mx-auto max-w-gallery px-4 py-20 sm:px-8 sm:py-24">
            <SectionHeader kicker="Safety boundary" title={<span id="safety">What OncoSetu does not do.</span>} />
            <div className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
              <Frame matte caption="Intended-use statement · draft for ethics and CDSCO review">
                <blockquote className="px-5 py-6 sm:px-8 sm:py-8">
                  <p className="font-display text-[1.05rem] leading-relaxed tracking-[-0.01em] sm:text-[1.35rem]">
                    “OncoSetu is records-management software that stores, organises and displays documents and patient statements provided for a person
                    receiving cancer care, links each displayed item to its source, identifies source documents that are referenced but absent from the
                    file, and supports authorised people in verifying, sharing and requesting records. It does not diagnose, stage, predict, risk-score,
                    interpret images or results, recommend or alter treatment, or calculate doses. All clinical decisions are made by qualified
                    professionals using the source documents.”
                  </p>
                </blockquote>
              </Frame>
              <div className="grid content-start gap-10">
                <div>
                  <h3 className="ds-kicker mb-4">Words we never use</h3>
                  <ul className="grid gap-2">
                    {NEVER.map((w) => (
                      <li key={w} className="flex items-center gap-3 border-b border-rule pb-2">
                        <Ban aria-hidden className="size-4 shrink-0 text-madder" />
                        <span className="sr-only">Never: </span>
                        <span className="text-[15px] text-muted line-through decoration-madder/70">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="ds-kicker mb-4">What we say instead</h3>
                  <ul className="grid gap-2">
                    {ALWAYS.map((w) => (
                      <li key={w} className="flex items-start gap-3 border-b border-rule pb-2">
                        <Check aria-hidden className="mt-1 size-4 shrink-0 text-sage-ink" />
                        <span className="text-[15px]">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip kicker="Patient said" tone="patient">
                    Not yet supported by a document
                  </Chip>
                  <Chip kicker="Default" tone="unverified">
                    Neutral copy until disclosure is cleared
                  </Chip>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Honest novelty */}
        <section aria-labelledby="novelty" className="relative overflow-hidden border-t border-rule bg-surface/60">
          <Spotlight className="opacity-70" />
          <div className="relative mx-auto max-w-reading px-4 py-20 sm:px-8 sm:py-28">
            <p className="ds-kicker">What is new</p>
            <h2 id="novelty" className="mt-4 text-3xl tracking-[-0.025em] sm:text-4xl">
              What is new here, and what is not.
            </h2>
            <p className="mt-8 text-lg leading-relaxed sm:text-xl">
              Longitudinal oncology views exist inside integrated health systems, and consumer apps already collect patient-carried records in India. We
              have not found a product that, for records carried across unconnected institutions, gates every fact on a verbatim quote, lists
              referenced-but-absent documents, turns each into a tracked records request, and returns the verified index as an expiring link.
            </p>
            <p className="mt-6 border-l-2 border-ink pl-5 text-lg text-muted">
              Each piece exists; the combination in an Indian oncology intake workflow is what we are testing.
            </p>
          </div>
        </section>

        {/* Exit */}
        <section aria-labelledby="enter" className="border-t border-rule">
          <div className="mx-auto grid max-w-gallery gap-10 px-4 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="ds-kicker">Try it</p>
              <h2 id="enter" className="mt-4 max-w-2xl text-3xl tracking-[-0.025em] sm:text-[2.6rem] sm:leading-tight">
                Follow a first visit at a new centre.
              </h2>
              <p className="mt-4 max-w-xl text-muted">Demo accounts are listed on the sign-in page. Every sign-in still goes through real TOTP verification.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/login" size="lg">
                Open the staff demo <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/p/login" size="lg" variant="secondary">
                Patient / caregiver portal
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-gallery flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-8">
          <p className="font-mono text-[11px] leading-relaxed tracking-[0.12em] text-faint uppercase">
            A list of what is in the file, not a clinical summary · Every fact shown links to the exact words in the document
          </p>
          <Link href="/security" className="inline-flex h-11 items-center font-mono text-[12px] tracking-[0.12em] text-ink uppercase underline decoration-brass underline-offset-4 hover:decoration-ink">
            Security and privacy
          </Link>
          <Link href="/styleguide" className="inline-flex h-11 items-center font-mono text-[12px] tracking-[0.12em] text-ink uppercase underline decoration-brass underline-offset-4 hover:decoration-ink">
            Style guide
          </Link>
        </div>
      </footer>
    </div>
  );
}
