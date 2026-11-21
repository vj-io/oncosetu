import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, ChevronRight, Circle } from "lucide-react";
import { TONE, type Tone } from "./display";

/* Dashboard building blocks: a titled panel, a ring chart with its legend, a list of next actions, a status checklist,
   a milestone line and a stat tile. Server-safe; every colour is paired with a word or a number (never colour alone). */

const RING_STROKE: Record<Tone, string> = {
  neutral: "stroke-control", setu: "stroke-setu", verified: "stroke-sage", unverified: "stroke-amber", conflict: "stroke-madder",
  patient: "stroke-violet", shadow: "stroke-slate", brass: "stroke-brass",
};
const DOT: Record<Tone, string> = {
  neutral: "bg-control", setu: "bg-setu", verified: "bg-sage", unverified: "bg-amber", conflict: "bg-madder", patient: "bg-violet", shadow: "bg-slate", brass: "bg-brass",
};

/** A white panel with an icon, a title and an optional aside (a link or a pill). */
/** `feature` marks the one card a dashboard leads with: a soft teal wash and the logo-ring overlay. `tint` marks a side card
 *  (next actions, what changed, visit facts): a very light teal, so the white main cards read first. */
export function Panel({ title, icon, aside, children, className, id, feature, tint }: { title: ReactNode; icon?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string; feature?: boolean; tint?: boolean }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section aria-labelledby={hid} id={id} className={clsx("grid content-start gap-4 rounded-xl border p-5 shadow-card sm:p-6", feature ? "ds-feature border-rule" : tint ? "border-wash-rule bg-wash" : "border-rule bg-surface", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={hid} className="flex items-center gap-3 text-lg">
          {icon && <span aria-hidden className={clsx("grid size-9 shrink-0 place-items-center rounded-md text-setu-ink [&_svg]:size-[18px]", feature || tint ? "bg-surface shadow-card" : "bg-alcove")}>{icon}</span>}
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export type RingPart = { label: string; value: number; tone: Tone };

/** A ring chart: each part's share of the whole, drawn clockwise from the top; `center` sits in the middle. */
export function Ring({ parts, center, caption, label, size = 148 }: { parts: RingPart[]; center: ReactNode; caption?: ReactNode; label: string; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-floor" />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeLinecap="butt" className={RING_STROKE[p.tone]} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <span className="absolute grid place-items-center text-center leading-tight">
        <span className="font-display text-[1.75rem] tabular-nums">{center}</span>
        {caption && <span className="text-[13px] text-muted">{caption}</span>}
      </span>
    </div>
  );
}

/** The legend of a ring (or any list of counts): a dot, a word and a number per line. `dashed` marks a count outside the ring. */
export function Legend({ items }: { items: { label: ReactNode; value: ReactNode; tone: Tone; dashed?: boolean; href?: string }[] }) {
  return (
    <ul className="grid min-w-0 flex-1 gap-1">
      {items.map((it, k) => {
        const body = (
          <>
            <span aria-hidden className={clsx("size-2.5 shrink-0 rounded-full", it.dashed ? `border-2 border-dashed ${TONE[it.tone].border}` : DOT[it.tone])} />
            <span className="min-w-0 flex-1 text-[15px]">{it.label}</span>
            <span className="font-semibold tabular-nums">{it.value}</span>
          </>
        );
        return (
          <li key={k}>
            {it.href
              ? <Link href={it.href} className="flex min-h-9 items-center gap-3 rounded-sm px-2 hover:bg-spotlight">{body}</Link>
              : <span className="flex min-h-9 items-center gap-3 px-2">{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export type ActionItem = { href: string; label: ReactNode; icon: ReactNode; count?: number; tone?: Tone; urgent?: boolean };

/** Next actions: one row per thing to do, each a link with its count. An urgent row is tinted (and says so in words). */
export function ActionList({ items, empty }: { items: ActionItem[]; empty?: ReactNode }) {
  if (!items.length) return <p className="text-[15px] text-muted">{empty ?? "Nothing is waiting."}</p>;
  return (
    <ul className="grid gap-2">
      {items.map((a, k) => {
        const t = TONE[a.tone ?? "setu"];
        return (
          <li key={k}>
            <Link href={a.href} className={clsx("flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-[15px] font-medium transition-colors", a.urgent ? `${TONE.conflict.bg} ${TONE.conflict.text} hover:brightness-[0.98]` : "bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04)] hover:bg-alcove")}>
              <span aria-hidden className={clsx("grid size-8 shrink-0 place-items-center rounded-sm [&_svg]:size-4", a.urgent ? "bg-surface/70" : `${t.bg} ${t.text}`)}>{a.icon}</span>
              <span className="min-w-0 flex-1">{a.label}</span>
              {a.count != null && <span className="font-semibold tabular-nums">{a.count}</span>}
              <ChevronRight aria-hidden className="size-4 shrink-0 opacity-70" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type CheckState = "done" | "clear" | "attention";
/** A short status list: done (tick), clear (open circle, nothing to do) or needs attention (tinted ring). */
export function Checklist({ items }: { items: { state: CheckState; title: ReactNode; detail?: ReactNode; href?: string }[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((it, k) => {
        const icon = it.state === "done"
          ? <span className="grid size-6 place-items-center rounded-full bg-sage text-white"><Check className="size-3.5" strokeWidth={3} /></span>
          : it.state === "attention"
            ? <span className="grid size-6 place-items-center rounded-full border-2 border-madder" />
            : <Circle className="size-6 text-control" strokeWidth={1.5} />;
        const text = (
          <span className="grid gap-0.5">
            <span className={clsx("text-[15px] font-medium", it.href && "underline decoration-link underline-offset-4")}>{it.title}</span>
            {it.detail && <span className="text-[13px] text-muted">{it.detail}</span>}
          </span>
        );
        return (
          <li key={k} className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 shrink-0">{icon}</span>
            <span className="sr-only">{it.state === "done" ? "Done: " : it.state === "attention" ? "Needs attention: " : "Nothing to do: "}</span>
            {it.href ? <Link href={it.href} className="min-w-0">{text}</Link> : text}
          </li>
        );
      })}
    </ul>
  );
}

export type Milestone = { title: ReactNode; when: ReactNode; detail?: ReactNode; state: "done" | "next"; href?: string };
/** A line of dated milestones, oldest first; `next` is a dated item still to come. Vertical on phones, horizontal from `sm`. */
export function MilestoneLine({ items, label }: { items: Milestone[]; label: string }) {
  return (
    <ol aria-label={label} className="relative grid gap-5 sm:flex sm:gap-0">
      {items.map((m, k) => {
        const last = k === items.length - 1;
        const body = (
          <span className="grid gap-0.5 sm:justify-items-center sm:text-center">
            <span className="text-[15px] font-semibold">{m.title}</span>
            <span className={clsx("text-[13px]", m.state === "next" ? "font-semibold text-setu-ink" : "text-muted")}>{m.when}</span>
            {m.detail && <span className="line-clamp-2 text-[13px] text-muted">{m.detail}</span>}
          </span>
        );
        return (
          <li key={k} className="relative flex gap-3 sm:flex-1 sm:flex-col sm:items-center sm:gap-2.5 sm:px-2">
            {!last && <span aria-hidden className="absolute top-7 bottom-[-1.25rem] left-[13px] w-0.5 bg-rule sm:top-[13px] sm:right-[-50%] sm:bottom-auto sm:left-1/2 sm:h-0.5 sm:w-auto" />}
            <span aria-hidden className={clsx("relative z-10 grid size-7 shrink-0 place-items-center rounded-full", m.state === "done" ? "bg-sage text-white" : "border-2 border-setu bg-surface text-setu")}>
              {m.state === "done" ? <Check className="size-4" strokeWidth={3} /> : <span className="size-2 rounded-full bg-setu" />}
            </span>
            <span className="sr-only">{m.state === "done" ? "On file: " : "Coming up: "}</span>
            {m.href ? <Link href={m.href} className="min-w-0 rounded-sm hover:underline">{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}

/** A number tile: an icon, the number, a label and one line under it. A link when `href` is given. */
export function StatTile({ icon, value, label, sub, tone = "setu", href }: { icon: ReactNode; value: ReactNode; label: ReactNode; sub?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <span aria-hidden className={clsx("grid size-9 place-items-center rounded-sm [&_svg]:size-[18px]", TONE[tone].bg, TONE[tone].text)}>{icon}</span>
      <span className="font-display text-[2rem] leading-none tabular-nums">{value}</span>
      <span className="grid gap-0.5">
        <span className="text-[15px] font-semibold">{label}</span>
        {sub && <span className="text-[13px] leading-snug text-muted">{sub}</span>}
      </span>
    </>
  );
  const cls = "grid h-full content-start gap-2.5 rounded-xl border border-rule bg-surface p-4 shadow-card sm:p-5";
  return href ? <Link href={href} className={clsx(cls, "transition-colors hover:border-control/40")}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Horizontal bars: one row per category, its count and a bar to scale with the largest. Zero rows stay (a bar of nothing). */
export function BarList({ items, label }: { items: { label: ReactNode; value: number; tone?: Tone; href?: string }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul aria-label={label} className="grid gap-2.5">
      {items.map((it, k) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">{it.label}</span>
              <span className="font-semibold tabular-nums">{it.value}</span>
            </span>
            <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-floor">
              <span className={clsx("block h-full rounded-full", DOT[it.tone ?? "setu"])} style={{ width: `${(it.value / max) * 100}%` }} />
            </span>
          </>
        );
        return <li key={k}>{it.href ? <Link href={it.href} className="grid gap-1.5 rounded-sm hover:opacity-80">{body}</Link> : <span className="grid gap-1.5">{body}</span>}</li>;
      })}
    </ul>
  );
}

/** Stages a thing moves through, left to right, each with its count (for example noticed, asked for, arrived, closed). */
export function Pipeline({ stages, label }: { stages: { label: ReactNode; value: ReactNode; detail?: ReactNode; tone?: Tone }[]; label: string }) {
  return (
    <ol aria-label={label} className="grid gap-2 sm:grid-flow-col sm:auto-cols-fr">
      {stages.map((s, k) => (
        <li key={k} className="relative grid content-start gap-1 rounded-lg bg-alcove px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <span aria-hidden className={clsx("size-2.5 rounded-full", DOT[s.tone ?? "setu"])} />
            {s.label}
          </span>
          <span className="font-display text-[1.75rem] leading-none tabular-nums">{s.value}</span>
          {s.detail && <span className="text-[13px] leading-snug text-muted">{s.detail}</span>}
          {k < stages.length - 1 && <ChevronRight aria-hidden className="absolute top-1/2 -right-3.5 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-surface text-faint shadow-card sm:block" />}
        </li>
      ))}
    </ol>
  );
}

/** One bar split into coloured parts, with the legend under it (words and numbers, never colour alone). */
export function SegmentBar({ parts, label }: { parts: { label: string; value: number; tone: Tone }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="grid gap-3">
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label}`).join(", ")}`} className="flex h-3 overflow-hidden rounded-full bg-floor">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => <span key={p.label} className={clsx("h-full", DOT[p.tone])} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className={clsx("size-2.5 rounded-full", DOT[p.tone])} />
            {p.label}
            <span className="font-semibold tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
