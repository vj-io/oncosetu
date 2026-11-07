import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { roleHome } from "@/lib/staff-nav";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Not available for your role", robots: { index: false, follow: false } };

/** Any forbidden() call (requireStaff with a role list, a denied document page) lands here: a plain notice, not the bare 403. */
export default async function Forbidden() {
  const s = await getSession().catch(() => null);
  const home = s?.kind === "staff" ? roleHome(s.role) : s ? "/p" : "/login";
  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl content-center px-4 py-16">
      <EmptyState
        title="This page is not available for your role"
        description="Your account does not include this page, or the record needs consent or verification first. Nothing has changed."
        action={<Link className="underline" href={home}>{s ? "Go to your home page" : "Sign in"}</Link>}
      />
    </main>
  );
}
