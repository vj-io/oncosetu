"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Info } from "lucide-react";

/**
 * A small "i" button that opens a plain-language explanation. Works on touch (tap), keyboard (Enter, Escape) and mouse (hover).
 * `children` is the whole sentence the doctor reads, e.g. "What arrived after the last sealed visit."
 */
export function InfoTip({ children, label = "What this shows", className }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  // Shift left so the open tip stays inside the viewport (on a phone a tip near the right edge was cut off by the page edge).
  const [shift, setShift] = useState(0);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const show = () => {
    const r = root.current?.getBoundingClientRect();
    if (r) setShift(Math.min(0, window.innerWidth - 16 - Math.min(320, window.innerWidth - 32) - r.left));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <span ref={root} className={clsx("relative inline-flex align-middle", className)} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? setOpen(false) : show())}
        className="inline-grid size-6 place-items-center rounded-full text-setu-ink hover:bg-setu-tint focus-visible:outline-2"
      >
        <Info aria-hidden className="size-4" />
      </button>
      <span
        role="tooltip"
        id={id}
        className={clsx(
          "absolute top-full left-0 z-40 mt-1.5 w-[min(20rem,calc(100vw-2rem))] border border-rule bg-matte px-3 py-2 text-left text-[14px] leading-snug font-normal tracking-normal text-ink normal-case shadow-frame",
          !open && "hidden", // not just invisible: a closed tip near the right edge still widened a phone page
        )}
        style={{ left: shift }}
      >
        <span className="ds-kicker mb-1 block">{label}</span>
        {children}
      </span>
    </span>
  );
}

/** The same explanation as one visible line under a heading: for the features a first-time doctor must not miss. */
export function Explainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx("flex max-w-3xl items-start gap-2 text-[14px] leading-snug text-muted", className)}>
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-setu-ink" />
      <span>
        <span className="font-medium text-setu-ink">What this shows. </span>
        {children}
      </span>
    </p>
  );
}
