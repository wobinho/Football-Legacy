"use client";

// The only thing in the game that draws a badge. A pure function of
// (spec, size) — no state, no effects — which is what lets the creator's
// pickers render real badges through it: a preview can never promise something
// the game won't draw.

import { useId } from "react";
import {
  BADGE_SHAPES,
  normaliseBadge,
  type BadgeCharge,
  type BadgeSpec,
} from "@/lib/visual/badge";
import { PatternLayer } from "./PatternLayer";

function starPath(points = 5, outer = 15, inner = 6.4): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += (i ? "L" : "M") + (Math.cos(a) * r).toFixed(2) + "," + (Math.sin(a) * r).toFixed(2);
  }
  return d + "Z";
}

function Charge({ type, color }: { type: BadgeCharge; color: string }) {
  switch (type) {
    case "star":
      return <path d={starPath()} fill={color} />;
    case "ball":
      return (
        <g>
          <circle r="15" fill={color} />
          <path d={starPath(5, 8.5, 4.2)} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="1.6" />
          <circle r="15" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="1.4" />
        </g>
      );
    case "crown":
      return <path d="M-15,7 L-17,-9 L-8.5,-1.5 L0,-12 L8.5,-1.5 L17,-9 L15,7 Z" fill={color} />;
    case "tower":
      return <path d="M-11,-11 h4 v4 h4 v-4 h4 v4 h4 v-4 h4 v25 h-24 Z M-4,4 h8 v10 h-8 Z" fill={color} />;
    case "bolt":
      return <path d="M-3,-15 L8,-15 L2,-2.5 L9,-2.5 L-5,15 L-1,1.5 L-8,1.5 Z" fill={color} />;
    case "cross":
      return <path d="M-4.5,-15 h9 v10.5 h10.5 v9 h-10.5 v10.5 h-9 v-10.5 h-10.5 v-9 h10.5 Z" fill={color} />;
    case "wreath":
      return (
        <g fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
          <path d="M-2,15 A15 15 0 0 1 -14,-6" />
          <path d="M2,15 A15 15 0 0 0 14,-6" />
          <path d="M-11,2 l-5,-3 M-13,8 l-5.5,-2 M-8,-4 l-4.5,-4 M11,2 l5,-3 M13,8 l5.5,-2 M8,-4 l4.5,-4" strokeWidth="1.8" />
        </g>
      );
    default:
      return null;
  }
}

/**
 * @param spec   badge spec — pass `badgeFor(club)`, never `club.badge`
 * @param size   rendered px; drives level of detail automatically
 * @param detail force "micro" | "small" | "full" (e.g. for an export at 512px)
 */
export function ClubBadge({
  spec,
  size = 160,
  detail,
  title,
  className,
  inline,
}: {
  spec: Partial<BadgeSpec> | undefined | null;
  size?: number;
  detail?: "micro" | "small" | "full";
  title?: string;
  className?: string;
  /** Place the crest INSIDE another SVG, in that SVG's user units (the kit's
   * chest badge). Without this the component sizes itself in CSS pixels via
   * width/height, which a parent's viewBox does not scale — a 14px crest lands
   * at 14 screen pixels wherever the browser puts it, rather than 14 units up
   * the chest of a 100-unit shirt. `size` is ignored when this is given; the
   * box IS the size. */
  inline?: { x: number; y: number; size: number };
}) {
  const s = normaliseBadge(spec);
  /* useId is SSR-safe (Math.random() is NOT — it hydration-mismatches).
     Non-alphanumerics are stripped because url(#:r0:) is fragile in some
     browsers. */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const drawnAt = inline ? inline.size : size;
  const lod = detail || (drawnAt < 28 ? "micro" : drawnAt < 60 ? "small" : "full");
  const d = BADGE_SHAPES[s.shape]?.d || BADGE_SHAPES.shield.d;
  const hasCharge = s.charge !== "none" && lod !== "micro";
  const showCode = lod !== "micro" && !!s.code;
  const codeY = hasCharge ? 79 : 62;
  const codeSize = hasCharge ? 17 : 32;

  return (
    <svg
      viewBox="0 0 100 100"
      {...(inline
        ? { x: inline.x, y: inline.y, width: inline.size, height: inline.size }
        : { width: size, height: size, style: { display: "block", overflow: "visible", flex: "0 0 auto" } })}
      role="img"
      aria-label={title || `${s.name} club badge`}
      className={className}
    >
      <clipPath id={`clip-${uid}`}>
        <path d={d} />
      </clipPath>

      <g clipPath={`url(#clip-${uid})`}>
        <path d={d} fill={s.ground} />
        {/* At micro sizes only the boldest blocks survive; the rest is mush that
            costs nodes on a screen rendering forty crests. */}
        {lod !== "micro" || s.pat === "halves" || s.pat === "bars" ? (
          <PatternLayer pat={s.pat} patColor={s.patColor} patCount={s.patCount} uid={uid} />
        ) : null}
      </g>

      {/* Inner line: the same path scaled about the centre. Works for every
          shape without authoring a second path per silhouette. */}
      {s.innerLine && lod === "full" && (
        <path
          d={d}
          fill="none"
          stroke={s.border}
          strokeWidth="1"
          opacity="0.8"
          transform="translate(50 50) scale(0.9) translate(-50 -50)"
        />
      )}

      {hasCharge && (
        <g transform={`translate(50 ${s.showName ? 48 : 44})`}>
          <Charge type={s.charge} color={s.chargeColor} />
        </g>
      )}

      {s.showName && lod === "full" && (
        <g>
          <path id={`arc-${uid}`} d="M20 34 A32 32 0 0 1 80 34" fill="none" />
          <text
            fill={s.textColor}
            fontSize="8"
            letterSpacing="1.1"
            fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
            fontWeight="600"
          >
            <textPath href={`#arc-${uid}`} startOffset="50%" textAnchor="middle">
              {String(s.name).toUpperCase().slice(0, 22)}
            </textPath>
          </text>
        </g>
      )}

      {showCode && (
        <text
          x="50"
          y={codeY}
          textAnchor="middle"
          fill={s.textColor}
          fontSize={codeSize}
          fontWeight="700"
          letterSpacing="1.5"
          fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
        >
          {String(s.code).toUpperCase().slice(0, 4)}
        </text>
      )}

      {s.showYear && lod === "full" && (
        <text
          x="50"
          y="89"
          textAnchor="middle"
          fill={s.textColor}
          fontSize="6.5"
          opacity="0.85"
          letterSpacing="1"
          fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
        >
          {s.year}
        </text>
      )}

      <path
        d={d}
        fill="none"
        stroke={s.border}
        strokeWidth={lod === "micro" ? Math.max(2.5, s.borderW) : s.borderW}
        strokeLinejoin="round"
      />
    </svg>
  );
}
