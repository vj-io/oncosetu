import type { ReactNode } from "react";
import { CircleHelp, EyeOff, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, Badge, Tabs, type Tone } from "@/components/ui";
import { tabAllowed } from "@/lib/patient-tabs";
import type { StaffRole } from "@/lib/staff-nav";

export const PATIENT_TABS = [
  ["overview", "Overview"],
  ["documents", "Documents"],
  ["timeline", "Timeline"],
  ["ledger", "What’s new"],
  ["completeness", "Missing papers"],
  ["preauth", "Pre-auth file"],
  ["requests", "Requests"],
  ["shares", "Share links"],
  ["statements", "Patient’s own answers"],
  ["consent", "Consent & access"],
  ["audit", "Activity log"],
] as const;

export type TabKey = (typeof PATIENT_TABS)[number][0];
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
};

export function PatientWorkspaceHeader({ patient: p, counts, role }: PatientWorkspaceHeaderProps) {
  const d = DISCLOSURE[p.disclosure];
  const facts = [p.ageYears != null ? `${p.ageYears} y` : null, p.sex || null, p.mrn ? `MRN ${p.mrn}` : null].filter(Boolean).join(" · ");
  return (
    <header className="border-b border-rule">
      <div className="flex items-start gap-4 pb-5 sm:gap-5">
        <Avatar name={p.name} initials={p.initials} size="lg" />
        <div className="grid min-w-0 gap-1.5">
          <p className="ds-kicker">Patient · record code {p.accession}</p>
          <h1 className="text-[1.75rem] leading-tight tracking-[-0.025em] break-words sm:text-[2.25rem]">{p.name}</h1>
          {facts && <p className="font-mono text-[13px] text-muted">{facts}</p>}
          <div className="mt-1 flex flex-wrap gap-2">
            {/* max-sm:whitespace-normal: a long badge wraps on a phone instead of pushing the page sideways (seen in WebKit) */}
            <Badge tone={d.tone} icon={d.icon} className="max-sm:whitespace-normal">
              {d.label}
            </Badge>
            <Badge tone="neutral" icon={<UserRound />} className="max-sm:whitespace-normal">
              Main contact: {p.primaryContact}
            </Badge>
            {p.minor && <Badge tone="unverified">Minor</Badge>}
          </div>
        </div>
      </div>
      <Tabs
        label="Patient workspace"
        items={PATIENT_TABS.filter(([key]) => !role || tabAllowed(key, role)).map(([key, label]) => ({ href: `/patients/${p.id}/${key}`, label, count: counts?.[key] }))}
      />
    </header>
  );
}
