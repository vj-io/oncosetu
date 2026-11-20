import type { Metadata } from "next";
import { ButtonLink, Frame, Wordmark } from "@/components/ui";
import { getSession } from "@/server/session";

// Shown for every unknown URL, including mistyped patient (/p/**) and share (/s/**) links, so it stays neutral:
// the "Setu Records" brand and no "Onco" in the tab title (FR-CON-07). The way home is the sign-in page, which every visitor can open.
export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default async function NotFound() {
  // A signed-in clinician is taken back to the patients list under the staff name; anyone else sees the neutral page (DOC-16).
  const staff = (await getSession().catch(() => null))?.kind === "staff";
  return (
    <main className="mx-auto grid min-h-dvh max-w-reading content-center gap-8 px-4 py-16 sm:px-8">
      <Wordmark brand={staff ? "OncoSetu" : "Setu Records"} />
      <Frame matte>
        <div className="grid gap-4 px-5 py-7 sm:px-8 sm:py-9">
          <p className="ds-kicker">Error 404</p>
          <h1 className="text-3xl tracking-[-0.025em]">We could not find that page.</h1>
          <p className="text-muted">The link may be old or mistyped, or the page may have been moved. Nothing on any record has changed.</p>
          <div className="flex flex-wrap gap-3 pt-1">
            {staff ? <ButtonLink href="/patients">Back to patients</ButtonLink> : <>
              <ButtonLink href="/login">Go to sign-in</ButtonLink>
              <ButtonLink href="/p/login" variant="secondary">Patient sign-in</ButtonLink>
            </>}
          </div>
        </div>
      </Frame>
    </main>
  );
}
