"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, Wifi, WifiOff } from "lucide-react";
import { Badge, TONE, type Tone } from "@/components/ui";

/** navigator.onLine plus the online/offline events. Starts true so server and first client render agree. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function NetworkPill({ online, waiting }: { online: boolean; waiting: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <Badge tone={online ? "verified" : "unverified"} icon={online ? <Wifi /> : <WifiOff />}>
        {online ? "Online" : "Offline · saving on this device"}
      </Badge>
      {waiting > 0 && <Badge tone="shadow">{waiting} waiting to sync</Badge>}
    </span>
  );
}

/** A callout in the placard style: a tone bar, an icon and words (never colour alone). */
export function Notice({ tone = "unverified", title, children, action }: { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className={clsx("flex flex-wrap items-start gap-x-3 gap-y-3 border border-l-[3px] border-rule bg-surface py-3 pr-3 pl-4", TONE[tone].bar)}>
      <CircleAlert aria-hidden className={clsx("mt-0.5 size-5 shrink-0", TONE[tone].text)} />
      <div className="min-w-48 flex-1 basis-56">
        <p className="text-[15px] leading-snug font-medium">{title}</p>
        {children && <p className="mt-0.5 text-sm text-muted">{children}</p>}
      </div>
      {action && <div className="shrink-0 max-sm:pl-8">{action}</div>}
    </div>
  );
}
