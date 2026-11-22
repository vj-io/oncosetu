"use client";

import { useState, type ComponentProps } from "react";
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./form";

/**
 * A password field with an eye button that shows or hides what was typed. The button keeps one name ("Show password")
 * and says its state with aria-pressed. Field passes its id and descriptions through to the input.
 */
export function PasswordInput({ className, ...rest }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...rest} type={shown ? "text" : "password"} className={clsx("pr-12", className)} />
      <button
        type="button"
        aria-label="Show password"
        aria-pressed={shown}
        aria-controls={rest.id}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-setu-ink"
      >
        {shown ? <EyeOff aria-hidden className="size-[18px]" /> : <Eye aria-hidden className="size-[18px]" />}
      </button>
    </div>
  );
}
