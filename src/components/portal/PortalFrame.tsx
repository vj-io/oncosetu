import type { ReactNode } from "react";
import { PatientShell } from "@/components/shell";
import { tp, type PatientKey } from "@/i18n/patient";
import type { PortalCtx } from "@/server/portal/context";
import { Camera, House, Mail, Share2 } from "lucide-react";
import { PortalNav, type BarItem, type NavGroup, type NavItem } from "./PortalNav";

const MAIN = [
  ["/p", "navHome"],
  ["/p/upload", "navUpload"],
  ["/p/visit", "navVisit"],
  ["/p/requests", "navRequests"],
  ["/p/share", "navShare"],
  ["/p/abdm", "navAbdmShort"],
] as const;
const PRIVACY = [
  ["/p/consent", "navConsent"],
  ["/p/permissions", "navWho"],
  ["/p/access", "navAccess"],
] as const;

/**
 * Every signed-in /p page: the patient shell (brand from disclosure, language from ?lang= or the patient's preference),
 * the page links with sign-out, and, for a caregiver, the "acting for" notice (FR-CON-02).
 * A layout cannot read ?lang=, so the frame lives here and each page renders it.
 */
export function PortalFrame({ ctx, children }: { ctx: PortalCtx; children: ReactNode }) {
  const { lang } = ctx;
  const link = ([href, key]: readonly [string, PatientKey]) => ({ href, label: tp(lang, key), query: `?lang=${lang}` });
  const items: NavItem[] = MAIN.map(link);
  const group: NavGroup = { label: tp(lang, "navPrivacy"), items: PRIVACY.map(link) };
  // Phone bottom bar: the four daily pages with short labels; the rest sit under "More".
  const bar: BarItem[] = [
    { href: "/p", label: tp(lang, "tabHome"), query: `?lang=${lang}`, icon: <House /> },
    { href: "/p/upload", label: tp(lang, "tabSend"), query: `?lang=${lang}`, icon: <Camera /> },
    { href: "/p/requests", label: tp(lang, "tabRequests"), query: `?lang=${lang}`, icon: <Mail /> },
    { href: "/p/share", label: tp(lang, "tabShare"), query: `?lang=${lang}`, icon: <Share2 /> },
  ];
  return (
    <PatientShell brand={ctx.brand} lang={lang} displayName={ctx.session.displayName} homeHref={`/p?lang=${lang}`}
      nav={<PortalNav items={items} group={group} bar={bar} label={tp(lang, "navLabel")} signOut={tp(lang, "signOut")} signingOut={tp(lang, "signingOut")} moreLabel={tp(lang, "tabMore")} moreTitle={tp(lang, "tabMoreTitle")} closeLabel={tp(lang, "tabClose")} lang={lang} />}>
      
      {ctx.session.kind === "caregiver" && (
        <p role="note" className="mb-8 rounded-lg border border-violet/30 bg-violet-tint px-4 py-3 text-[16px] text-violet-ink">
          {tp(lang, "actingFor", { name: ctx.session.displayName, initials: ctx.initials })}
        </p>
      )}
      {children}
    </PatientShell>
  );
}
