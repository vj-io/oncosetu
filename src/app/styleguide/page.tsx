"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox, Stamp as StampIcon } from "lucide-react";
import {
  Avatar,
  Badge,
  BrassSeal,
  Button,
  ButtonLink,
  Checkbox,
  Chip,
  Dialog,
  EmptyFrame,
  EmptyState,
  Field,
  Frame,
  Input,
  KeyValue,
  Kbd,
  LanguageToggle,
  Placard,
  ProgressMeter,
  QuoteHighlight,
  SectionHeader,
  Select,
  Skeleton,
  Spotlight,
  StageTracker,
  Stamp,
  STATUS_META,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  Wordmark,
  useToast,
  type Lang,
  type Status,
  type Tone,
} from "@/components/ui";
import { PatientWorkspaceHeader } from "@/components/shell";

// Same WCAG formula used to measure the tokens in globals.css, run live so the numbers can be checked.
const lum = (hex: string) => {
  const [r, g, b] = hex.match(/\w\w/g)!.map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};

const ROOM = [
  ["gallery", "#f5f4f0", "Page wall"],
  ["surface", "#faf9f5", "Placards, panels"],
  ["matte", "#ffffff", "Frames, inputs"],
  ["alcove", "#efeeea", "Sunken wells"],
  ["ink", "#1b1c1a", "Label ink"],
  ["muted", "#5c5a55", "Secondary text"],
  ["faint", "#6a6862", "Mono labels"],
  ["rule", "#d9d6ce", "Hairlines (decorative)"],
  ["control", "#8a877f", "Control borders (3:1)"],
  ["spotlight", "#fff4d6", "Cone, hover"],
  ["highlight", "#ffecb3", "Lit quote"],
] as const;

const PAIRS: { name: string; meaning: string; tone: Tone; base: string; ink: string; tint: string }[] = [
  { name: "setu", meaning: "Brand · info", tone: "setu", base: "#0f6e6a", ink: "#0b5c58", tint: "#e2efed" },
  { name: "sage", meaning: "Verified", tone: "verified", base: "#6f9476", ink: "#3e6447", tint: "#e6eee4" },
  { name: "amber", meaning: "Unverified · proposed · low confidence", tone: "unverified", base: "#b27512", ink: "#875500", tint: "#f9eed6" },
  { name: "madder", meaning: "Conflict · identity warning", tone: "conflict", base: "#b4432f", ink: "#9b2f1e", tint: "#f7e3de" },
  { name: "violet", meaning: "Patient said", tone: "patient", base: "#6e5cb8", ink: "#553f9e", tint: "#ebe7f5" },
  { name: "slate", meaning: "Shadow mode", tone: "shadow", base: "#8a877f", ink: "#55534e", tint: "#eae8e2" },
  { name: "brass", meaning: "Sealed snapshot only", tone: "brass", base: "#c9a84c", ink: "#6b5212", tint: "#f3e7c2" },
];

const STATUS_GROUPS: [string, Status[]][] = [
  ["Verification", ["unverified", "verified_matches_source", "edited", "rejected", "disputed"]],
  ["Identity", ["match", "mismatch", "insufficient"]],
  ["Missing item", ["expected", "requested", "received", "closed", "unobtainable", "dismissed"]],
  ["Request", ["drafted", "sent", "reminder_due", "open_21d", "fulfilled", "withdrawn"]],
  ["Document", ["queued", "processing", "done", "needs_review", "failed"]],
  ["Item flags", ["conflict", "patient_said", "low_confidence", "binding_uncertain", "shadow_mode", "sealed", "rejected_unsupported"]],
];

const QUOTE_TEXT = "Procedure: Wide local excision, left breast, done on 12/03/2026 under general anaesthesia.";

function Block({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-8 border-t border-rule py-14">
      <p className="ds-kicker">{kicker}</p>
      <h2 id={`${id}-h`} className="mt-2 mb-8 text-[1.75rem] tracking-[-0.025em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="ds-kicker mb-3">{children}</p>;
}

export default function StyleguidePage() {
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [replay, setReplay] = useState(0);
  const [lang, setLang] = useState<Lang>("en");
  const [stage, setStage] = useState(3);

  return (
    <div className="relative">
      <Spotlight />
      <header className="relative border-b border-rule">
        <div className="mx-auto flex h-16 max-w-gallery items-center gap-4 px-4 sm:px-8">
          <Link href="/" aria-label="OncoSetu home">
            <Wordmark />
          </Link>
          <span className="hidden font-mono text-[11px] tracking-[0.16em] text-faint uppercase sm:inline">Style guide · Museum Placard</span>
          <Link href="/" className="ml-auto inline-flex h-11 items-center gap-2 font-mono text-[12px] tracking-[0.12em] text-muted uppercase hover:text-ink">
            <ArrowLeft aria-hidden className="size-4" /> Gallery
          </Link>
        </div>
      </header>

      <main id="main" className="relative mx-auto max-w-gallery px-4 pt-12 pb-24 sm:px-8">
        <SectionHeader
          as="h1"
          kicker="Living style guide · every component and state"
          title="Museum Placard, extended for a clinical UI."
          description="Gallery white, a warm spotlight, label ink and mono accession codes. One hue per meaning, always paired with a word or icon. Motion runs only when the reader allows it; the resting state is the final state."
          actions={
            <Button variant="secondary" onClick={() => setReplay((n) => n + 1)}>
              Replay motion
            </Button>
          }
        />

        <Block id="tokens" kicker="Tokens" title="The room and its semantic pairs">
          <Label>Room</Label>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ROOM.map(([name, hex, use]) => (
              <li key={name} className="border border-rule bg-matte">
                <div className="h-14 border-b border-rule" style={{ background: hex }} />
                <div className="px-3 py-2">
                  <p className="font-mono text-xs">{name}</p>
                  <p className="font-mono text-[11px] text-faint">{hex}</p>
                  <p className="mt-1 text-xs text-muted">{use}</p>
                </div>
              </li>
            ))}
          </ul>
          <Label>
            <span className="mt-10 block">Semantic pairs · base + ink, contrast measured live (ink on tint / on gallery)</span>
          </Label>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PAIRS.map((p) => (
              <li key={p.name} className="grid grid-cols-[3.5rem_1fr] border border-rule bg-matte">
                <div style={{ background: p.base }} aria-hidden />
                <div className="px-3 py-3" style={{ background: p.tint }}>
                  <p className="font-mono text-xs" style={{ color: p.ink }}>
                    {p.name} · {p.meaning}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink">
                    {p.base} / {p.ink} / {p.tint}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink">
                    {ratio(p.ink, p.tint)}:1 · {ratio(p.ink, "#f5f4f0")}:1 · base {ratio(p.base, "#f5f4f0")}:1
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="type" kicker="Typography" title="Instrument Sans, Inter Tight, JetBrains Mono, Noto Sans Devanagari">
          <div className="grid gap-6">
            <p className="text-display">Every fact, exhibited.</p>
            <p className="text-4xl tracking-[-0.03em]">Heading · Instrument Sans 400</p>
            <p className="max-w-2xl text-lg">Body · Inter Tight. Records provided to OncoSetu, organised as a document index with a verbatim quote for every fact.</p>
            <p className="ds-kicker">Kicker · JetBrains Mono · Wing · Desk · ACC. 7F3A·21C9</p>
            <p lang="hi" className="font-deva text-[19px]">
              हिन्दी · यहाँ केवल वही रिकॉर्ड दिखते हैं जो हमें दिए गए हैं।
            </p>
          </div>
        </Block>

        <Block id="buttons" kicker="Actions" title="Buttons">
          <div className="grid gap-6">
            {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-3">
                <span className="w-24 font-mono text-xs text-faint">{v}</span>
                <Button variant={v} size="sm">
                  Small
                </Button>
                <Button variant={v}>Examine</Button>
                <Button variant={v} size="lg">
                  Large
                </Button>
                <Button variant={v} loading>
                  Saving
                </Button>
                <Button variant={v} disabled>
                  Disabled
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 font-mono text-xs text-faint">link</span>
              <ButtonLink href="/login">Button link</ButtonLink>
              <Button icon={<StampIcon aria-hidden />}>With icon</Button>
            </div>
          </div>
        </Block>

        <Block id="forms" kicker="Inputs" title="Fields, selects, checkboxes, switches">
          <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
            <Field label="Email" hint="Work address issued by the hospital.">
              <Input type="email" placeholder="name@hospital.example" />
            </Field>
            <Field label="Authenticator code" error="That code is not valid or has expired.">
              <Input defaultValue="12345" className="font-mono tracking-[0.3em]" />
            </Field>
            <Field label="Reason for edit" optional className="sm:col-span-2">
              <Textarea placeholder="Required when editing a verified item" />
            </Field>
            <Field label="Document type">
              <Select defaultValue="discharge">
                <option value="discharge">Discharge summary</option>
                <option value="pathology">Pathology report</option>
                <option value="imaging">Imaging report</option>
              </Select>
            </Field>
            <Field label="Disabled">
              <Input disabled defaultValue="Read-only value" />
            </Field>
            <div>
              <Checkbox label="Matches source" description="I opened the source page and compared the quote." defaultChecked />
              <Checkbox label="Unchecked option" />
              <Checkbox label="Disabled option" disabled />
            </div>
            <div>
              <Switch label="Shadow mode" description="Rule runs and logs, nothing shown" defaultChecked />
              <Switch label="Voice read-back" description="Only when disclosure is cleared" />
              <div className="mt-3 flex items-center gap-3">
                <LanguageToggle value={lang} onChange={setLang} />
                <span className="font-mono text-xs text-faint">lang = {lang}</span>
              </div>
            </div>
          </div>
        </Block>

        <Block id="exhibits" kicker="Exhibits" title="Frames, placards and empty frames">
          <div key={`ex-${replay}`} className="grid gap-10 lg:grid-cols-2">
            <div className="grid content-start gap-6">
              <Frame matte animate caption="Frame · matte · caption">
                <p className="px-5 py-8 font-mono text-[13px] leading-relaxed">
                  <QuoteHighlight text={QUOTE_TEXT} start={11} end={63} delay={400} />
                </p>
              </Frame>
              <Placard
                animate
                delay={900}
                kicker="Document index · item 07"
                title="Procedure documented"
                status={<StatusBadge status="verified_matches_source" />}
                what="Wide local excision · 12 Mar 2026"
                where={
                  <>
                    Discharge summary · p.2
                    <span className="mt-1 block font-mono text-[13px] text-muted">“Wide local excision, left breast, done on 12/03/2026”</span>
                  </>
                }
                who="R. Iyer, records officer · 28 Oct 2026"
                when="Event 12 Mar · document 15 Mar · received 28 Oct 2026"
                accession="7F3A·21C9"
                footer={
                  <Stamp key={`st-${replay}`} animate delay={1500}>
                    Verified
                  </Stamp>
                }
              />
            </div>
            <div className="grid content-start gap-8">
              <EmptyFrame animate title="Histopathology report" detail="for procedure documented on 12 Mar 2026 (Discharge summary, p.2)" accession="RAD-02" action={<Button size="sm" variant="secondary">Draft request</Button>} />
              <EmptyFrame title="Imaging report" detail="for scan documented on 02 Feb 2026 (Referral letter, p.1)" status="requested" />
              <EmptyFrame title="Discharge summary" detail="for admission documented on 03 Jan 2026 (Prescription, p.1)" status="received" />
              <EmptyFrame title="Operative notes" detail="for procedure documented on 12 Mar 2026 (Discharge summary, p.2)" status="unobtainable" />
              <Frame className="px-5 py-5">
                <p className="ds-kicker mb-2">Frame (card)</p>
                <p className="text-[15px] text-muted">A white matte panel with the frame shadow; `Card` is an alias.</p>
              </Frame>
            </div>
          </div>
        </Block>

        <Block id="status" kicker="Status" title="Badges, chips, stamps and the seal">
          <div className="grid gap-8">
            {STATUS_GROUPS.map(([group, list]) => (
              <div key={group}>
                <Label>{group}</Label>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <StatusBadge key={s} status={s} />
                  ))}
                </div>
              </div>
            ))}
            <p className="font-mono text-[11px] text-faint">{Object.keys(STATUS_META).length} statuses in STATUS_META</p>
            <div>
              <Label>Provenance chips</Label>
              <div className="flex flex-wrap gap-2">
                <Chip kicker="Document" tone="verified">
                  Verified by Dr A. Rao
                </Chip>
                <Chip kicker="Document" tone="unverified">
                  Proposed · not yet verified
                </Chip>
                <Chip kicker="Patient said" tone="patient">
                  Not yet supported by a document
                </Chip>
                <Chip kicker="Conflict" tone="conflict">
                  Two dates for one procedure
                </Chip>
                <Chip kicker="Rule" tone="shadow">
                  Shadow mode · not shown to clinic
                </Chip>
              </div>
            </div>
            <div key={`seal-${replay}`} className="flex flex-wrap items-center gap-10">
              <div>
                <Label>Stamps</Label>
                <div className="flex flex-wrap items-center gap-5 py-2">
                  <Stamp animate>Verified</Stamp>
                  <Stamp animate tone="conflict" rotate={2} delay={150}>
                    Disputed
                  </Stamp>
                  <Stamp animate tone="neutral" rotate={-1} delay={300}>
                    Received
                  </Stamp>
                </div>
              </div>
              <div>
                <Label>Brass seal (sealed snapshot only)</Label>
                <div className="flex items-center gap-6">
                  <BrassSeal animate code="S2·9C41E0" label="S2 sealed" />
                  <BrassSeal code="S1·C0DE77" label="S1 sealed" size={80} />
                </div>
              </div>
            </div>
            <div>
              <Label>Badge tones</Label>
              <div className="flex flex-wrap gap-2">
                {(["neutral", "setu", "verified", "unverified", "conflict", "patient", "shadow", "brass"] as const).map((t) => (
                  <Badge key={t} tone={t}>
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Block>

        <Block id="quotes" kicker="Evidence" title="Quote highlight">
          <div key={`q-${replay}`} className="grid max-w-3xl gap-6 font-mono text-[14px] leading-relaxed">
            <p>
              <QuoteHighlight text={QUOTE_TEXT} start={11} end={63} />
            </p>
            <p>
              <QuoteHighlight text="Tab. Ondansetron 4 mg TDS x 5 days" start={5} end={21} lowConfidence delay={300} />
            </p>
          </div>
        </Block>

        <Block id="stages" kicker="Pipeline" title="Stage tracker">
          <div className="grid gap-10">
            <StageTracker current={stage} />
            <StageTracker current={4} failed label="Failed at extraction" />
            <StageTracker current={7} label="Complete" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setStage((s) => Math.max(0, s - 1))}>
                Back
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setStage((s) => Math.min(7, s + 1))}>
                Advance
              </Button>
            </div>
          </div>
        </Block>

        <Block id="nav" kicker="Navigation & overlays" title="Tabs, dialog, toast, tooltip">
          <div className="grid gap-8">
            <Tabs
              label="Style guide pages"
              items={[
                { href: "/styleguide", label: "Components", count: 32 },
                { href: "/styleguide/staff", label: "Staff shell" },
                { href: "/styleguide/patient", label: "Patient shell" },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setDialog(true)}>Open dialog</Button>
              <Button variant="secondary" onClick={() => toast({ title: "Snapshot S2 sealed", description: "SHA-256 9C41E0… · 14 items", tone: "brass" })}>
                Toast · sealed
              </Button>
              <Button variant="secondary" onClick={() => toast({ title: "Identity mismatch", description: "Header name differs from the patient record.", tone: "conflict" })}>
                Toast · warning
              </Button>
              <Tooltip content="Verbatim match after whitespace normalisation">
                <Button variant="ghost">Hover or focus me</Button>
              </Tooltip>
              <span className="text-sm text-muted">
                Press <Kbd>Esc</Kbd> to close overlays
              </span>
            </div>
          </div>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Reject this item?"
            description="A reason is required and the original is kept."
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setDialog(false)}>
                  Reject item
                </Button>
              </>
            }
          >
            <Field label="Reason">
              <Textarea placeholder="Quote belongs to a different patient header" />
            </Field>
          </Dialog>
        </Block>

        <Block id="data" kicker="Data" title="Table, key-value, progress, avatars">
          <div className="grid gap-10">
            <Table caption="Records queue">
              <thead>
                <tr>
                  <th>Accession</th>
                  <th>Document</th>
                  <th>Pages</th>
                  <th>Identity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["7F3A·21C9", "Discharge summary", 3, "match", "done"],
                  ["B210·0E7A", "Pathology report", 1, "insufficient", "needs_review"],
                  ["44C1·9AA0", "Prescription (handwritten)", 1, "mismatch", "failed"],
                  ["0D9E·51B2", "Imaging report", 2, "match", "processing"],
                ].map(([acc, doc, pages, id, st]) => (
                  <tr key={acc as string}>
                    <td className="font-mono text-[13px]">{acc}</td>
                    <td>{doc}</td>
                    <td className="font-mono tabular-nums">{pages}</td>
                    <td>
                      <StatusBadge status={id as Status} />
                    </td>
                    <td>
                      <StatusBadge status={st as Status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-10 lg:grid-cols-2">
              <KeyValue
                items={[
                  { label: "Event", value: "12 Mar 2026" },
                  { label: "Document", value: "15 Mar 2026" },
                  { label: "Received", value: "28 Oct 2026" },
                  { label: "Source", value: "Discharge summary · p.2" },
                ]}
              />
              <div className="grid gap-5">
                <ProgressMeter label="Pages verified" value={28} max={40} />
                <ProgressMeter label="Requests fulfilled" value={2} max={5} tone="verified" />
                <div className="flex items-center gap-3">
                  <Avatar name="Asha Rao" size="sm" />
                  <Avatar name="Rohan Iyer" />
                  <Avatar name="S K" initials="SK" size="lg" />
                </div>
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <EmptyState icon={<Inbox />} title="No documents yet" description="Capture paper at the desk or send the patient an upload link." action={<Button variant="secondary">Send upload link</Button>} />
              <div className="grid content-start gap-3 border border-rule bg-surface p-6" aria-busy="true" aria-label="Loading">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton />
                <Skeleton className="w-5/6" />
                <Skeleton className="h-24" />
              </div>
            </div>
          </div>
        </Block>

        <Block id="shells" kicker="Shells" title="Patient workspace header">
          <Frame className="px-4 pt-6 sm:px-8">
            <PatientWorkspaceHeader
              patient={{
                id: "demo",
                initials: "SD",
                name: "Sunita Devi (synthetic)",
                ageYears: 52,
                sex: "F",
                mrn: "DGH-204-118",
                accession: "P-7F3A",
                disclosure: "unknown",
                primaryContact: "caregiver",
                minor: false,
              }}
              counts={{ documents: 14, ledger: 6, completeness: 2, requests: 1 }}
            />
            <div className="py-6 text-sm text-muted">Tabs link to /patients/demo/…; the active tab follows the pathname.</div>
          </Frame>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/styleguide/staff" variant="secondary">
              Staff shell preview
            </ButtonLink>
            <ButtonLink href="/styleguide/patient" variant="secondary">
              Patient shell preview
            </ButtonLink>
          </div>
        </Block>
      </main>
    </div>
  );
}
