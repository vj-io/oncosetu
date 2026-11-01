import type { ReactNode } from "react";
import { PatientShell } from "@/components/shell";
import { tp } from "@/i18n/patient";
import type { PortalCtx } from "@/server/portal/context";
import { PortalNav, type NavItem } from "./PortalNav";

const PAGES = [
  ["/p", "navHome"],
  ["/p/upload", "navUpload"],
  ["/p/visit", "navVisit"],
  ["/p/requests", "navRequests"],
  ["/p/share", "navShare"],
  ["/p/consent", "navConsent"],
  ["/p/access", "navAccess"],
] as const;

/**
 * Every signed-in /p page: the patient shell (brand from disclosure, language from ?lang= or the patient's preference),
 * the page links with sign-out, and, for a caregiver, the "acting for" notice (FR-CON-02).
 * A layout cannot read ?lang=, so the frame lives here and each page renders it.
 */
export function PortalFrame({ ctx, children }: { ctx: PortalCtx; children: ReactNode }) {
  const { lang } = ctx;
  const items: NavItem[] = PAGES.map(([href, key]) => ({ href, label: tp(lang, key), query: `?lang=${lang}` }));
  return (
    <PatientShell brand={ctx.brand} lang={lang} displayName={ctx.session.displayName}>
      <PortalNav items={items} label={tp(lang, "navLabel")} signOut={tp(lang, "signOut")} signingOut={tp(lang, "signingOut")} lang={lang} />
      {ctx.session.kind === "caregiver" && (
        <p role="note" className="mb-8 border border-l-[3px] border-violet border-l-violet bg-violet-tint px-4 py-3 text-[15px] text-violet-ink">
          {tp(lang, "actingFor", { name: ctx.session.displayName, initials: ctx.initials })}
        </p>
      )}
      {children}
    </PatientShell>
  );
}
