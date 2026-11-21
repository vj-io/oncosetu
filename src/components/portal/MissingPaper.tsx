import type { Lang } from "@/core/types";
import { CheckCircle2, FileX, Send } from "lucide-react";
import { Frame } from "@/components/ui";
import { tp } from "@/i18n/patient";
import type { LookingRow } from "@/server/portal/summary";
import { LetterButton } from "./LetterButton";
import { PLink } from "./ui";

/**
 * One paper the clinic is still looking for: its name, roughly when, where to ask, and what the family can do about it
 * (send a photo, or make the letter to give to that hospital). `showSend` is false on the Requests page.
 */
export function MissingPaper({ row, lang, showSend = true }: { row: LookingRow; lang: Lang; showSend?: boolean }) {
  const q = `?lang=${lang}`;
  if (row.state === "received") {
    // already with the clinic: a tick, no "where to ask", nothing more to do
    return (
      <Frame className="flex items-start gap-3 px-4 py-4">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sage-tint text-sage-ink"><CheckCircle2 className="size-5" strokeWidth={1.75} /></span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-lg leading-snug">{row.label}</h3>
          {row.when && <p className="text-[16px] text-muted">{row.when}</p>}
          {row.mentionedIn && <p className="text-[16px] text-muted">{row.mentionedIn}</p>}
          {row.place && <p className="text-[16px] text-muted">{row.place}</p>}
          <p className="text-[16px]">{row.status}</p>
        </div>
      </Frame>
    );
  }
  return (
    <Frame className="grid gap-3 px-4 py-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-alcove text-faint"><FileX className="size-5" strokeWidth={1.75} /></span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-lg leading-snug">{row.label}</h3>
          {row.when && <p className="text-[16px] text-muted">{row.when}</p>}
          {row.mentionedIn && <p className="text-[16px] text-muted">{row.mentionedIn}</p>}
          {row.state !== "expected" && <p className="text-[16px]">{row.status}</p>}
          <p className="text-[17px]">{row.ask ?? tp(lang, "lookingAskDesk")}</p>
        </div>
      </div>
      {row.canLetter && (
        <div className="grid gap-2 sm:grid-cols-2">
          {showSend && (
            <PLink href={`/p/upload${q}`} icon={<Send />} className="w-full">
              {tp(lang, "lookingSend")}
            </PLink>
          )}
          <LetterButton lang={lang} missingId={row.id} hospital={!!row.ask} className="w-full" />
        </div>
      )}
      {row.state === "requested" && (
        <PLink href={`/p/requests${q}`} variant="secondary" className="w-full sm:w-auto">
          {tp(lang, "lookingSeeLetter")}
        </PLink>
      )}
    </Frame>
  );
}
