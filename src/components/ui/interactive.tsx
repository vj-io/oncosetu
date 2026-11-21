"use client";

import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { X } from "lucide-react";
import { TONE, type Tone } from "./display";

/* Client components: anything that needs state, effects or the router. */

export type TabItem = { href: string; label: ReactNode; count?: number };

/** Link-based tabs; the active tab is the one whose href matches (or prefixes) the current pathname. */
export function Tabs({ items, label, className }: { items: TabItem[]; label: string; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={clsx("w-fit max-w-full overflow-x-auto rounded-md bg-alcove p-1", className)}>
      <ul className="flex min-w-max gap-1">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[15px] whitespace-nowrap transition-colors",
                  active ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:bg-surface/60 hover:text-ink",
                )}
              >
                {it.label}
                {it.count != null && (
                  <span className={clsx("min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums", active ? "bg-setu-tint text-setu-ink" : "bg-floor text-muted")}>{it.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Accessible modal on the native <dialog> (focus trap, Escape, inert background). `placement` turns it into a drawer. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = "center",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  placement?: "center" | "left" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={clsx("ds-dialog", placement === "left" && "ds-drawer-left", placement === "right" && "ds-drawer-right", className)}
    >
      {open && (
        <div className={clsx("flex flex-col", placement === "center" ? "max-h-[calc(100dvh-2rem)]" : "h-full")}>
          <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg leading-snug">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mt-1.5 -mr-2.5 grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-spotlight hover:text-ink">
              <X aria-hidden className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

type ToastInput = { title: ReactNode; description?: ReactNode; tone?: Tone };
const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Mounted once in the root layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<(ToastInput & { id: number })[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++nextId.current;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:right-6 sm:bottom-6 sm:left-auto sm:w-96">
        {items.map((t) => (
          <div key={t.id} className={clsx("ds-toast pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 border-rule bg-surface py-3 pr-2 pl-4 shadow-pop", TONE[t.tone ?? "neutral"].bar)}>
            <div className="min-w-0 flex-1 py-1">
              <p className="text-[15px] leading-snug font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-spotlight">
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast() must be used inside <ToastProvider>");
  return { toast };
}

/** Hover/focus tooltip; Escape dismisses (WCAG 1.4.13). The child must be focusable. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement<{ "aria-describedby"?: string }>; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={clsx(
          "pointer-events-none absolute left-0 z-40 w-max max-w-[min(16rem,80vw)] rounded-md bg-pine-deep px-2.5 py-1.5 text-[13px] leading-snug text-white shadow-pop transition-opacity sm:left-1/2 sm:-translate-x-1/2",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}

export type Lang = "en" | "hi" | "hinglish";
/** Marathi is offered by the consent notice only (src/i18n/consent.ts). */
type ToggleLang = Lang | "mr";
const LANG_LABEL: Record<ToggleLang, [short: string, name: string]> = { en: ["EN", "English"], hi: ["हिं", "हिन्दी"], hinglish: ["Hinglish", "Hinglish"], mr: ["मराठी", "मराठी"] };

/** EN / हिं / Hinglish switch (staff screens pass `langs` for EN / हिं only). Without `onChange` it sets `?lang=` on the current URL (server pages read searchParams). */
export function LanguageToggle<L extends ToggleLang = Lang>({ value, onChange, className, langs = ["en", "hi", "hinglish"] as L[] }: { value: L; onChange?: (lang: L) => void; className?: string; langs?: readonly L[] }) {
  const router = useRouter();
  const choose = (lang: L) => {
    if (lang === value) return;
    if (onChange) return onChange(lang);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  };
  return (
    <div role="group" aria-label="Language · भाषा" className={clsx("inline-flex overflow-hidden rounded-md border border-control/60 bg-matte", className)}>
      {langs.map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang === "hinglish" ? "hi-Latn" : lang}
          aria-pressed={value === lang}
          onClick={() => choose(lang)}
          className={clsx(
            "h-11 min-w-12 px-3 font-medium transition-colors",
            value === lang ? "bg-pine text-white" : "text-ink hover:bg-spotlight",
            lang === "hi" || lang === "mr" ? "font-deva text-[15px]" : "text-sm",
          )}
        >
          <span aria-hidden>{LANG_LABEL[lang][0]}</span>
          <span className="sr-only">{LANG_LABEL[lang][1]}</span>
        </button>
      ))}
    </div>
  );
}
