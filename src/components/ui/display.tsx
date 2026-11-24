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
  { text: string; bg: string; border: string; bar: string; solid: string; edge: string }
> = {
  neutral: {
    text: "text-ink",
    bg: "bg-alcove",
    border: "border-control",
    bar: "border-l-control",
    solid: "bg-ink",
    edge: "border-control/35",
  },
  setu: {
    text: "text-setu-ink",
    bg: "bg-setu-tint",
    border: "border-setu",
    bar: "border-l-setu",
    solid: "bg-setu",
    edge: "border-setu/30",
  },
  verified: {
    text: "text-sage-ink",
    bg: "bg-sage-tint",
    border: "border-sage",
    bar: "border-l-sage",
    solid: "bg-sage",
    edge: "border-sage/35",
  },
  unverified: {
    text: "text-amber-ink",
    bg: "bg-amber-tint",
    border: "border-amber",
    bar: "border-l-amber",
    solid: "bg-amber",
    edge: "border-amber/35",
  },
  conflict: {
    text: "text-madder-ink",
    bg: "bg-madder-tint",
    border: "border-madder",
    bar: "border-l-madder",
    solid: "bg-madder",
    edge: "border-madder/30",
  },
  patient: {
    text: "text-violet-ink",
    bg: "bg-violet-tint",
    border: "border-violet",
    bar: "border-l-violet",
    solid: "bg-violet",
    edge: "border-violet/30",
  },
  shadow: {
    text: "text-slate-ink",
    bg: "bg-slate-tint",
    border: "border-slate",
    bar: "border-l-slate",
    solid: "bg-slate",
    edge: "border-slate/35",
  },
  brass: {
    text: "text-brass-ink",
    bg: "bg-brass-tint",
    border: "border-brass",
    bar: "border-l-brass",
    solid: "bg-brass",
    edge: "border-brass/40",
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
        "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] leading-tight font-semibold whitespace-nowrap",
        t.text,
        t.bg,
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
        "inline-flex max-w-full items-stretch overflow-hidden rounded-md border border-rule bg-matte text-[13px] leading-tight",
        className,
      )}
    >
      {kicker && (
        <span
          className={clsx(
            "flex shrink-0 items-center gap-1.5 px-2 py-1 font-medium [&_svg]:size-3.5",
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
  feature,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  /** A page title with a rule under it (no box, no tint): the title is not a card. */
  feature?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4",
        feature ? "border-b border-edge pb-5" : "pb-2",
        className,
      )}
    >
      <div className="grid min-w-0 gap-1.5">
        {kicker && kicker !== title && <p className="ds-kicker">{kicker}</p>}
        <H
          className={clsx(
            "leading-tight",
            H === "h1" ? "text-[1.75rem] tracking-[-0.02em] sm:text-[2rem]" : "text-xl sm:text-[1.375rem]",
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
      className="relative overflow-x-auto rounded-lg border border-edge bg-surface shadow-card"
    >
      <table className={clsx("ds-table", className)} {...rest}>
        {caption && <caption className="ds-kicker px-3.5 pt-3">{caption}</caption>}
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
        "flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-edge bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="mb-1 grid size-12 place-items-center rounded-full bg-surface text-faint shadow-card [&_svg]:size-6 [&_svg]:stroke-[1.5]"
        >
          {icon}
        </span>
      )}
      <p className="font-display text-lg font-semibold tracking-[-0.01em]">{title}</p>
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
      className={clsx("ds-skeleton h-4 rounded-sm", className)}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-6 rounded-xs border border-b-2 border-rule border-b-control bg-matte px-1.5 py-0.5 text-center text-xs text-ink">
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
        "grid shrink-0 place-items-center rounded-full bg-setu-tint font-display font-bold tracking-[0.01em] text-setu-ink",
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
        <span className="text-sm font-medium text-ink tabular-nums">
          {detail ?? `${value} / ${max}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-full bg-floor"
      >
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-500",
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
                      "text-xs font-medium",
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

/** Brand mark (a bridge arch, "setu", on a pine tile) + wordmark. `onDark` for the pine navigation. Brand text comes from props only. */
export function Wordmark({
  brand = "OncoSetu",
  onDark = false,
  className,
}: {
  brand?: string;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2.5 font-display text-[1.2rem] leading-none font-bold tracking-[-0.02em]",
        onDark ? "text-white" : "text-ink",
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 32 32"
        className="size-[1.6em] shrink-0"
      >
        <rect width="32" height="32" rx="9" fill={onDark ? "#ffffff" : "#0b6b78"} />
        <g fill="none" stroke={onDark ? "#0b6b78" : "#ffffff"} strokeWidth="2" strokeLinecap="round">
          <path d="M7 22.5h18" />
          <path d="M9 22.5v-5a7 7 0 0 1 14 0v5" />
          <path d="M13 22.5v-3.5a3 3 0 0 1 6 0v3.5" strokeOpacity="0.6" />
        </g>
      </svg>
      <span>{brand}</span>
    </span>
  );
}
