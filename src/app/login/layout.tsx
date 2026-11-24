import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthBrand } from "@/components/shell/AuthShell";
import { isPatientHost } from "@/lib/patient-origin";

// Patient sign-in links to staff sign-in, so on the neutral patient address a patient can land here. There the tab title,
// description and wordmark say "Setu Records", never the product name (FR-CON-07). The staff address keeps "OncoSetu".
async function onNeutralAddress() {
  const h = await headers();
  return isPatientHost(h.get("x-forwarded-host") ?? h.get("host"));
}

export async function generateMetadata(): Promise<Metadata> {
  return (await onNeutralAddress()) ? { title: "Setu Records", description: "Hospital staff sign-in.", robots: { index: false, follow: false } } : {};
}

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthBrand brand={(await onNeutralAddress()) ? "Setu Records" : "OncoSetu"}>{children}</AuthBrand>;
}
