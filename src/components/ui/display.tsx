import { Fragment, type ComponentProps, type ReactNode } from "react";
import clsx from "clsx";
import {
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  FileX,
  GitCompare,
  Hourglass,
  LoaderCircle,
  MessageCircle,
  Minus,
  Pencil,
  ScanText,
  Send,
  Stamp as StampIcon,
  TriangleAlert,
  Undo2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";

/* Server-safe display primitives. */

/** One hue per meaning. Always pair a tone with a word or icon, never colour alone. */
export type Tone =
  | "neutral"
  | "setu"
  | "verified"
  | "unverified"
  | "conflict"
  | "patient"
  | "shadow"
  | "brass";

export const TONE: Record<
  Tone,
  { text: string; bg: string; border: string; bar: string; solid: string }
> = {
  neutral: {
    text: "text-ink",
    bg: "bg-alcove",
    border: "border-control",
    bar: "border-l-control",
    solid: "bg-ink",
  },
  setu: {
    text: "text-setu-ink",
    bg: "bg-setu-tint",
    border: "border-setu",
    bar: "border-l-setu",
    solid: "bg-setu",
  },
  verified: {
    text: "text-sage-ink",
    bg: "bg-sage-tint",
    border: "border-sage",
    bar: "border-l-sage",
    solid: "bg-sage",
  },
  unverified: {
    text: "text-amber-ink",
    bg: "bg-amber-tint",
    border: "border-amber",
    bar: "border-l-amber",
    solid: "bg-amber",
  },
  conflict: {
    text: "text-madder-ink",
    bg: "bg-madder-tint",
    border: "border-madder",
    bar: "border-l-madder",
    solid: "bg-madder",
  },
  patient: {
    text: "text-violet-ink",
    bg: "bg-violet-tint",
    border: "border-violet",
    bar: "border-l-violet",
    solid: "bg-violet",
  },
  shadow: {
    text: "text-slate-ink",
    bg: "bg-slate-tint",
    border: "border-slate",
    bar: "border-l-slate",
    solid: "bg-slate",
  },
  brass: {
    text: "text-brass-ink",
    bg: "bg-brass-tint",
    border: "border-brass",
    bar: "border-l-brass",
    solid: "bg-brass",
  },
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={clsx(
        "inline-flex min-h-6 items-center gap-1.5 border px-2 py-1 font-mono text-[11px] leading-none tracking-[0.12em] whitespace-nowrap uppercase",
        t.text,
        t.bg,
        t.border,
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="-ml-0.5 [&_svg]:size-3.5">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * Every status the product shows, by enum value (PRD): verification (FR-VER-01), identity (FR-ID-04),
 * missing items (FR-RAD-03), requests (FR-REQ-03), document processing (ADR-001a), plus item flags.
 */
export const STATUS_META = {
  // verification
  unverified: {
    label: "Unverified",
    tone: "unverified",
    icon: <CircleDashed />,
  },
  verified_matches_source: {
    label: "Verified · matches source",
    tone: "verified",
    icon: <CircleCheck />,
  },
  edited: { label: "Edited · original kept", tone: "setu", icon: <Pencil /> },
  rejected: { label: "Rejected", tone: "conflict", icon: <CircleX /> },
  disputed: { label: "Disputed", tone: "conflict", icon: <CircleAlert /> },
  // identity
  match: { label: "Identity match", tone: "verified", icon: <UserCheck /> },
  mismatch: { label: "Identity mismatch", tone: "conflict", icon: <UserX /> },
  insufficient: {
    label: "Identity insufficient",
    tone: "unverified",
    icon: <CircleHelp />,
  },
  // missing items
  expected: { label: "Not in file", tone: "neutral", icon: <FileX /> },
  requested: { label: "Requested", tone: "setu", icon: <Send /> },
  received: {
    label: "Received · to confirm",
    tone: "unverified",
    icon: <FileSearch />,
  },
  closed: { label: "Closed · confirmed", tone: "verified", icon: <Check /> },
  unobtainable: { label: "Unobtainable", tone: "shadow", icon: <Ban /> },
  dismissed: { label: "Dismissed", tone: "shadow", icon: <Minus /> },
  // requests
  drafted: { label: "Draft", tone: "neutral", icon: <FileText /> },
  sent: { label: "Sent", tone: "setu", icon: <Send /> },
  reminder_due: {
    label: "Reminder due · day 7",
    tone: "unverified",
    icon: <Clock />,
  },
  open_21d: {
    label: "Open · day 21",
    tone: "unverified",
    icon: <CircleAlert />,
  },
  fulfilled: { label: "Fulfilled", tone: "verified", icon: <CircleCheck /> },
  withdrawn: { label: "Withdrawn", tone: "shadow", icon: <Undo2 /> },
  // document processing
  queued: { label: "Queued", tone: "shadow", icon: <Hourglass /> },
  processing: {
    label: "Processing",
    tone: "setu",
    icon: <LoaderCircle className="ds-spin" />,
  },
  done: { label: "Processed", tone: "verified", icon: <Check /> },
  needs_review: { label: "Needs review", tone: "unverified", icon: <Eye /> },
  failed: { label: "Failed", tone: "conflict", icon: <TriangleAlert /> },
  // item flags
  conflict: { label: "Conflict", tone: "conflict", icon: <GitCompare /> },
  patient_said: {
    label: "Patient said",
    tone: "patient",
    icon: <MessageCircle />,
  },
  low_confidence: {
    label: "Low OCR confidence",
    tone: "unverified",
    icon: <ScanText />,
  },
  binding_uncertain: {
    label: "Binding uncertain",
    tone: "unverified",
    icon: <CircleHelp />,
  },
  shadow_mode: { label: "Shadow mode", tone: "shadow", icon: <EyeOff /> },
  sealed: { label: "Sealed", tone: "brass", icon: <StampIcon /> },
  rejected_unsupported: {
    label: "Rejected · quote not found",
    tone: "conflict",
    icon: <X />,
  },
} satisfies Record<string, { label: string; tone: Tone; icon: ReactNode }>;

export type Status = keyof typeof STATUS_META;

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label?: ReactNode;
  className?: string;
}) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} icon={m.icon} className={className}>
      {label ?? m.label}
    </Badge>
  );
}

/** Provenance chip: tone bar + kicker word + text, e.g. "Document · Verified by Dr X". */
export function Chip({
  kicker,
  tone = "neutral",
  icon,
  children,
  className,
}: {
  kicker?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-stretch border border-l-[3px] border-rule bg-matte text-[13px] leading-tight",
        t.bar,
        className,
      )}
    >
      {kicker && (
        <span
          className={clsx(
            "flex shrink-0 items-center gap-1.5 px-2 py-1 font-mono text-[11px] tracking-[0.12em] uppercase [&_svg]:size-3.5",
            t.text,
            t.bg,
          )}
        >
          {icon && <span aria-hidden>{icon}</span>}
          {kicker}
        </span>
      )}
      <span className="flex min-w-0 items-center px-2 py-1 text-ink">
        {children}
      </span>
    </span>
  );
}

export function SectionHeader({
  kicker,
  title,
  description,
  actions,
  as: H = "h2",
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-rule pb-4",
        className,
      )}
    >
      <div className="grid min-w-0 gap-2">
        {kicker && <p className="ds-kicker">{kicker}</p>}
        <H
          className={clsx(
            "leading-tight tracking-[-0.025em]",
            H === "h1" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-[1.75rem]",
          )}
        >
          {title}
        </H>
        {description && <p className="max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function KeyValue({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={clsx(
        "grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-5 gap-y-2.5 text-[15px] leading-snug",
        className,
      )}
    >
      {items.map((it, i) => (
        <Fragment key={i}>
          <dt className="ds-kicker pt-[3px]">{it.label}</dt>
          <dd className="min-w-0 break-words">{it.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Inventory register. Use plain <thead>/<tbody>/<tr>/<th>/<td> inside; it scrolls on its own at narrow widths. */
export function Table({
  caption,
  children,
  className,
  ...rest
}: ComponentProps<"table"> & { caption?: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={typeof caption === "string" ? caption : "Table"}
      tabIndex={0}
      className="relative overflow-x-auto"
    >
      <table className={clsx("ds-table", className)} {...rest}>
        {caption && <caption className="ds-kicker">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

/** Nothing here yet (not the same as a missing record: that is an EmptyFrame). */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center gap-3 border border-rule bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="mb-1 text-faint [&_svg]:size-7 [&_svg]:stroke-[1.25]"
        >
          {icon}
        </span>
      )}
      <p className="font-display text-xl tracking-[-0.02em]">{title}</p>
      {description && (
        <p className="max-w-md text-[15px] text-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx("ds-skeleton h-4 rounded-xs", className)}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-6 border border-b-2 border-rule border-b-control bg-matte px-1.5 py-0.5 text-center font-mono text-xs text-ink">
      {children}
    </kbd>
  );
}

const AVATAR = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
};

export function Avatar({
  name,
  initials,
  size = "md",
  className,
}: {
  name: string;
  initials?: string;
  size?: keyof typeof AVATAR;
  className?: string;
}) {
  const text =
    initials ??
    name
      .split(/\s+/)
      .filter((w) => w && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  return (
    <span
      aria-hidden
      className={clsx(
        "grid shrink-0 place-items-center border border-rule bg-matte font-display tracking-[0.02em] text-ink shadow-placard",
        AVATAR[size],
        className,
      )}
    >
      {text}
    </span>
  );
}

export function ProgressMeter({
  label,
  value,
  max = 100,
  detail,
  tone = "setu",
  className,
}: {
  label: string;
  value: number;
  max?: number;
  detail?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={clsx("grid gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="ds-kicker">{label}</span>
        <span className="font-mono text-sm text-ink tabular-nums">
          {detail ?? `${value} / ${max}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2 border border-rule bg-alcove"
      >
        <div
          className={clsx(
            "h-full transition-[width] duration-500",
            TONE[tone].solid,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export const PIPELINE_STAGES = [
  "Received",
  "Text",
  "Classified",
  "Identity",
  "Extracted",
  "Evidence gate",
  "Completeness",
] as const;
export type StageState = "done" | "active" | "pending" | "failed";
const STAGE_WORD: Record<StageState, string> = {
  done: "done",
  active: "in progress",
  pending: "pending",
  failed: "failed",
};

/**
 * Linear pipeline. Stages before `current` are done, `current` is active (or failed), the rest pending.
 * `current = stages.length` means all done. Vertical until its container is 42rem wide, then horizontal.
 */
export function StageTracker({
  stages = PIPELINE_STAGES,
  current,
  failed = false,
  label = "Processing stages",
  className,
}: {
  stages?: readonly string[];
  current: number;
  failed?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div className={clsx("@container", className)}>
      <ol aria-label={label} className="flex flex-col @2xl:flex-row">
        {stages.map((stage, i) => {
          const state: StageState =
            i < current
              ? "done"
              : i === current
                ? failed
                  ? "failed"
                  : "active"
                : "pending";
          const last = i === stages.length - 1;
          return (
            <li
              key={stage}
              aria-current={state === "active" ? "step" : undefined}
              className="relative flex items-center gap-3 py-1.5 @2xl:flex-1 @2xl:flex-col @2xl:items-start @2xl:gap-2 @2xl:py-0"
            >
              {!last && (
                <span
                  aria-hidden
                  className={clsx(
                    "absolute top-[30px] bottom-[-6px] left-[11px] w-px @2xl:top-[11px] @2xl:right-0 @2xl:bottom-auto @2xl:left-7 @2xl:h-px @2xl:w-auto",
                    state === "done" ? "bg-sage" : "bg-rule",
                  )}
                />
              )}
              <span
                aria-hidden
                className={clsx(
                  "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border [&_svg]:size-3.5",
                  state === "done" && "border-sage bg-sage text-white",
                  state === "active" &&
                    "ds-pulse border-setu bg-matte text-setu",
                  state === "pending" &&
                    "border-dashed border-control bg-gallery",
                  state === "failed" &&
                    "border-madder-ink bg-madder-ink text-white",
                )}
              >
                {state === "done" && <Check strokeWidth={3} />}
                {state === "active" && (
                  <span className="size-2 rounded-full bg-setu" />
                )}
                {state === "failed" && <X strokeWidth={3} />}
              </span>
              <span className="grid gap-0.5 @2xl:pr-2">
                <span
                  className={clsx(
                    "text-[13px] leading-tight",
                    state === "done" && "text-ink",
                    state === "active" && "font-medium text-setu-ink",
                    state === "pending" && "text-faint",
                    state === "failed" && "font-medium text-madder-ink",
                  )}
                >
                  {stage}
                  <span className="sr-only"> ({STAGE_WORD[state]})</span>
                </span>
                {(state === "active" || state === "failed") && (
                  <span
                    aria-hidden
                    className={clsx(
                      "font-mono text-[11px] tracking-[0.12em] uppercase",
                      state === "failed" ? "text-madder-ink" : "text-setu-ink",
                    )}
                  >
                    {STAGE_WORD[state]}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Brand mark (a bridge arch: "setu") + wordmark. The word "Setu" is set in the brand teal. Brand text comes from props only. */
export function Wordmark({
  brand = "OncoSetu",
  className,
}: {
  brand?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 font-display text-[1.3rem] leading-none tracking-[-0.03em] text-ink",
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-[1.15em] shrink-0 text-setu"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      >
        <path d="M2.5 20.5h19" />
        <path d="M4 20.5V12a8 8 0 0 1 16 0v8.5" />
        <path d="M8.5 20.5V14a3.5 3.5 0 0 1 7 0v6.5" />
      </svg>
      <span>
        {brand.split(/(Setu)/).map((part, i) =>
          part === "Setu" ? (
            <span key={i} className="text-setu-ink">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
    </span>
  );
}
