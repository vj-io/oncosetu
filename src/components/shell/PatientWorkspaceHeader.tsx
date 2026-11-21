import type { ReactNode } from "react";
import { CircleHelp, EyeOff, FilePlus2, ListChecks, ShieldCheck, Stamp, UserRound } from "lucide-react";
import { Avatar, Badge, ButtonLink, type Tone } from "@/components/ui";
import { PATIENT_TAB_LIST, tabsFor, type PatientTabKey } from "@/lib/patient-tabs";
import { PatientTabsNav } from "./PatientTabsNav";
import type { StaffRole } from "@/lib/staff-nav";

/** Every tab as [key, label] pairs (kept for pages that list them, such as the overview's "Go to" row). */
export const PATIENT_TABS = PATIENT_TAB_LIST.map((t) => [t.key, t.label] as const);

export type TabKey = PatientTabKey;
export type Disclosure = "cleared" | "not_cleared" | "unknown";

const DISCLOSURE: Record<Disclosure, { label: string; tone: Tone; icon: ReactNode }> = {
  cleared: { label: "Diagnosis may be discussed", tone: "verified", icon: <ShieldCheck /> },
  not_cleared: { label: "Do not discuss the diagnosis with the patient", tone: "conflict", icon: <EyeOff /> },
  unknown: { label: "Not yet recorded: use neutral words", tone: "unverified", icon: <CircleHelp /> },
};

export type PatientWorkspaceHeaderProps = {
  patient: {
    id: string;
    initials: string;
    name: string;
    ageYears: number | null;
    sex: string;
    mrn: string | null;
    accession: string;
    disclosure: Disclosure;
    primaryContact: "patient" | "caregiver";
    minor: boolean;
  };
  counts?: Partial<Record<TabKey, number>>;
  /** Only the tabs this role can open are shown (a hidden tab would end on a refusal page). */
  role?: StaffRole;
  /** Example use (style guide): the tabs are shown as plain text with no links. */
  inertTabs?: boolean;
};

/** The one main action on every page of a patient's record, per role: the role's daily task. */
const ACTION: Partial<Record<StaffRole, { tab: string; label: string; icon: ReactNode }>> = {
  desk: { tab: "documents", label: "Add papers", icon: <FilePlus2 aria-hidden /> },
  records: { tab: "ledger", label: "Check what’s new", icon: <ListChecks aria-hidden /> },
  clinician: { tab: "ledger", label: "Review and seal", icon: <Stamp aria-hidden /> },
};

/** What each tab badge counts. The two differ on purpose: papers on file, and facts that arrived since the last sealed visit. */
const COUNT_WORDS: Partial<Record<TabKey, string>> = { records: "papers on file", ledger: "new facts since the last sealed visit", completeness: "papers not in the file yet" };

export function PatientWorkspaceHeader({ patient: p, counts, role, inertTabs }: PatientWorkspaceHeaderProps) {
  const d = DISCLOSURE[p.disclosure];
  const { main, more } = tabsFor(role);
  const facts = [p.ageYears != null ? `${p.ageYears} y` : null, p.sex || null, p.mrn ? `MRN ${p.mrn}` : null].filter(Boolean).join(" · ");
  const action = role ? ACTION[role] : undefined;
  return (
    <header className="rounded-lg border border-rule bg-surface shadow-card lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-transparent lg:shadow-none">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 pt-5 pb-4 sm:px-6 lg:px-0 lg:pt-1 lg:pb-5">
        <Avatar name={p.name} initials={p.initials} size="lg" />
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="text-[1.625rem] leading-tight tracking-[-0.02em] break-words sm:text-[1.875rem]">{p.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[15px] text-muted">
            {facts && <span>{facts}</span>}
            <span>Patient · record code <span className="rounded-xs bg-alcove px-1.5 py-0.5 font-mono text-[13px] text-ink">{p.accession}</span></span>
            {/* max-sm:whitespace-normal: a long badge wraps on a phone instead of pushing the page sideways (seen in WebKit) */}
            <Badge tone={d.tone} icon={d.icon} className="max-sm:whitespace-normal">{d.label}</Badge>
            <Badge tone="neutral" icon={<UserRound />} className="max-sm:whitespace-normal">Main contact: {p.primaryContact}</Badge>
            {p.minor && <Badge tone="unverified">Minor</Badge>}
          </div>
        </div>
        {action && !inertTabs && (
          <ButtonLink href={`/patients/${p.id}/${action.tab}`} icon={action.icon} className="max-sm:w-full">{action.label}</ButtonLink>
        )}
      </div>
      {/* Desktop: the record's sections are in the sidebar. Tablets and phones keep the tabs for quick switching. */}
      <div className="px-3 pb-3 sm:px-5 lg:hidden">
        <PatientTabsNav
          inert={inertTabs}
          main={main.map((t) => ({ href: `/patients/${p.id}/${t.key}`, label: t.label, count: counts?.[t.key] ?? (t.key === "records" ? counts?.documents : undefined), countLabel: COUNT_WORDS[t.key] }))}
          more={more.map((t) => ({ href: `/patients/${p.id}/${t.key}`, label: t.label }))}
        />
      </div>
    </header>
  );
}
