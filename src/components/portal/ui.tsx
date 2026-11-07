import type { Lang } from "@/core/types";
import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";

/*
 * Patient-surface primitives. The design-system Button and Field set labels in letter-spaced mono capitals, which
 * reads badly in Devanagari and is small for a patient on a phone. These keep the same colours with large plain type
 * and 48px+ targets. Server-safe (no client hooks beyond useId).
 */

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-obsidian text-gallery hover:bg-label active:bg-ink",
  secondary: "border border-obsidian bg-transparent text-ink hover:bg-spotlight",
  danger: "bg-madder-ink text-white hover:bg-madder",
  ghost: "text-ink underline underline-offset-4 hover:bg-spotlight",
};

export function pBtn({ variant = "primary", big = false, className }: { variant?: Variant; big?: boolean; className?: string } = {}) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-xs px-5 py-3 text-center text-[17px] leading-snug font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 [&_svg]:size-5 [&_svg]:shrink-0",
    big ? "min-h-14" : "min-h-12",
    VARIANT[variant],
    className,
  );
}

export function PButton({
  variant,
  big,
  loading,
  icon,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; big?: boolean; loading?: boolean; icon?: ReactNode }) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={pBtn({ variant, big, className })} {...rest}>
      {loading ? <LoaderCircle aria-hidden className="ds-spin" /> : icon}
      {children}
    </button>
  );
}

export function PLink({ variant, big, icon, children, className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; big?: boolean; icon?: ReactNode }) {
  return (
    <Link className={pBtn({ variant, big, className })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

type FieldChild = ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" }>;

/** Label, one control, hint and error, wired with ids. */
export function PField({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: FieldChild; className?: string }) {
  const auto = useId();
  const id = children.props.id ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const described = [children.props["aria-describedby"], hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-[17px] leading-snug font-medium">
        {label}
      </label>
      {cloneElement(children, { id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-[16px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-start gap-1.5 text-[16px] text-madder-ink">
          <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 border border-madder bg-madder-tint px-4 py-3 text-[16px] text-madder-ink">
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      {children}
    </p>
  );
}

const CONTROL =
  "w-full rounded-xs border border-rule border-b-control bg-matte text-ink placeholder:text-placeholder transition-colors " +
  "hover:border-b-ink focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 " +
  "aria-invalid:border-madder aria-invalid:border-b-madder disabled:cursor-not-allowed disabled:bg-alcove disabled:text-muted";

export function PInput({ big, className, ...rest }: ComponentProps<"input"> & { big?: boolean }) {
  return <input className={clsx(CONTROL, big ? "h-14 px-3 text-2xl" : "h-12 px-3 text-[17px]", className)} {...rest} />;
}

export function PTextarea({ className, rows = 5, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={clsx(CONTROL, "min-h-32 px-3 py-3 text-[17px] leading-relaxed", className)} {...rest} />;
}

export function PSelect({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <span className={clsx("relative block", className)}>
      <select className={clsx(CONTROL, "h-12 appearance-none pr-10 pl-3 text-[17px]")} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </span>
  );
}

/** Small label above a page title. The design system's kicker is letter-spaced mono caps, which breaks Devanagari: plain type in Hindi. */
export function Kicker({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <p className="ds-kicker" style={lang === "hi" ? { letterSpacing: "normal", fontFamily: "var(--font-deva)", fontSize: "0.9375rem", textTransform: "none" } : undefined}>
      {children}
    </p>
  );
}
