import { useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { FileX } from "lucide-react";
import { KeyValue, StatusBadge, TONE, type Status, type Tone } from "./display";

/* Record sheets, placards, empty frames, stamps, the seal, quote highlights. Server-safe. */

const delayStyle = (ms?: number) => (ms == null ? undefined : ({ "--delay": `${ms}ms` } as CSSProperties));

/** A white tile: hairline edge, rounded corners, a soft shadow. `matte` is kept for callers and draws the same tile; `caption` adds a small label below. */
export function Frame({
  matte = false,
  caption,
  animate = false,
  delay,
  className,
  children,
  style,
  ...rest
}: ComponentProps<"div"> & {
  matte?: boolean;
  caption?: ReactNode;
  animate?: boolean;
  delay?: number;
}) {
  const body = (
    <div className={clsx("relative rounded-lg border border-rule bg-surface shadow-card", matte && "p-1 sm:p-2", animate && "ds-frame-in", className)} style={{ ...delayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
  if (!caption) return body;
  return (
    <figure className="grid gap-2">
      {body}
      <figcaption className="ds-kicker text-right">{caption}</figcaption>
    </figure>
  );
}

/** Alias: a Card is a Frame. */
export const Card = Frame;

export type PlacardProps = {
  kicker?: ReactNode;
  title: ReactNode;
  titleAs?: "h2" | "h3" | "h4";
  what?: ReactNode;
  where?: ReactNode;
  who?: ReactNode;
  when?: ReactNode;
  accession?: string;
  status?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Fade in just after its item (default delay 250ms). */
  animate?: boolean;
  delay?: number;
  className?: string;
};

/** The wall label for an exhibit: WHAT / WHERE (document · page · quote) / WHO verified / WHEN, plus an accession code. */
export function Placard({ kicker, title, titleAs: H = "h3", what, where, who, when, accession, status, footer, children, animate, delay, className }: PlacardProps) {
  const rows = (
    [
      ["What", what],
      ["Where", where],
      ["Who", who],
      ["When", when],
    ] as const
  )
    .filter(([, value]) => value != null)
    .map(([label, value]) => ({ label, value }));
  return (
    <article className={clsx("rounded-lg border border-rule bg-surface px-5 py-5 shadow-placard sm:px-6", animate && "ds-placard-in", className)} style={delayStyle(delay)}>
      {(kicker || status) && (
        <header className="flex flex-wrap items-start justify-between gap-2">
          {kicker && <p className="ds-kicker">{kicker}</p>}
          {status}
        </header>
      )}
      <H className="mt-1.5 text-lg leading-snug first:mt-0">{title}</H>
      {rows.length > 0 && <KeyValue className="mt-4" items={rows} />}
      {children && <div className="mt-4 text-[15px] text-muted">{children}</div>}
      {(accession || footer) && (
        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
          {accession && <span className="text-xs text-faint">ACC. {accession}</span>}
          {footer}
        </footer>
      )}
    </article>
  );
}

/** A referenced-but-absent document: a dashed, empty frame on the wall with its placard. Administrative wording only. */
export function EmptyFrame({
  title,
  detail,
  status = "expected",
  kicker,
  statusLabel,
  action,
  accession,
  animate,
  delay,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  status?: Status;
  /** Overrides the English kicker (e.g. a localised string). */
  kicker?: ReactNode;
  /** Overrides the English status badge text. */
  statusLabel?: ReactNode;
  action?: ReactNode;
  accession?: string;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  return (
    <article className={clsx("flex gap-4 sm:gap-5", animate && "ds-frame-in", className)} style={delayStyle(delay)}>
      <div aria-hidden className="relative mt-1 w-14 shrink-0 sm:w-16">
        <div className="grid aspect-[3/4] place-items-center rounded-md border-2 border-dashed border-control bg-gallery">
          <FileX className="size-5 text-control" strokeWidth={1.5} />
        </div>
      </div>
      <div className="grid min-w-0 flex-1 content-start gap-1.5">
        <p className="ds-kicker">{kicker ?? (status === "received" ? "Match proposed · not yet confirmed" : "Not in file")}</p>
        <h3 className="text-[1.0625rem] leading-snug">{title}</h3>
        {detail && <p className="text-sm text-muted">{detail}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge status={status} label={statusLabel} />
          {accession && <span className="text-xs text-faint">ACC. {accession}</span>}
          {action}
        </div>
      </div>
    </article>
  );
}

/** Small mark left by a human action (e.g. a verification press). `rotate` is kept for callers; the mark sits straight. */
export function Stamp({
  children,
  tone = "verified",
  animate = false,
  delay,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  rotate?: number;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-current px-2 py-0.5 text-[13px] font-semibold [&_svg]:size-3.5",
        TONE[tone].text,
        TONE[tone].bg,
        animate && "ds-stamp",
        className,
      )}
      style={delayStyle(delay)}
    >
      {children}
    </span>
  );
}

/** The seal pressed when a snapshot is sealed: a flat brass disc with its hash. The only place brass is used. */
export function BrassSeal({
  code,
  label = "Sealed",
  ringText = "Visit sealed · record locked · Visit sealed · record locked ·",
  size = 112,
  animate = false,
  delay,
  className,
}: {
  code: string;
  label?: string;
  ringText?: string;
  size?: number;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <span className={clsx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size, ...delayStyle(delay) }}>
      {animate && <span aria-hidden className="ds-seal-ring absolute inset-0 rounded-full border-2 border-brass opacity-0" />}
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${label}. Hash ${code}`} className={clsx(animate && "ds-seal")}>
        <defs>
          <path id={`${id}-p`} d="M60,60 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0" />
        </defs>
        <circle cx="60" cy="60" r="58" fill="#f6eed6" stroke="#8f6c12" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="51" fill="none" stroke="#8f6c12" strokeWidth="0.75" strokeDasharray="1.5 2.5" />
        <text fill="#7a5a12" fontFamily="var(--font-figtree), sans-serif" fontSize="7" letterSpacing="1.2" fontWeight="600">
          <textPath href={`#${id}-p`}>{ringText.toUpperCase()}</textPath>
        </text>
        <circle cx="60" cy="60" r="31" fill="#ffffff" stroke="#8f6c12" strokeWidth="1" />
        <text x="60" y="55" textAnchor="middle" fill="#7a5a12" fontFamily="var(--font-figtree), sans-serif" fontSize="7.5" fontWeight="600" letterSpacing="0.6">
          {label}
        </text>
        <text x="60" y="69" textAnchor="middle" fill="#3a2c06" fontFamily="var(--font-plex-mono), monospace" fontSize="9.5" fontWeight="500">
          {code.slice(0, 8)}
        </text>
      </svg>
    </span>
  );
}

/** Renders text with one highlighted span [start, end). Low confidence adds an amber dotted underline and a visible tag. */
export function QuoteHighlight({
  text,
  start,
  end,
  lowConfidence = false,
  animate = true,
  delay,
  className,
}: {
  text: string;
  start: number;
  end: number;
  lowConfidence?: boolean;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return (
    <span className={clsx("whitespace-pre-wrap", className)}>
      {text.slice(0, s)}
      <mark className={clsx("ds-quote", lowConfidence && "ds-quote-low", animate && "ds-sweep")} style={delayStyle(delay)}>
        {text.slice(s, e)}
      </mark>
      {lowConfidence && (
        <span className="ml-1.5 inline-block rounded-xs border border-amber bg-amber-tint px-1.5 align-[1px] text-xs leading-5 font-medium whitespace-nowrap text-amber-ink">
          Low OCR confidence
        </span>
      )}
      {text.slice(e)}
    </span>
  );
}
