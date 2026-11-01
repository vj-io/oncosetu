import type { Metadata } from "next";
import { PatientShell } from "@/components/shell";
import { ButtonLink, Frame, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Setu Records" };

// Style-guide preview of the patient shell (neutral brand, ?lang=hi switches language).
export default async function PatientShellPreview({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = (await searchParams).lang === "hi" ? "hi" : "en";
  return (
    <PatientShell brand="Setu Records" lang={lang} displayName="Meena (caregiver)">
      <p className="ds-kicker">{lang === "hi" ? "आपके दस्तावेज़" : "Your documents"}</p>
      <h1 className="mt-3 text-[2rem] leading-tight tracking-[-0.025em]">{lang === "hi" ? "नमस्ते, मीना" : "Hello, Meena"}</h1>
      <p className="mt-3 text-muted">{lang === "hi" ? "यह पूर्वावलोकन है। असली पेज अपने शब्द src/i18n से लेते हैं।" : "This is a preview. Real pages take their words from src/i18n."}</p>
      <Frame className="mt-8 grid gap-3 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{lang === "hi" ? "डिस्चार्ज सारांश" : "Discharge summary"}</span>
          <StatusBadge status="received" label={lang === "hi" ? "मिल गया" : "Received"} />
        </div>
      </Frame>
      <ButtonLink href="/styleguide" variant="secondary" className="mt-8">
        {lang === "hi" ? "स्टाइल गाइड" : "Back to style guide"}
      </ButtonLink>
    </PatientShell>
  );
}
