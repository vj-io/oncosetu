import { useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { FileX } from "lucide-react";
import { KeyValue, StatusBadge, TONE, type Status, type Tone } from "./display";

/* The gallery pieces: frames, placards, empty frames, stamps, the brass seal, quote highlights. Server-safe. */

const delayStyle = (ms?: number) => (ms == null ? undefined : ({ "--delay": `${ms}ms` } as CSSProperties));

/** White matte artwork frame with a soft frame shadow. `matte` adds the inner mount; `caption` hangs a mono label below. */
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
    <div className={clsx("relative bg-matte shadow-frame", matte && "p-3 sm:p-5", animate && "ds-frame-in", className)} style={{ ...delayStyle(delay), ...style }} {...rest}>
      {matte ? <div className="h-full border border-rule">{children}</div> : children}
    </div>
  );
  if (!caption) return body;
  return (
    <figure className="grid gap-2">
      {body}
      <figcaption className="ds-kicker text-right text-[11px]">{caption}</figcaption>
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
    <article className={clsx("border border-rule bg-surface px-5 py-5 shadow-placard sm:px-6", animate && "ds-placard-in", className)} style={delayStyle(delay)}>
      {(kicker || status) && (
        <header className="flex flex-wrap items-start justify-between gap-2">
          {kicker && <p className="ds-kicker">{kicker}</p>}
          {status}
        </header>
      )}
      <H className="mt-2 text-xl leading-snug tracking-[-0.02em] first:mt-0">{title}</H>
      {rows.length > 0 && <KeyValue className="mt-4" items={rows} />}
      {children && <div className="mt-4 text-[15px] text-muted">{children}</div>}
      {(accession || footer) && (
        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
          {accession && <span className="font-mono text-xs tracking-[0.1em] text-faint">ACC. {accession}</span>}
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
      <div aria-hidden className="relative mt-2 w-16 shrink-0 sm:w-20">
        <span className="absolute -top-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-control" />
        <div className="grid aspect-[3/4] place-items-center border-2 border-dashed border-control bg-gallery/70">
          <FileX className="size-5 text-control" strokeWidth={1.5} />
        </div>
      </div>
      <div className="grid min-w-0 flex-1 content-start gap-1.5">
        <p className="ds-kicker">{kicker ?? (status === "received" ? "Match proposed · not yet confirmed" : "Not in file")}</p>
        <h3 className="text-lg leading-snug tracking-[-0.015em]">{title}</h3>
        {detail && <p className="text-sm text-muted">{detail}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge status={status} label={statusLabel} />
          {accession && <span className="font-mono text-xs tracking-[0.1em] text-faint">ACC. {accession}</span>}
          {action}
        </div>
      </div>
    </article>
  );
}

/** Small ink stamp left by a human action (e.g. a verification press). */
export function Stamp({
  children,
  tone = "verified",
  rotate = -3,
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
        "inline-flex items-center gap-1.5 border-2 border-current px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.16em] uppercase opacity-95 outline outline-offset-2 outline-current mix-blend-multiply [&_svg]:size-3.5",
        TONE[tone].text,
        animate && "ds-stamp",
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)`, "--rot": `${rotate}deg`, ...delayStyle(delay) } as CSSProperties}
    >
      {children}
    </span>
  );
}

// Scalloped seal edge, computed once (viewBox 0 0 120 120).
const SEAL_EDGE = Array.from({ length: 240 }, (_, i) => {
  const a = (i / 240) * Math.PI * 2;
  const r = 58 - 1.8 * (0.5 - 0.5 * Math.cos(40 * a));
  return `${(60 + r * Math.cos(a)).toFixed(2)},${(60 + r * Math.sin(a)).toFixed(2)}`;
}).join(" ");

/** Brass seal pressed when a snapshot is sealed. The only place the brass gradient is used. */
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
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${label}. Hash ${code}`} className={clsx("drop-shadow-[0_6px_10px_rgb(58_44_6_/_0.28)]", animate && "ds-seal")}>
        <defs>
          <radialGradient id={`${id}-b`} cx="42%" cy="36%" r="70%">
            <stop offset="0%" stopColor="#f6e9bb" />
            <stop offset="45%" stopColor="#e2c672" />
            <stop offset="78%" stopColor="#c9a84c" />
            <stop offset="100%" stopColor="#9c7a2a" />
          </radialGradient>
          <radialGradient id={`${id}-c`} cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#f8ecc4" />
            <stop offset="100%" stopColor="#e3c878" />
          </radialGradient>
          <path id={`${id}-p`} d="M60,60 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
        </defs>
        <polygon points={SEAL_EDGE} fill={`url(#${id}-b)`} stroke="#9c7a2a" strokeWidth="0.6" />
        <circle cx="60" cy="60" r="45" fill="none" stroke="#9c7a2a" strokeWidth="0.8" opacity="0.7" />
        <text fill="#3a2c06" fontFamily="var(--font-jetbrains-mono), monospace" fontSize="6.4" letterSpacing="1.4" fontWeight="600">
          <textPath href={`#${id}-p`}>{ringText.toUpperCase()}</textPath>
        </text>
        <circle cx="60" cy="60" r="29" fill={`url(#${id}-c)`} stroke="#9c7a2a" strokeWidth="0.8" />
        <text x="60" y="55" textAnchor="middle" fill="#3a2c06" fontFamily="var(--font-jetbrains-mono), monospace" fontSize="6" letterSpacing="1.6">
          {label.toUpperCase()}
        </text>
        <text x="60" y="68" textAnchor="middle" fill="#3a2c06" fontFamily="var(--font-jetbrains-mono), monospace" fontSize="10" fontWeight="700" letterSpacing="0.6">
          {code.slice(0, 8).toUpperCase()}
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
        <span className="ml-1.5 inline-block border border-amber bg-amber-tint px-1 align-[1px] font-mono text-[11px] leading-4 tracking-[0.1em] whitespace-nowrap text-amber-ink uppercase">
          Low OCR confidence
        </span>
      )}
      {text.slice(e)}
    </span>
  );
}

/** The warm cone of light at the top of a page. Place inside a `relative` parent. */
export function Spotlight({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("ds-spotlight", className)} />;
}
