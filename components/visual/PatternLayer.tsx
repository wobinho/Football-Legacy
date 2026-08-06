"use client";

// The 51 patterns, drawn. One component, consumed by both the crest and the
// jersey — see lib/visual/patterns.ts for why they share it.
//
// Everything draws into a 0..100 unit box and is positioned by the CALLER's
// `boxTransform`, so nothing in here knows whether it is filling a shield or a
// torso. Add a pattern here and to `PATTERNS`, and both get it.

import { clampPatternCount, type PatternId } from "@/lib/visual/patterns";

/** Fixed offsets rather than a PRNG: a texture has to look the same every
 * render, in every save, on every machine. */
const SPECKLE: [number, number, number][] = [
  [0.14, 0.21, 0.085],
  [0.61, 0.1, 0.055],
  [0.37, 0.54, 0.1],
  [0.86, 0.47, 0.065],
  [0.23, 0.81, 0.06],
  [0.71, 0.77, 0.09],
  [0.49, 0.3, 0.05],
];

export function PatternLayer({
  pat,
  patColor,
  patCount,
  uid,
}: {
  pat: PatternId | string;
  patColor: string;
  patCount: number;
  /** Unique within the document — every <pattern>/<linearGradient> id is built
   * from it. Pass the owning SVG's `useId()`; two crests on one screen with the
   * same id would have the second silently reuse the first's fill. */
  uid: string;
}) {
  const n = clampPatternCount(patCount);
  const out: React.ReactNode[] = [];

  switch (pat) {
    /* ---------------- blocks ---------------- */
    case "halves":
      return <rect x="50" y="0" width="50" height="100" fill={patColor} />;
    case "crossHalves":
      return <rect x="0" y="50" width="100" height="50" fill={patColor} />;
    case "quarters":
      return (
        <g fill={patColor}>
          <rect x="50" y="0" width="50" height="50" />
          <rect x="0" y="50" width="50" height="50" />
        </g>
      );
    case "xQuarters":
      return (
        <g fill={patColor}>
          <path d="M50 50 L-5 -5 H105 Z" />
          <path d="M50 50 L-5 105 H105 Z" />
        </g>
      );
    case "splitDiagonal":
      return <path d="M105 -5 V105 H-5 Z" fill={patColor} />;
    case "yoke":
      return <path d="M-5 -5 H105 V20 Q50 34 -5 20 Z" fill={patColor} />;
    case "vPanel":
      return <path d="M-5 -5 H105 V8 L50 54 L-5 8 Z" fill={patColor} />;
    case "cornerBlock":
      return <path d="M-5 -5 H64 L-5 64 Z" fill={patColor} />;
    case "shoulderStripes":
      return (
        <g fill={patColor}>
          <rect x="-5" y="5" width="110" height="4.5" />
          <rect x="-5" y="13" width="110" height="4.5" />
          <rect x="-5" y="21" width="110" height="4.5" />
        </g>
      );
    case "chevrons": {
      const step = 100 / n;
      for (let i = 0; i < n; i++) {
        const y = i * step * 1.4 - 20;
        out.push(
          <path
            key={i}
            d={`M-10,${y + step * 0.7} L50,${y} L110,${y + step * 0.7} L110,${y + step * 1.15} L50,${y + step * 0.45} L-10,${y + step * 1.15} Z`}
            fill={patColor}
          />
        );
      }
      return <g>{out}</g>;
    }
    case "arrow":
      return <path d="M-5 8 L50 52 L105 8 V32 L50 76 L-5 32 Z" fill={patColor} />;
    case "crossBands":
      return (
        <g fill={patColor}>
          <rect x="38" y="-5" width="24" height="110" />
          <rect x="-5" y="34" width="110" height="24" />
        </g>
      );
    case "rays": {
      const slices = n * 2;
      for (let i = 0; i < slices; i += 2) {
        const a1 = ((Math.PI * 2) / slices) * i;
        const a2 = ((Math.PI * 2) / slices) * (i + 1);
        out.push(
          <path
            key={i}
            d={`M50,50 L${50 + Math.cos(a1) * 95},${50 + Math.sin(a1) * 95} L${50 + Math.cos(a2) * 95},${50 + Math.sin(a2) * 95} Z`}
            fill={patColor}
          />
        );
      }
      return <g>{out}</g>;
    }
    case "fade":
    case "fadeSide": {
      const side = pat === "fadeSide";
      return (
        <g>
          <defs>
            <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2={side ? "1" : "0"} y2={side ? "0" : "1"}>
              <stop offset="0%" stopColor={patColor} stopOpacity=".95" />
              <stop offset="100%" stopColor={patColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill={`url(#fade-${uid})`} />
        </g>
      );
    }

    /* ---------------- vertical ---------------- */
    case "bars":
    case "pinstripes": {
      const count = pat === "pinstripes" ? n * 2 : n;
      const w = 100 / count;
      for (let i = 0; i < count; i += 2) {
        const bw = pat === "pinstripes" ? w * 0.3 : w;
        out.push(<rect key={i} x={i * w} y="0" width={bw} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "tramlines": {
      const w = 100 / n;
      const t = w * 0.13;
      for (let i = 0; i < n; i++) {
        out.push(<rect key={`${i}a`} x={i * w + w * 0.18} y="0" width={t} height="100" fill={patColor} />);
        out.push(<rect key={`${i}b`} x={i * w + w * 0.42} y="0" width={t} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "taperedStripes": {
      /* widest at the centre of the chest */
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) {
        const off = Math.abs((i + 0.5) / n - 0.5) * 2;
        const bw = w * (1 - off * 0.7);
        out.push(<rect key={i} x={i * w + (w - bw) / 2} y="0" width={bw} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "shadowStripes": {
      /* tonal — same colour, low alpha */
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x={i * w} y="0" width={w} height="100" fill={patColor} opacity=".22" />);
      }
      return <g>{out}</g>;
    }
    case "sideStripes":
      return (
        <g fill={patColor}>
          <rect x="23" y="0" width="5" height="100" />
          <rect x="72" y="0" width="5" height="100" />
        </g>
      );
    case "halfStripes": {
      const w = 50 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x={50 + i * w} y="0" width={w} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "lowerStripes": {
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x={i * w} y="50" width={w} height="50" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "pale":
      return <rect x="36" y="0" width="28" height="100" fill={patColor} />;
    case "bib":
      return <path d="M32 -5 H68 V70 Q50 84 32 70 Z" fill={patColor} />;
    case "diagonals": {
      const w = 140 / n;
      for (let i = 0; i < n * 2; i += 2) {
        out.push(<rect key={i} x={-70 + i * w} y="-40" width={w} height="180" fill={patColor} />);
      }
      return <g transform="rotate(-45 50 50)">{out}</g>;
    }
    case "sash":
      return <rect x="-40" y="39" width="180" height="22" fill={patColor} transform="rotate(-38 50 50)" />;
    case "doubleSash":
      return (
        <g transform="rotate(-38 50 50)">
          <rect x="-40" y="30" width="180" height="13" fill={patColor} />
          <rect x="-40" y="53" width="180" height="13" fill={patColor} />
        </g>
      );
    case "flash":
      return <rect x="-40" y="26" width="180" height="9" fill={patColor} transform="rotate(-54 50 50)" />;

    /* ---------------- horizontal ---------------- */
    case "hoops": {
      const h = 100 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x="0" y={i * h} width="100" height={h} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "thinHoops": {
      const h = 100 / (n * 2);
      for (let i = 0; i < n * 2; i++) {
        out.push(<rect key={i} x="0" y={i * h} width="100" height={h * 0.42} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "halfHoops": {
      const h = 50 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x="0" y={50 + i * h} width="100" height={h} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "fadeHoops": {
      /* thinning as they descend */
      const step = 100 / n;
      for (let i = 0; i < n; i++) {
        const t = step * (1 - i / n) * 0.85;
        if (t > 0.5) out.push(<rect key={i} x="0" y={i * step} width="100" height={t} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "centreHoops": {
      /* a cluster across the chest only */
      const h = 42 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={i} x="0" y={29 + i * h} width="100" height={h} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "fess":
      return <rect x="0" y="38" width="100" height="24" fill={patColor} />;
    case "chestBand":
      return <rect x="0" y="23" width="100" height="17" fill={patColor} />;
    case "hemBand":
      return <rect x="0" y="68" width="100" height="37" fill={patColor} />;
    case "halo":
      return (
        <g fill={patColor}>
          <rect x="0" y="29" width="100" height="3" />
          <rect x="0" y="36" width="100" height="17" />
          <rect x="0" y="57" width="100" height="3" />
        </g>
      );
    case "waves": {
      const step = 100 / n;
      const a = step * 0.3;
      const t = step * 0.5;
      for (let i = 0; i < n; i++) {
        const y = i * step + step / 2;
        out.push(
          <path
            key={i}
            d={`M-10 ${y} Q10 ${y - a * 2} 30 ${y} T70 ${y} T110 ${y}`}
            fill="none"
            stroke={patColor}
            strokeWidth={t}
          />
        );
      }
      return <g>{out}</g>;
    }
    case "zigzag": {
      const step = 100 / n;
      const a = step * 0.3;
      const t = step * 0.4;
      for (let i = 0; i < n; i++) {
        const y = i * step + step / 2;
        let d = `M-10 ${y - a}`;
        for (let x = 0; x <= 110; x += 20) d += ` L${x} ${y + ((x / 20) % 2 ? a : -a)}`;
        out.push(<path key={i} d={d} fill="none" stroke={patColor} strokeWidth={t} strokeLinejoin="miter" />);
      }
      return <g>{out}</g>;
    }

    /* ---------------- texture ----------------
       All tiled with <pattern> rather than looped. A per-cell loop costs
       hundreds of nodes per jersey at high counts, and these screens render
       every swatch in a group at once. */
    case "checks": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s * 2} height={s * 2} patternUnits="userSpaceOnUse">
              <rect x="0" y="0" width={s} height={s} fill={patColor} />
              <rect x={s} y={s} width={s} height={s} fill={patColor} />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "plaid": {
      const s = 100 / n;
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={`v${i}`} x={i * s} y="0" width={s} height="100" fill={patColor} opacity=".5" />);
      }
      for (let i = 0; i < n; i += 2) {
        out.push(<rect key={`h${i}`} x="0" y={i * s} width="100" height={s} fill={patColor} opacity=".5" />);
      }
      return <g>{out}</g>;
    }
    case "argyle": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s * 1.3} patternUnits="userSpaceOnUse">
              <path d={`M${s / 2} 0 L${s} ${s * 0.65} L${s / 2} ${s * 1.3} L0 ${s * 0.65} Z`} fill={patColor} opacity=".88" />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "diamonds": {
      /* open lattice, harlequin scale */
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              <path
                d={`M${s / 2} 0 L${s} ${s / 2} L${s / 2} ${s} L0 ${s / 2} Z`}
                fill="none"
                stroke={patColor}
                strokeWidth={s * 0.12}
              />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "dots": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              <circle cx={s / 2} cy={s / 2} r={s * 0.22} fill={patColor} />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "speckle": {
      /* marl / heather flecks */
      const s = (100 / n) * 1.4;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              {SPECKLE.map(([x, y, r], i) => (
                <circle key={i} cx={x * s} cy={y * s} r={r * s} fill={patColor} />
              ))}
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "honeycomb": {
      const r = Math.max(3, 100 / (n * 2.2));
      const h = r * Math.sqrt(3);
      const w = r * 3;
      const hex = (cx: number, cy: number) => {
        let d = "";
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          d += (i ? "L" : "M") + (cx + Math.cos(a) * r).toFixed(2) + "," + (cy + Math.sin(a) * r).toFixed(2);
        }
        return d + "Z";
      };
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={w} height={h} patternUnits="userSpaceOnUse">
              <g fill="none" stroke={patColor} strokeWidth={r * 0.18}>
                <path d={hex(0, h / 2)} />
                <path d={hex(w, h / 2)} />
                <path d={hex(w / 2, 0)} />
                <path d={hex(w / 2, h)} />
              </g>
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "scales": {
      const s = 100 / n;
      const h = s * 0.5;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={h * 2} patternUnits="userSpaceOnUse">
              <g fill="none" stroke={patColor} strokeWidth={s * 0.09}>
                <path d={`M0 ${h} A ${s / 2} ${h * 0.95} 0 0 1 ${s} ${h}`} />
                <path d={`M${-s / 2} ${h * 2} A ${s / 2} ${h * 0.95} 0 0 1 ${s / 2} ${h * 2}`} />
                <path d={`M${s / 2} ${h * 2} A ${s / 2} ${h * 0.95} 0 0 1 ${s * 1.5} ${h * 2}`} />
              </g>
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "grid": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              <path d={`M0 0 H${s} M0 0 V${s}`} fill="none" stroke={patColor} strokeWidth={s * 0.09} />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "triangles": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              <path d={`M0 ${s} L${s / 2} 0 L${s} ${s} Z`} fill={patColor} opacity=".9" />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }

    default:
      return null; /* solid */
  }
}
