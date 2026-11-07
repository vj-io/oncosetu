import { FileX } from "lucide-react";

/** A paper the clinic is still looking for: a dashed empty frame with one plain sentence (language-neutral, no status chips). */
export function LookingItem({ text, note }: { text: string; note?: string | null }) {
  return (
    <article className="flex items-start gap-4">
      <div aria-hidden className="relative mt-1 w-14 shrink-0">
        <div className="grid aspect-[3/4] place-items-center border-2 border-dashed border-control bg-gallery/70">
          <FileX className="size-5 text-control" strokeWidth={1.5} />
        </div>
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[17px] leading-snug">{text}</p>
        {note && <p className="mt-1 text-[16px] text-muted">{note}</p>}
      </div>
    </article>
  );
}
