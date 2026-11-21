import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, FileX, HeartHandshake, Info, Send, Stethoscope, X } from "lucide-react";
import { Badge, ButtonLink, TONE, type Tone } from "@/components/ui";
import { PublicShell } from "@/components/shell/PublicShell";

function Entry({ href, icon, tone, title, text, go }: { href: string; icon: ReactNode; tone: Tone; title: string; text: string; go: string }) {
  return (
    <li>
      <Link href={href} className="group grid h-full content-start gap-3 rounded-lg border border-rule bg-surface p-6 shadow-card transition-colors hover:border-control/40">
        <span aria-hidden className={`grid size-11 place-items-center rounded-md ${TONE[tone].bg} ${TONE[tone].text} [&_svg]:size-5`}>{icon}</span>
        <span className="font-display text-xl">{title}</span>
        <span className="text-[15px] text-muted">{text}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 text-[15px] font-semibold text-setu-ink">
          {go}
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}

const STEPS = [
  { title: "Papers come in", text: "Staff upload or photograph them at the desk; patients and families send them from a phone. Scans are kept and shown, not read." },
  { title: "Every fact keeps its words", text: "Each line on the record links to the exact words on the page it came from, and says whether a person has checked it." },
  { title: "Missing papers get asked for", text: "When one paper mentions another that is not in the file, OncoSetu lists it and prepares a request letter for the other hospital." },
];

const DOES = [
  "Keeps one list of a patient’s papers, in date order",
  "Shows the source words for every fact",
  "Tracks papers that are mentioned but missing",
  "Seals the record at a visit, so any later change shows",
  "Shares papers with another doctor through a passcode link",
];
const DOES_NOT = [
  "It does not diagnose, stage cancer or read scans and results",
  "It does not suggest treatment or doses",
  "It is not a clinical summary: qualified doctors make every decision",
];

export default function Home() {
  return (
    <PublicShell>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-14 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:pb-20">
        <div className="grid gap-5">
          <Badge tone="setu" className="w-fit">Records for cancer care in India</Badge>
          <h1 className="text-display">The papers a cancer patient carries, in one list the next clinic can trust.</h1>
          <p className="max-w-[36rem] text-lg leading-relaxed text-muted">
            OncoSetu is a records index. It lists a patient&rsquo;s documents, shows the exact words behind every fact, and says which papers are missing.
            It is for hospital staff, patients and their families. It never diagnoses or advises.
          </p>
          <div className="mt-1 flex flex-wrap gap-3">
            <ButtonLink href="/login" size="lg">Hospital staff sign in</ButtonLink>
            <ButtonLink href="/p/login" size="lg" variant="secondary">Patient or family sign in</ButtonLink>
          </div>
        </div>

        <figure className="grid gap-3 rounded-xl border border-rule bg-surface p-5 shadow-card" aria-label="An example from the demo record">
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-setu-tint font-display text-setu-ink">SD</span>
            <span className="grid leading-tight"><span className="font-semibold">Sunita Deshmukh</span><span className="text-[13px] text-muted">Example · synthetic demo record</span></span>
            <Badge tone="unverified" icon={<FileX />} className="ml-auto">6 papers missing</Badge>
          </div>
          <div className="rounded-md bg-alcove px-4 py-3">
            <p className="text-[13px] text-muted">Diagnosis, as written · Chemotherapy day-care record, p.1</p>
            <p className="mt-1">&ldquo;<mark className="ds-quote">Carcinoma left breast - adjuvant chemotherapy</mark>&rdquo;</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="verified" icon={<Check />}>Checked against the page</Badge>
            <Badge tone="setu" icon={<Send />}>Letter sent for cycles 1–3</Badge>
          </div>
          <figcaption className="text-[13px] text-muted">Every line links to the words on the page it came from.</figcaption>
        </figure>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-8" aria-label="Where do you want to go?">
        <ul className="grid gap-4 md:grid-cols-3">
          <Entry href="/login" icon={<Stethoscope />} tone="setu" title="Hospital staff" text="Desk, records, doctors, admin and audit. Sign in with your authenticator app." go="Staff sign in" />
          <Entry href="/p/login" icon={<HeartHandshake />} tone="patient" title="Patient or family" text="See your papers, send new ones, and share them with a doctor. In English or Hindi." go="Sign in with your phone" />
          <Entry href="/verify" icon={<BadgeCheck />} tone="verified" title="Check a sealed record" text="Got a seal link or code from a hospital? Check it has not been changed." go="Check a seal" />
        </ul>
      </section>

      <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-14 sm:px-8 sm:py-20">
        <h2 id="how-h" className="text-[1.75rem] leading-tight sm:text-[2.125rem]">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid content-start gap-3 rounded-lg border border-rule bg-surface p-6 shadow-card">
              <span aria-hidden className="grid size-9 place-items-center rounded-full bg-pine font-display text-white">{i + 1}</span>
              <h3 className="text-lg">{s.title}</h3>
              <p className="text-[15px] text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="about" aria-labelledby="about-h" className="ds-feature scroll-mt-6 border-y border-rule">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8 sm:py-20">
          <h2 id="about-h" className="text-[1.75rem] leading-tight sm:text-[2.125rem]">About OncoSetu</h2>
          <p className="mt-3 max-w-[44rem] text-[17px] text-muted">
            A patient&rsquo;s cancer history often sits across several hospitals, as paper, phone photos and PDFs, and each new centre starts from
            scratch. OncoSetu keeps that history as one list, shows where every fact came from, and keeps track of what is still missing. It is an
            academic prototype, shown here with made-up records only.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-rule bg-gallery p-6">
              <h3 className="text-lg">What it does</h3>
              <ul className="mt-3 grid gap-2.5 text-[15px]">
                {DOES.map((t) => <li key={t} className="flex gap-2.5"><Check aria-hidden className={`mt-0.5 size-4 shrink-0 ${TONE.verified.text}`} />{t}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-rule bg-gallery p-6">
              <h3 className="text-lg">What it does not do</h3>
              <ul className="mt-3 grid gap-2.5 text-[15px]">
                {DOES_NOT.map((t) => <li key={t} className="flex gap-2.5"><X aria-hidden className={`mt-0.5 size-4 shrink-0 ${TONE.conflict.text}`} />{t}</li>)}
                <li className="flex gap-2.5"><Info aria-hidden className={`mt-0.5 size-4 shrink-0 ${TONE.setu.text}`} />Academic prototype with made-up records only</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
