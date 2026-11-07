"use client";

import { useEffect, useRef, useState } from "react";

/** A signature box that works with a mouse, a finger or a pen. Reports a PNG data URL (or null when empty). */
export function SignaturePad({ onChange, clearLabel, hint }: { onChange: (png: string | null) => void; clearLabel: string; hint: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a1a40";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(e.currentTarget.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="grid gap-2">
      <canvas
        ref={ref} width={600} height={200} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        aria-label={hint} data-testid="signature-pad" style={{ touchAction: "none" }}
        className="h-40 w-full cursor-crosshair border border-control bg-white"
      />
      <div className="flex items-center justify-between gap-3 text-[15px] text-muted">
        <span>{hint}</span>
        <button type="button" onClick={clear} disabled={empty} className="inline-flex h-11 items-center px-2 underline underline-offset-4 disabled:opacity-50">{clearLabel}</button>
      </div>
    </div>
  );
}
