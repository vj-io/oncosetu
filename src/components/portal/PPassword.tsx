"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PInput } from "./ui";

/** Patient-size password field with an eye button (one name, state in aria-pressed), so a typo can be seen before sending. */
export function PPassword({ showLabel, className, ...rest }: Omit<ComponentProps<typeof PInput>, "type"> & { showLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <PInput {...rest} type={shown ? "text" : "password"} className={`pr-14 ${className ?? ""}`} />
      <button
        type="button"
        aria-label={showLabel}
        aria-pressed={shown}
        aria-controls={rest.id}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-setu-ink"
      >
        {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}
