import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { ButtonLink, Frame } from "@/components/ui";
import { PublicShell } from "@/components/shell/PublicShell";
import { roleHome } from "@/lib/staff-nav";
import { getSession } from "@/server/session";

// Shown for every unknown URL, including mistyped patient (/p/**) and share (/s/**) links, so it stays neutral:
// the "Setu Records" brand and no "Onco" in the tab title (FR-CON-07). The way home is the sign-in page, which every visitor can open.
export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default async function NotFound() {
  // A signed-in clinician is taken back to the patients list under the staff name; anyone else sees the neutral page (DOC-16).
  const session = await getSession().catch(() => null);
  const staff = session?.kind === "staff";
  const home = session?.kind === "staff" ? roleHome(session.role) : "/";
  const admin = home.startsWith("/admin");
  return (
    <PublicShell brand={staff ? "OncoSetu" : "Setu Records"} actions={false}>
      <div className="mx-auto grid max-w-reading px-4 py-12 sm:px-8 sm:py-20">
        <Frame tone="feature">
          <div className="grid gap-4 px-6 py-8 sm:px-8 sm:py-10">
            <span aria-hidden className="grid size-12 place-items-center rounded-md bg-alcove text-faint"><SearchX className="size-6" /></span>
            <p className="ds-kicker">Error 404</p>
            <h1 className="text-[1.875rem] leading-tight tracking-[-0.02em]">We could not find that page.</h1>
            <p className="text-muted">The link may be old or mistyped, or the page may have been moved. Nothing on any record has changed.</p>
            <div className="flex flex-wrap gap-3 pt-1">
              {staff ? <ButtonLink href={home}>{admin ? "Go to the admin console" : "Go to your home page"}</ButtonLink> : <>
                <ButtonLink href="/">Home</ButtonLink>
                <ButtonLink href="/login" variant="secondary">Go to sign-in</ButtonLink>
                <ButtonLink href="/p/login" variant="secondary">Patient sign-in</ButtonLink>
              </>}
            </div>
          </div>
        </Frame>
      </div>
    </PublicShell>
  );
}
