"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { Button } from "@/components/ui";
import { parseTourState, TOUR_EVENT, TOUR_KEY, usableSteps, type TourPatients, type TourState } from "@/core/doctor/tour";

const RING = ["outline", "outline-4", "outline-offset-4", "outline-brass", "transition-[outline]"];

async function findPatient(name: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/patients?q=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { patients?: { id: string }[] };
    return json.patients?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Dispatches the event the tour listens for. Used by buttons in the menu and on the patients page. */
export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

export function TourButton({ className }: { className?: string }) {
  return (
    <Button variant="secondary" icon={<Compass aria-hidden />} onClick={startTour} className={className}>
      Take the 2-minute tour
    </Button>
  );
}

/**
 * Lightweight guided tour, no library: a card pinned to the corner with Back / Next / Skip, plus a ring around the
 * feature on the page when it exists. Progress is kept in this browser so a page change does not end it.
 */
export function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<TourState | null>(null);
  const [starting, setStarting] = useState(false);

  const save = useCallback((s: TourState | null) => {
    setState(s);
    if (s) localStorage.setItem(TOUR_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOUR_KEY);
  }, []);

  useEffect(() => {
    // Read the saved tour after hydration (localStorage does not exist on the server).
    const t = setTimeout(() => {
      const saved = parseTourState(localStorage.getItem(TOUR_KEY));
      if (saved?.active) setState(saved);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const start = async () => {
      setStarting(true);
      const patients: TourPatients = { sunita: await findPatient("Sunita"), khan: await findPatient("Khan") };
      setStarting(false);
      const steps = usableSteps(patients);
      if (!steps.length) return save(null);
      save({ active: true, step: 0, patients });
      router.push(steps[0].path!);
    };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [router, save]);

  const steps = state ? usableSteps(state.patients) : [];
  const step = state?.active ? steps[Math.min(state.step, steps.length - 1)] : undefined;

  // Ring the feature for this step, if it is on the page.
  useEffect(() => {
    if (!step?.target) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) ?? (step.fallback ? document.querySelector<HTMLElement>(`[data-tour="${step.fallback}"]`) : null);
      if (el) {
        el.classList.add(...RING);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 400);
    return () => {
      clearTimeout(t);
      document.querySelectorAll<HTMLElement>(`[data-tour]`).forEach((el) => el.classList.remove(...RING));
    };
  }, [step, pathname]);

  if (starting) return <p role="status" className="fixed right-4 bottom-4 z-50 border border-rule bg-matte px-4 py-3 text-sm shadow-frame">Starting the tour…</p>;
  if (!state || !step) return null;

  const go = (to: number) => {
    if (to < 0) return;
    if (to >= steps.length) return save(null);
    save({ ...state, step: to });
    router.push(steps[to].path!);
  };
  const last = state.step >= steps.length - 1;

  return (
    <aside role="dialog" aria-label="Guided tour" aria-live="polite" className="fixed right-3 bottom-3 left-3 z-50 grid gap-3 border border-ink bg-matte p-4 shadow-frame sm:left-auto sm:w-[24rem]">
      <div className="flex items-start justify-between gap-3">
        <p className="ds-kicker">Tour · step {state.step + 1} of {steps.length}</p>
        <button type="button" onClick={() => save(null)} aria-label="Close the tour" className="-m-2 grid size-10 place-items-center hover:bg-spotlight">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="grid gap-1.5">
        <h2 className="text-lg leading-snug tracking-[-0.015em]">{step.title}</h2>
        <p className="text-[15px] leading-snug text-muted">{step.text}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => save(null)} className="min-h-11 px-2 text-sm text-muted underline underline-offset-4">Skip the tour</button>
        <div className="flex gap-2">
          <Button variant="ghost" size="md" icon={<ArrowLeft aria-hidden />} disabled={state.step === 0} onClick={() => go(state.step - 1)}>Back</Button>
          <Button size="md" icon={last ? undefined : <ArrowRight aria-hidden />} onClick={() => go(state.step + 1)}>{last ? "Finish" : "Next"}</Button>
        </div>
      </div>
    </aside>
  );
}
