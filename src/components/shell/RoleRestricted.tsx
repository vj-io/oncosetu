import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { rolesSentence } from "@/lib/patient-tabs";
import { roleHome, type StaffRole } from "@/lib/staff-nav";

/** Friendly page for a signed-in role that is not allowed on a page (instead of the bare 403). */
export function RoleRestricted({ roles, role, backHref, backLabel }: { roles: readonly StaffRole[]; role: StaffRole; backHref?: string; backLabel?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <EmptyState
        title={`This page is for ${rolesSentence(roles)}`}
        description="Your role does not include this page. Nothing on the record has changed."
        action={
          <span className="flex flex-wrap justify-center gap-4">
            {backHref && <Link className="underline" href={backHref}>{backLabel ?? "Back to the patient overview"}</Link>}
            <Link className="underline" href={roleHome(role)}>Go to your home page</Link>
          </span>
        }
      />
    </div>
  );
}
