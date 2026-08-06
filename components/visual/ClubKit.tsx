"use client";

// The only thing in the game that draws a jersey. Pure (spec, size, view) ->
// SVG, for the same reason the badge renderer is: the creator's swatches go
// through it, so a preview can never promise something the game won't draw.

import { useId } from "react";
import {
  COLLAR_PATHS,
  CUFF_L,
  CUFF_R,
  normaliseKit,
  shirtPath,
  SHIRT_BOX,
  SLEEVE_L,
  SLEEVE_R,
  type CollarId,
  type KitSpec,
} from "@/lib/visual/kit";
import { boxTransform } from "@/lib/visual/patterns";
import { normaliseBadge, type BadgeSpec } from "@/lib/visual/badge";
import { PatternLayer } from "./PatternLayer";
import { ClubBadge } from "./ClubBadge";

function Collar({ type, color }: { type: CollarId; color: string }) {
  if (type === "none") return null;
  const paths = COLLAR_PATHS[type];
  if (!paths) return null;
  return (
    <g fill={color}>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  );
}

export function ClubKit({
  spec,
  size = 200,
  view = "front",
  number = "",
  playerName = "",
  badge,
  detail,
  title,
  className,
}: {
  spec: Partial<KitSpec> | undefined | null;
  size?: number;
  view?: "front" | "back";
  /** Preview/squad-list data, never stored on the kit — only the number's
   * COLOUR is kit data. */
  number?: string | number;
  playerName?: string;
  /** The club's crest, for the chest badge. Omitted, the chest badge falls back
   * to a plain silhouette — the jersey must still draw for a club whose badge
   * the caller didn't bother to look up. */
  badge?: Partial<BadgeSpec> | null;
  detail?: "micro" | "small" | "full";
  title?: string;
  className?: string;
}) {
  const k = normaliseKit(spec);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ""); // SSR-safe; Math.random() is not
  const lod = detail || (size < 30 ? "micro" : size < 70 ? "small" : "full");
  const d = shirtPath(k.collar);
  const back = view === "back";
  const num = String(number ?? "").slice(0, 2);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title || "Club jersey"}
      className={className}
      style={{ display: "block", overflow: "visible", flex: "0 0 auto" }}
    >
      <clipPath id={`sh-${uid}`}>
        <path d={d} />
      </clipPath>
      <clipPath id={`slL-${uid}`}>
        <path d={SLEEVE_L} />
      </clipPath>
      <clipPath id={`slR-${uid}`}>
        <path d={SLEEVE_R} />
      </clipPath>

      <g clipPath={`url(#sh-${uid})`}>
        <path d={d} fill={k.body} />
        <g transform={boxTransform(...SHIRT_BOX)}>
          <PatternLayer pat={k.pat} patColor={k.patColor} patCount={k.patCount} uid={uid} />
        </g>
        {k.sleeves && (
          <g fill={k.sleeves}>
            <path d={SLEEVE_L} />
            <path d={SLEEVE_R} />
          </g>
        )}

        {/* Nested clip = intersection: shirt AND sleeve. */}
        {k.cuffs && lod !== "micro" && (
          <>
            <g clipPath={`url(#slL-${uid})`}>
              <path d={CUFF_L} fill={k.trim} />
            </g>
            <g clipPath={`url(#slR-${uid})`}>
              <path d={CUFF_R} fill={k.trim} />
            </g>
          </>
        )}
      </g>

      {lod !== "micro" && <Collar type={k.collar} color={k.collarColor} />}

      {back ? (
        lod !== "micro" && (
          <g
            textAnchor="middle"
            fill={k.numberColor}
            fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
            fontWeight="700"
          >
            {playerName && lod === "full" && (
              <text x="50" y="36" fontSize="8" letterSpacing=".16em">
                {String(playerName).toUpperCase().slice(0, 14)}
              </text>
            )}
            <text x="50" y={playerName ? 73 : 69} fontSize="34" style={{ fontVariantNumeric: "tabular-nums" }}>
              {num}
            </text>
          </g>
        )
      ) : (
        <>
          {k.showBadge && lod === "full" && (
            /* Right chest — the REAL crest, through the same component every
               other screen draws, so a jersey can never show a badge the club
               doesn't have. `inline` is what makes that possible: ClubBadge
               normally sizes itself in CSS pixels, and neither a `size` prop
               nor a <g transform> maps those into this shirt's viewBox — the
               crest renders at screen size and lands off the shirt. `inline`
               switches it to x/y/width/height in the parent's user units. */
            badge ? (
              <ClubBadge spec={normaliseBadge(badge)} inline={{ x: 54, y: 21, size: 16 }} detail="micro" />
            ) : (
              <path
                d="M54 21 H70 V29 C70 33.3 66.3 35.9 62 37 C57.7 35.9 54 33.3 54 29 Z"
                fill={k.numberColor}
                opacity=".92"
              />
            )
          )}
          {k.frontNumber && lod !== "micro" && (
            <text
              x="50"
              y="66"
              textAnchor="middle"
              fill={k.numberColor}
              fontSize="19"
              fontWeight="700"
              fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {num}
            </text>
          )}
        </>
      )}

      <path d={d} fill="none" stroke="rgba(0,0,0,.38)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}
