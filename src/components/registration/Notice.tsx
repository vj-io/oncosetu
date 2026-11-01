import type { ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, Info } from "lucide-react";
import { TONE, type Tone } from "@/components/ui";

/** A bordered call-out with a tone bar; always carries an icon and words, never colour alone. */
export function Notice({ tone = "unverified", title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = TONE[tone];
  const Icon = tone === "conflict" ? CircleAlert : Info;
  return (
    <div role="note" className={clsx("flex gap-3 border border-l-[3px] border-rule bg-surface px-4 py-3", t.bar, className)}>
      <Icon aria-hidden className={clsx("mt-0.5 size-4 shrink-0", t.text)} />
      <div className="grid gap-0.5 text-[15px]">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Print only the element with `.print-area` (the staff shell, header and tabs are hidden). */
export const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; display: block !important; background: #fff; color: #000; }
  @page { margin: 12mm; }
}`;
