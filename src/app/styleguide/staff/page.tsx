import { StaffShell } from "@/components/shell";
import { ButtonLink, EmptyFrame, Placard, SectionHeader, StageTracker, StatusBadge } from "@/components/ui";

// Style-guide preview of the staff shell with placeholder content (no data, no auth).
export default function StaffShellPreview() {
  return (
    <StaffShell user={{ name: "Asha Rao", role: "clinician", orgName: "Demo General Hospital" }} demo>
      <SectionHeader as="h1" kicker="Desk · today" title="Staff shell preview" description="Top gallery bar, role-filtered navigation, demo banner with the simulated phone, and the provenance footer." actions={<ButtonLink href="/styleguide" variant="secondary">Back to style guide</ButtonLink>} />
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <Placard animate kicker="Pipeline · 7F3A·21C9" title="Discharge summary, 3 pages" status={<StatusBadge status="processing" />}>
          <StageTracker current={5} className="mt-2" />
        </Placard>
        <EmptyFrame animate delay={300} title="Histopathology report" detail="for procedure documented on 12 Mar 2026 (Discharge summary, p.2)" />
      </div>
    </StaffShell>
  );
}
