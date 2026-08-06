"use client";

// The colour picker both creators use. A wheel (hue round, saturation out from
// the centre) plus a lightness rail, because a kit designer thinks "a darker
// version of that red" rather than in hex — but the hex box is there too, since
// a club's real colours arrive as hex and typing one in must be possible.

import { useCallback, useRef } from "react";
import { hexToHsl, hslToHex, isHex } from "@/lib/visual/patterns";

export function ColorWheel({
  value,
  onChange,
  swatches,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** Colours already used elsewhere in this design. Reusing one is by far the
   * commonest action — a kit's trim is nearly always a colour already on the
   * shirt — and hunting for it on the wheel again never lands on the same hex. */
  swatches?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, sat, light] = hexToHsl(value);

  const pointTo = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.width / 2;
      const x = e.clientX - r.left - cx;
      const y = e.clientY - r.top - r.height / 2;
      const angle = ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
      const radius = Math.min(1, Math.hypot(x, y) / cx);
      onChange(hslToHex(angle, Math.round(radius * 100), light));
    },
    [onChange, light]
  );

  const markerA = ((h - 90) * Math.PI) / 180;

  return (
    <div>
      <div
        ref={ref}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointTo(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pointTo(e);
        }}
        className="relative w-full cursor-crosshair rounded-full"
        style={{
          aspectRatio: "1",
          touchAction: "none",
          background:
            "radial-gradient(circle,#fff 0%,rgba(255,255,255,0) 72%)," +
            "conic-gradient(from 0deg,hsl(0 100% 50%),hsl(60 100% 50%),hsl(120 100% 50%),hsl(180 100% 50%),hsl(240 100% 50%),hsl(300 100% 50%),hsl(360 100% 50%))",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
        }}
      >
        {/* Lightness as a veil, so the wheel always matches the swatch it sets */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ background: light < 50 ? "#000" : "#fff", opacity: (Math.abs(light - 50) / 50) * 0.85 }}
        />
        <div
          className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
          style={{
            left: `${50 + Math.cos(markerA) * sat * 0.5}%`,
            top: `${50 + Math.sin(markerA) * sat * 0.5}%`,
            marginLeft: -8,
            marginTop: -8,
            background: value,
            boxShadow: "0 0 0 1px rgba(0,0,0,.6)",
          }}
        />
      </div>

      <input
        type="range"
        min={4}
        max={96}
        value={light}
        aria-label="Lightness"
        onChange={(e) => onChange(hslToHex(h, sat, Number(e.target.value)))}
        className="mt-3 h-1.5 w-full appearance-none rounded-full accent-[var(--color-gold-hi)]"
        style={{ background: `linear-gradient(90deg,#000,${hslToHex(h, sat, 50)},#fff)` }}
      />

      <input
        value={value}
        spellCheck={false}
        aria-label="Hex colour"
        onChange={(e) => {
          const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
          // Only commit a complete hex — updating on every keystroke means
          // deleting a character mid-edit fires an invalid colour at the spec.
          if (isHex(v)) onChange(v.toLowerCase());
        }}
        className="mt-2 w-full rounded-md border border-line bg-pitch px-2.5 py-1.5 text-xs uppercase tracking-wider text-ink focus:border-gold focus:outline-none"
      />

      {swatches && swatches.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="display text-[10px] tracking-widest text-faint">IN USE</span>
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              title={c}
              aria-label={`Use ${c}`}
              className="h-5 w-5 rounded-sm border"
              style={{ background: c, borderColor: c === value ? "var(--color-gold)" : "rgba(255,255,255,.25)" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
