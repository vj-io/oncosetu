import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";

/* Server-safe form primitives: no client hooks, so they render in server and client components. */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-obsidian text-gallery hover:bg-label active:bg-ink",
  secondary: "border border-obsidian text-ink bg-transparent hover:bg-spotlight",
  ghost: "text-ink hover:bg-spotlight",
  danger: "bg-madder-ink text-white hover:bg-madder",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 gap-1.5 text-[11px]", // dense staff tables only; 44px elsewhere
  md: "h-11 px-5 gap-2 text-xs",
  lg: "h-12 px-7 gap-2.5 text-[13px]",
};

/** Classes for anything that should look like a button (e.g. a <Link>). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center rounded-xs font-mono font-medium uppercase tracking-[0.14em] whitespace-nowrap transition-colors duration-150",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant, size, loading, icon, children, className, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden className="ds-spin" /> : icon}
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function ButtonLink({ variant, size, icon, children, className, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

const CONTROL =
  "w-full rounded-xs border border-rule border-b-control bg-matte text-[15px] text-ink placeholder:text-placeholder transition-colors " +
  "hover:border-b-ink focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 " +
  "aria-invalid:border-madder aria-invalid:border-b-madder disabled:cursor-not-allowed disabled:bg-alcove disabled:text-muted";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(CONTROL, "h-11 px-3", className)} {...rest} />;
}

export function Textarea({ className, rows = 4, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={clsx(CONTROL, "min-h-24 px-3 py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <span className={clsx("relative block", className)}>
      <select className={clsx(CONTROL, "h-11 appearance-none pr-10 pl-3")} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </span>
  );
}

type ControlProps = Omit<ComponentProps<"input">, "type"> & { label: ReactNode; description?: ReactNode };

/** Square archival checkbox; the whole row is the 44px target. */
export function Checkbox({ label, description, className, ...rest }: ControlProps) {
  return (
    <label className={clsx("group flex min-h-11 cursor-pointer items-start gap-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-50", className)}>
      <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          className="peer size-5 cursor-pointer appearance-none rounded-xs border border-ink bg-matte transition-colors checked:bg-ink disabled:cursor-not-allowed disabled:opacity-45"
          {...rest}
        />
        <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute size-3.5 text-matte opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="grid gap-0.5">
        <span className="text-[15px] leading-snug">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** On/off control. Native checkbox with role="switch"; state is also spelled out (never colour alone). */
export function Switch({ label, description, className, ...rest }: ControlProps) {
  return (
    <label className={clsx("group flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 has-disabled:cursor-not-allowed has-disabled:opacity-50", className)}>
      <span className="grid gap-0.5">
        <span className="text-[15px] leading-snug">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </span>
      <span className="flex items-center gap-2.5">
        <span aria-hidden className="w-7 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">
          <span className="group-has-checked:hidden">Off</span>
          <span className="hidden text-setu-ink group-has-checked:inline">On</span>
        </span>
        <input type="checkbox" role="switch" className="peer sr-only" {...rest} />
        <span
          aria-hidden
          className="relative h-6 w-11 rounded-sm border border-ink bg-matte transition-colors group-has-checked:border-setu group-has-checked:bg-setu peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:opacity-45"
        >
          <span className="absolute top-0.5 left-0.5 size-[18px] rounded-xs bg-ink transition-transform duration-200 group-has-checked:translate-x-5 group-has-checked:bg-matte" />
        </span>
      </span>
    </label>
  );
}

type FieldChild = ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" }>;

/** Label + control + hint + error. Wires id, aria-describedby and aria-invalid onto its single child. */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: FieldChild;
}) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("grid gap-1.5", className)}>
      <label htmlFor={id} className="ds-kicker text-muted">
        {label}
        {optional && <span className="normal-case tracking-normal"> (optional)</span>}
      </label>
      {cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : children.props["aria-invalid"] })}
      {hint && (
        <p id={hintId} className="text-sm text-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-madder-ink">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
