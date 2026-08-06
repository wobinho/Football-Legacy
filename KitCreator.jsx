import { useId, useRef, useState, useCallback } from "react";

/* ============================================================================
   FOOTBALL LEGACY — KIT CREATOR (shirt only)

     1. THE SPEC      four jerseys per club (home / away / third / gk)
     2. THE RENDERER  pure (spec, size, view) -> SVG
     3. THE CREATOR   UI that edits specs and nothing else
   ========================================================================== */

/* ############################################################################
   ##  SHARED MODULE — the pattern engine, shared with the badge creator.
   ##  This becomes `lib/visual/patterns.js` and BOTH files import it.
   ######################################################################### */

/* 51 patterns, grouped — a flat grid this long is a wall, and the groups are
   how you actually think about a kit: what's the base block, does it run
   vertically or horizontally, is there a texture over the top. */
export const PATTERNS = {
  /* Blocks */
  solid: "Solid", halves: "Halves", crossHalves: "Split", quarters: "Quarters",
  xQuarters: "X-quarters", splitDiagonal: "Diagonal", yoke: "Yoke", vPanel: "V-yoke",
  cornerBlock: "Corner", shoulderStripes: "Shoulders", chevrons: "Chevrons",
  arrow: "Arrow", crossBands: "Cross", rays: "Rays", fade: "Fade", fadeSide: "Side fade",
  /* Vertical */
  bars: "Stripes", pinstripes: "Pinstripe", tramlines: "Tramlines",
  taperedStripes: "Tapered", shadowStripes: "Tonal", sideStripes: "Side stripes",
  halfStripes: "Half stripes", lowerStripes: "Low stripes", pale: "Pale", bib: "Bib",
  diagonals: "Slants", sash: "Sash", doubleSash: "Twin sash", flash: "Flash",
  /* Horizontal */
  hoops: "Hoops", thinHoops: "Thin hoops", halfHoops: "Half hoops",
  fadeHoops: "Graded hoops", centreHoops: "Chest hoops", fess: "Band",
  chestBand: "Chest band", hemBand: "Hem block", halo: "Halo",
  waves: "Waves", zigzag: "Zigzag",
  /* Texture */
  checks: "Checks", plaid: "Plaid", argyle: "Argyle", diamonds: "Diamonds",
  dots: "Dots", speckle: "Marl", honeycomb: "Honeycomb", scales: "Scales",
  grid: "Grid", triangles: "Triangles",
};

export const PATTERN_GROUPS = [
  { label: "Blocks", keys: ["solid", "halves", "crossHalves", "quarters", "xQuarters", "splitDiagonal", "yoke", "vPanel", "cornerBlock", "shoulderStripes", "chevrons", "arrow", "crossBands", "rays", "fade", "fadeSide"] },
  { label: "Vertical", keys: ["bars", "pinstripes", "tramlines", "taperedStripes", "shadowStripes", "sideStripes", "halfStripes", "lowerStripes", "pale", "bib", "diagonals", "sash", "doubleSash", "flash"] },
  { label: "Horizontal", keys: ["hoops", "thinHoops", "halfHoops", "fadeHoops", "centreHoops", "fess", "chestBand", "hemBand", "halo", "waves", "zigzag"] },
  { label: "Texture", keys: ["checks", "plaid", "argyle", "diamonds", "dots", "speckle", "honeycomb", "scales", "grid", "triangles"] },
];

/* Patterns always draw into a 0..100 unit box. Each part declares where that
   box maps to, so one pattern set serves a shield and a jersey alike. */
export const boxTransform = (x, y, w, h) =>
  `translate(${x} ${y}) scale(${(w / 100).toFixed(4)} ${(h / 100).toFixed(4)})`;

/* Fixed offsets rather than a PRNG: a texture has to look the same every
   render, in every save, on every machine. */
const SPECKLE = [[.14, .21, .085], [.61, .10, .055], [.37, .54, .10], [.86, .47, .065], [.23, .81, .06], [.71, .77, .09], [.49, .30, .05]];

export function PatternLayer({ pat, patColor, patCount, uid }) {
  const n = Math.max(2, Math.min(12, patCount || 5));
  const out = [];
  switch (pat) {

    /* ---------------- blocks ---------------- */
    case "halves": return <rect x="50" y="0" width="50" height="100" fill={patColor} />;
    case "crossHalves": return <rect x="0" y="50" width="100" height="50" fill={patColor} />;
    case "quarters": return (<g fill={patColor}><rect x="50" y="0" width="50" height="50" /><rect x="0" y="50" width="50" height="50" /></g>);
    case "xQuarters": return (<g fill={patColor}><path d="M50 50 L-5 -5 H105 Z" /><path d="M50 50 L-5 105 H105 Z" /></g>);
    case "splitDiagonal": return <path d="M105 -5 V105 H-5 Z" fill={patColor} />;
    case "yoke": return <path d="M-5 -5 H105 V20 Q50 34 -5 20 Z" fill={patColor} />;
    case "vPanel": return <path d="M-5 -5 H105 V8 L50 54 L-5 8 Z" fill={patColor} />;
    case "cornerBlock": return <path d="M-5 -5 H64 L-5 64 Z" fill={patColor} />;
    case "shoulderStripes": return (        /* three bars across the shoulders */
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
        out.push(<path key={i} d={`M-10,${y + step * .7} L50,${y} L110,${y + step * .7} L110,${y + step * 1.15} L50,${y + step * .45} L-10,${y + step * 1.15} Z`} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "arrow": return <path d="M-5 8 L50 52 L105 8 V32 L50 76 L-5 32 Z" fill={patColor} />;
    case "crossBands": return (<g fill={patColor}><rect x="38" y="-5" width="24" height="110" /><rect x="-5" y="34" width="110" height="24" /></g>);
    case "rays": {
      const slices = n * 2;
      for (let i = 0; i < slices; i += 2) {
        const a1 = (Math.PI * 2 / slices) * i, a2 = (Math.PI * 2 / slices) * (i + 1);
        out.push(<path key={i} d={`M50,50 L${50 + Math.cos(a1) * 95},${50 + Math.sin(a1) * 95} L${50 + Math.cos(a2) * 95},${50 + Math.sin(a2) * 95} Z`} fill={patColor} />);
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
      const w = 100 / n, t = w * 0.13;
      for (let i = 0; i < n; i++) {
        out.push(<rect key={`${i}a`} x={i * w + w * .18} y="0" width={t} height="100" fill={patColor} />);
        out.push(<rect key={`${i}b`} x={i * w + w * .42} y="0" width={t} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "taperedStripes": {                /* widest at the centre of the chest */
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) {
        const off = Math.abs((i + .5) / n - .5) * 2;
        const bw = w * (1 - off * .7);
        out.push(<rect key={i} x={i * w + (w - bw) / 2} y="0" width={bw} height="100" fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "shadowStripes": {                 /* tonal — same colour, low alpha */
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x={i * w} y="0" width={w} height="100" fill={patColor} opacity=".22" />);
      return <g>{out}</g>;
    }
    case "sideStripes": return (            /* down the outer seams of the torso */
      <g fill={patColor}><rect x="23" y="0" width="5" height="100" /><rect x="72" y="0" width="5" height="100" /></g>
    );
    case "halfStripes": {
      const w = 50 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x={50 + i * w} y="0" width={w} height="100" fill={patColor} />);
      return <g>{out}</g>;
    }
    case "lowerStripes": {
      const w = 100 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x={i * w} y="50" width={w} height="50" fill={patColor} />);
      return <g>{out}</g>;
    }
    case "pale": return <rect x="36" y="0" width="28" height="100" fill={patColor} />;
    case "bib": return <path d="M32 -5 H68 V70 Q50 84 32 70 Z" fill={patColor} />;
    case "diagonals": {
      const w = 140 / n;
      for (let i = 0; i < n * 2; i += 2) out.push(<rect key={i} x={-70 + i * w} y="-40" width={w} height="180" fill={patColor} />);
      return <g transform="rotate(-45 50 50)">{out}</g>;
    }
    case "sash": return <rect x="-40" y="39" width="180" height="22" fill={patColor} transform="rotate(-38 50 50)" />;
    case "doubleSash": return (
      <g transform="rotate(-38 50 50)">
        <rect x="-40" y="30" width="180" height="13" fill={patColor} />
        <rect x="-40" y="53" width="180" height="13" fill={patColor} />
      </g>
    );
    case "flash": return <rect x="-40" y="26" width="180" height="9" fill={patColor} transform="rotate(-54 50 50)" />;

    /* ---------------- horizontal ---------------- */
    case "hoops": {
      const h = 100 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x="0" y={i * h} width="100" height={h} fill={patColor} />);
      return <g>{out}</g>;
    }
    case "thinHoops": {
      const h = 100 / (n * 2);
      for (let i = 0; i < n * 2; i++) out.push(<rect key={i} x="0" y={i * h} width="100" height={h * .42} fill={patColor} />);
      return <g>{out}</g>;
    }
    case "halfHoops": {
      const h = 50 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x="0" y={50 + i * h} width="100" height={h} fill={patColor} />);
      return <g>{out}</g>;
    }
    case "fadeHoops": {                     /* thinning as they descend */
      const step = 100 / n;
      for (let i = 0; i < n; i++) {
        const t = step * (1 - i / n) * .85;
        if (t > .5) out.push(<rect key={i} x="0" y={i * step} width="100" height={t} fill={patColor} />);
      }
      return <g>{out}</g>;
    }
    case "centreHoops": {                   /* a cluster across the chest only */
      const h = 42 / n;
      for (let i = 0; i < n; i += 2) out.push(<rect key={i} x="0" y={29 + i * h} width="100" height={h} fill={patColor} />);
      return <g>{out}</g>;
    }
    case "fess": return <rect x="0" y="38" width="100" height="24" fill={patColor} />;
    case "chestBand": return <rect x="0" y="23" width="100" height="17" fill={patColor} />;
    case "hemBand": return <rect x="0" y="68" width="100" height="37" fill={patColor} />;
    case "halo": return (
      <g fill={patColor}>
        <rect x="0" y="29" width="100" height="3" />
        <rect x="0" y="36" width="100" height="17" />
        <rect x="0" y="57" width="100" height="3" />
      </g>
    );
    case "waves": {
      const step = 100 / n, a = step * .3, t = step * .5;
      for (let i = 0; i < n; i++) {
        const y = i * step + step / 2;
        out.push(<path key={i} d={`M-10 ${y} Q10 ${y - a * 2} 30 ${y} T70 ${y} T110 ${y}`} fill="none" stroke={patColor} strokeWidth={t} />);
      }
      return <g>{out}</g>;
    }
    case "zigzag": {
      const step = 100 / n, a = step * .3, t = step * .4;
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
       hundreds of nodes per jersey at high counts, and this screen renders
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
      for (let i = 0; i < n; i += 2) out.push(<rect key={`v${i}`} x={i * s} y="0" width={s} height="100" fill={patColor} opacity=".5" />);
      for (let i = 0; i < n; i += 2) out.push(<rect key={`h${i}`} x="0" y={i * s} width="100" height={s} fill={patColor} opacity=".5" />);
      return <g>{out}</g>;
    }
    case "argyle": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s * 1.3} patternUnits="userSpaceOnUse">
              <path d={`M${s / 2} 0 L${s} ${s * .65} L${s / 2} ${s * 1.3} L0 ${s * .65} Z`} fill={patColor} opacity=".88" />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "diamonds": {                      /* open lattice, harlequin scale */
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={s} patternUnits="userSpaceOnUse">
              <path d={`M${s / 2} 0 L${s} ${s / 2} L${s / 2} ${s} L0 ${s / 2} Z`}
                    fill="none" stroke={patColor} strokeWidth={s * .12} />
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
              <circle cx={s / 2} cy={s / 2} r={s * .22} fill={patColor} />
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "speckle": {                       /* marl / heather flecks */
      const s = 100 / n * 1.4;
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
      const h = r * Math.sqrt(3), w = r * 3;
      const hex = (cx, cy) => {
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
              <g fill="none" stroke={patColor} strokeWidth={r * .18}>
                <path d={hex(0, h / 2)} /><path d={hex(w, h / 2)} />
                <path d={hex(w / 2, 0)} /><path d={hex(w / 2, h)} />
              </g>
            </pattern>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#p-${uid})`} />
        </g>
      );
    }
    case "scales": {
      const s = 100 / n, h = s * .5;
      return (
        <g>
          <defs>
            <pattern id={`p-${uid}`} width={s} height={h * 2} patternUnits="userSpaceOnUse">
              <g fill="none" stroke={patColor} strokeWidth={s * .09}>
                <path d={`M0 ${h} A ${s / 2} ${h * .95} 0 0 1 ${s} ${h}`} />
                <path d={`M${-s / 2} ${h * 2} A ${s / 2} ${h * .95} 0 0 1 ${s / 2} ${h * 2}`} />
                <path d={`M${s / 2} ${h * 2} A ${s / 2} ${h * .95} 0 0 1 ${s * 1.5} ${h * 2}`} />
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
              <path d={`M0 0 H${s} M0 0 V${s}`} fill="none" stroke={patColor} strokeWidth={s * .09} />
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

    default: return null;   /* solid */
  }
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hx = (n) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
  return `#${hx(0)}${hx(8)}${hx(4)}`;
}
export function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return [0, 0, 50];
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}
export function toRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? m.slice(1).map((v) => parseInt(v, 16)) : [0, 0, 0];
}
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const readableOn = (hex) => (luminance(hex) > 0.42 ? "#0b0c0f" : "#ffffff");

/* ############################################################################
   ##  END SHARED MODULE
   ######################################################################### */

/* ---------------------------------------------------------------------------
   1. THE SPEC

   Not in here: the squad number and the player's name. Those are player data
   rendered *onto* a jersey. The colour of the number is kit data; the digits
   are not.
   ------------------------------------------------------------------------- */

export const KIT_SCHEMA_VERSION = 4;   // v1 shorts/socks · v2 solid hem band · v3 hem line

const BASE_KIT = {
  v: KIT_SCHEMA_VERSION,
  body: "#16325c",
  pat: "bars", patColor: "#e2b53f", patCount: 5,
  sleeves: "",              // "" = match the body; a hex = contrast sleeves
  collar: "crew", collarColor: "#e2b53f",
  trim: "#e2b53f",          // cuffs only, now that the hem carries no trim
  cuffs: true,
  numberColor: "#f5f5f5",
  frontNumber: false,
  showBadge: true,
};

export const DEFAULT_KITSET = {
  home:  { ...BASE_KIT },
  away:  { ...BASE_KIT, body: "#f2f2f0", pat: "pinstripes", patColor: "#16325c", collarColor: "#16325c", trim: "#16325c", numberColor: "#16325c" },
  third: { ...BASE_KIT, body: "#1d1f24", pat: "sash", patColor: "#e2b53f", collar: "vneck" },
  gk:    { ...BASE_KIT, body: "#2fae63", pat: "honeycomb", patColor: "#0f3d2e", patCount: 7, collar: "polo", collarColor: "#0f3d2e", trim: "#0f3d2e", numberColor: "#0f3d2e" },
};

export const KIT_SLOTS = [
  { key: "home", label: "Home" }, { key: "away", label: "Away" },
  { key: "third", label: "Third" }, { key: "gk", label: "Goalkeeper" },
];

export const normaliseKit = (k) => ({ ...BASE_KIT, ...(k || {}), v: KIT_SCHEMA_VERSION });

/* ---------------------------------------------------------------------------
   GEOMETRY

   The body no longer flares. It used to run 24.5 at the armpit out to 21.5 at
   the hem — three units wider per side, six across — which read as a bell.
   It now runs 24.5 to 25.5, a slight taper, with the waist pulled in a touch
   between. Straight would have been safe; tapered reads as a garment cut to
   fit rather than a tube.

   The hem carries no trim at all now, so every pattern runs clean to the
   bottom edge.
   ------------------------------------------------------------------------- */

/* Runs clockwise from the left edge of the neck round to the right edge. */
const SHIRT_BODY =
  "M42 12 " +
  "C38 12 33 12 29 13.5 " +          // left shoulder, sloping outward
  "C22 18 11 29 5 37 " +             // sleeve cap
  "L19 46.5 " +                      // cuff edge
  "C21 42 23 38 24.5 35 " +          // underarm seam, up to the armpit
  "C25 50 25.4 68 25.5 85 " +        // body side: fitted, never flaring
  "Q50 88 74.5 85 " +                // hem, gently bowed
  "C74.6 68 75 50 75.5 35 " +
  "C77 38 79 42 81 46.5 " +
  "L95 37 " +
  "C89 29 78 18 71 13.5 " +
  "C67 12 62 12 58 12";

/* The neckline closes the path back to (42,12): a V-neck is a genuine V-shaped
   hole, not a V band painted over a round one. */
const NECKLINES = {
  none:  "Q50 20 42 12",
  crew:  "Q50 23 42 12",
  polo:  "Q50 23 42 12",
  vneck: "L50 32 L42 12",
  wrap:  "L50 30 L42 12",
};

export const COLLARS = { none: "None", crew: "Crew", vneck: "V-neck", polo: "Polo", wrap: "Wrap" };
export const shirtPath = (collar) => `${SHIRT_BODY} ${NECKLINES[collar] || NECKLINES.crew} Z`;

/* Sleeve regions: the half-plane on the sleeve side of the true shoulder-to-
   armpit seam — the line through (29,13.5) and (24.5,35) — extended well past
   the shirt. Used for contrast sleeves AND as a second clip for the cuffs. */
const SLEEVE_L = "M32.7 -4 L20.9 52 L-12 52 L-12 -4 Z";
const SLEEVE_R = "M67.3 -4 L79.1 52 L112 52 L112 -4 Z";

/* Cuffs overhang the cuff edge on purpose. Clipping to the shirt alone was not
   enough: below the armpit the sleeve and the torso are two separate lobes of
   one outline, so a cuff's inner corner reached across the gap and printed a
   stray wedge on the body. Clipping each cuff to its own sleeve region as well
   means the intersection can only ever land inside that sleeve. */
const CUFF_L = "M1.7 34.8 L22.3 48.7 L25.4 44.2 L4.8 30.3 Z";
const CUFF_R = "M98.3 34.8 L77.7 48.7 L74.6 44.2 L95.2 30.3 Z";

const SHIRT_BOX = [5, 10, 90, 78];   // where the pattern unit box maps to

function Collar({ type, color }) {
  switch (type) {
    case "crew":
      return <path d="M42 12 Q50 23 58 12 L61 13.5 Q50 29 39 13.5 Z" fill={color} />;
    case "vneck":
      return <path d="M42 12 L50 32 L58 12 L61.5 14 L50 38 L38.5 14 Z" fill={color} />;
    case "polo":
      return (
        <g fill={color}>
          <path d="M42 12 Q50 23 58 12 L61.5 14 Q50 31 38.5 14 Z" />
          <path d="M47.5 23 h5 v13 h-5 Z" />
        </g>
      );
    case "wrap":
      return <path d="M41 12 L50 30 L59 12 L62.5 14 L50 36 L46.5 28 L37.5 14 Z" fill={color} />;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------------------
   2. THE RENDERER
   ------------------------------------------------------------------------- */

export function ClubKit({
  spec, size = 200, view = "front",
  number = "", playerName = "", detail, title,
}) {
  const k = normaliseKit(spec);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");   // SSR-safe; Math.random() is not
  const lod = detail || (size < 30 ? "micro" : size < 70 ? "small" : "full");
  const d = shirtPath(k.collar);
  const back = view === "back";
  const num = String(number ?? "").slice(0, 2);

  return (
    <svg viewBox="0 0 100 100" width={size} height={size}
      role="img" aria-label={title || "Club jersey"}
      style={{ display: "block", overflow: "visible" }}>

      <clipPath id={`sh-${uid}`}><path d={d} /></clipPath>
      <clipPath id={`slL-${uid}`}><path d={SLEEVE_L} /></clipPath>
      <clipPath id={`slR-${uid}`}><path d={SLEEVE_R} /></clipPath>

      <g clipPath={`url(#sh-${uid})`}>
        <path d={d} fill={k.body} />
        <g transform={boxTransform(...SHIRT_BOX)}>
          <PatternLayer pat={k.pat} patColor={k.patColor} patCount={k.patCount} uid={uid} />
        </g>
        {k.sleeves && (<g fill={k.sleeves}><path d={SLEEVE_L} /><path d={SLEEVE_R} /></g>)}

        {/* Nested clip = intersection: shirt AND sleeve. */}
        {k.cuffs && lod !== "micro" && (
          <>
            <g clipPath={`url(#slL-${uid})`}><path d={CUFF_L} fill={k.trim} /></g>
            <g clipPath={`url(#slR-${uid})`}><path d={CUFF_R} fill={k.trim} /></g>
          </>
        )}
      </g>

      {lod !== "micro" && <Collar type={k.collar} color={k.collarColor} />}

      {back ? (
        lod !== "micro" && (
          <g textAnchor="middle" fill={k.numberColor}
             fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif" fontWeight="700">
            {playerName && lod === "full" && (
              <text x="50" y="36" fontSize="8" letterSpacing=".16em">
                {String(playerName).toUpperCase().slice(0, 14)}
              </text>
            )}
            <text x="50" y={playerName ? 73 : 69} fontSize="34"
                  style={{ fontVariantNumeric: "tabular-nums" }}>{num}</text>
          </g>
        )
      ) : (
        <>
          {k.showBadge && lod === "full" && (
            /* Right chest. In your app:
               <ClubBadge spec={club.badge} size={14} detail="micro" />
               A nested <svg> renders at its group's origin. */
            <g transform="translate(55 29)">
              <path d="M0 0 H14 V7.5 C14 11.5 10.7 13.8 7 15 C3.3 13.8 0 11.5 0 7.5 Z"
                    fill={k.numberColor} opacity=".92" />
            </g>
          )}
          {k.frontNumber && lod !== "micro" && (
            <text x="50" y="66" textAnchor="middle" fill={k.numberColor}
                  fontSize="19" fontWeight="700"
                  fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif"
                  style={{ fontVariantNumeric: "tabular-nums" }}>{num}</text>
          )}
        </>
      )}

      <path d={d} fill="none" stroke="rgba(0,0,0,.38)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   KIT SELECTION — no UI, but the game layer needs it. Home side wears home;
   the away side takes the first of its own three that doesn't clash.
   ------------------------------------------------------------------------- */

export function colorDistance(a, b) {          /* redmean, max ~765 */
  const [r1, g1, b1] = toRgb(a), [r2, g2, b2] = toRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
export const CLASH_THRESHOLD = 115;
const visibleColors = (k) => (k.pat === "solid" ? [k.body] : [k.body, k.patColor]);
export function kitsClash(a, b) {
  const A = visibleColors(normaliseKit(a)), B = visibleColors(normaliseKit(b));
  let min = Infinity;
  for (const x of A) for (const y of B) min = Math.min(min, colorDistance(x, y));
  return { clash: min < CLASH_THRESHOLD, distance: Math.round(min) };
}
export function pickKitsForFixture(homeSet, awaySet) {
  const home = normaliseKit(homeSet.home);
  for (const slot of ["home", "away", "third"]) {
    if (!kitsClash(home, awaySet[slot]).clash) return { homeKit: "home", awayKit: slot, forcedClash: false };
  }
  return { homeKit: "home", awayKit: "third", forcedClash: true };
}

/* ---------------------------------------------------------------------------
   3. THE CREATOR UI
   ------------------------------------------------------------------------- */

const GOLD = "#e2b53f", INK = "#0b0c0f", PANEL = "#131519",
      LINE = "rgba(226,181,63,0.22)", MUTE = "#8b8f98";

function ColorWheel({ value, onChange }) {
  const ref = useRef(null);
  const [h, sat, light] = hexToHsl(value);
  const pointTo = useCallback((e) => {
    const r = ref.current.getBoundingClientRect();
    const cx = r.width / 2, x = e.clientX - r.left - cx, y = e.clientY - r.top - r.height / 2;
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
    onChange(hslToHex(angle, Math.round(Math.min(1, Math.hypot(x, y) / cx) * 100), light));
  }, [onChange, light]);
  const a = ((h - 90) * Math.PI) / 180;
  return (
    <div>
      <div ref={ref}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pointTo(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) pointTo(e); }}
        style={{
          position: "relative", width: "100%", aspectRatio: "1", borderRadius: "50%",
          touchAction: "none", cursor: "crosshair",
          background: "radial-gradient(circle,#fff 0%,rgba(255,255,255,0) 72%),conic-gradient(from 0deg,hsl(0 100% 50%),hsl(60 100% 50%),hsl(120 100% 50%),hsl(180 100% 50%),hsl(240 100% 50%),hsl(300 100% 50%),hsl(360 100% 50%))",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
        }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", background: light < 50 ? "#000" : "#fff", opacity: Math.abs(light - 50) / 50 * .85 }} />
        <div style={{ position: "absolute", left: `${50 + Math.cos(a) * sat * .5}%`, top: `${50 + Math.sin(a) * sat * .5}%`, width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: value, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.6)", pointerEvents: "none" }} />
      </div>
      <input type="range" min="4" max="96" value={light}
        onChange={(e) => onChange(hslToHex(h, sat, Number(e.target.value)))}
        style={{ width: "100%", marginTop: 12, height: 6, borderRadius: 3, appearance: "none", outline: "none", background: `linear-gradient(90deg,#000,${hslToHex(h, sat, 50)},#fff)` }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        style={{ width: "100%", marginTop: 10, background: INK, border: `1px solid ${LINE}`, color: "#e9eaee", padding: "8px 10px", fontSize: 13, letterSpacing: ".08em", borderRadius: 2, textTransform: "uppercase" }} />
    </div>
  );
}

function Section({ label, children, right }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 11, letterSpacing: ".18em", color: GOLD, fontWeight: 700, fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif" }}>{label}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children, title, disabled }) {
  return (
    <button className="fl-chip" onClick={onClick} title={title} disabled={disabled} style={{
      background: active ? "rgba(226,181,63,.14)" : "transparent",
      border: `1px solid ${active ? GOLD : "rgba(255,255,255,.1)"}`,
      color: disabled ? "#4a4d55" : active ? GOLD : "#c6c9d0",
      padding: "7px 10px", fontSize: 11, letterSpacing: ".08em",
      cursor: disabled ? "not-allowed" : "pointer", borderRadius: 2, textTransform: "uppercase",
      fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif", fontWeight: 600,
      opacity: disabled ? .5 : 1,
    }}>{children}</button>
  );
}

export default function KitCreator() {
  const [kits, setKits] = useState(DEFAULT_KITSET);
  const [slot, setSlot] = useState("home");
  const [target, setTarget] = useState("body");
  const [view, setView] = useState("front");
  const [group, setGroup] = useState("Blocks");
  const [clip, setClip] = useState(null);        // the colour clipboard
  /* Preview only — the player, not the kit. Never written to the spec. */
  const [number, setNumber] = useState("9");
  const [playerName, setPlayerName] = useState("MARQUEZ");

  const kit = kits[slot];
  const set = (patch) => setKits((p) => ({ ...p, [slot]: { ...p[slot], ...patch } }));

  const colorTargets = [
    ["body", "Shirt"], ["patColor", "Pattern"], ["sleeves", "Sleeves"],
    ["collarColor", "Collar"], ["trim", "Cuffs"], ["numberColor", "Number"],
  ];
  const current = target === "sleeves" ? (kit.sleeves || kit.body) : kit[target];
  const inUse = [...new Set(colorTargets.map(([k]) => (k === "sleeves" ? kit.sleeves : kit[k])).filter(Boolean))];

  const invert = () => set({ body: kit.patColor, patColor: kit.body, numberColor: readableOn(kit.patColor) });
  const json = JSON.stringify(kits);
  const groupKeys = PATTERN_GROUPS.find((g) => g.label === group).keys;

  return (
    <div style={{ background: INK, color: "#e9eaee", minHeight: "100%", padding: 20, fontFamily: "'Instrument Sans',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        .fl-chip:hover:not(:disabled) { border-color: ${GOLD} !important; color: ${GOLD} !important; }
        .fl-grid { display:grid; grid-template-columns:1fr; gap:22px; }
        @media (min-width: 880px) { .fl-grid { grid-template-columns: 320px 1fr; } }
        input[type=range]::-webkit-slider-thumb {
          appearance:none; width:14px; height:14px; border-radius:50%;
          background:${GOLD}; cursor:pointer; border:2px solid ${INK};
        }
      `}</style>

      <header style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 20 }}>
        <h1 style={{
          margin: 0, fontSize: 22, letterSpacing: ".16em", fontWeight: 700, textTransform: "uppercase",
          fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif",
          background: `linear-gradient(90deg,${GOLD},#f6e0a0)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>Kit Creator</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTE }}>
          Four jerseys per club, 51 patterns, one small object per jersey.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {KIT_SLOTS.map((s) => (
          <button key={s.key} className="fl-chip" onClick={() => setSlot(s.key)} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "5px 12px 5px 7px", cursor: "pointer",
            background: slot === s.key ? "rgba(226,181,63,.12)" : "transparent",
            border: `1px solid ${slot === s.key ? GOLD : "rgba(255,255,255,.1)"}`,
            borderRadius: 2, color: slot === s.key ? GOLD : "#c6c9d0",
            fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600,
            fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif",
          }}>
            <ClubKit spec={kits[s.key]} size={30} detail="small" />
            {s.label}
          </button>
        ))}
      </div>

      <div className="fl-grid">
        {/* ---------- PREVIEW ---------- */}
        <div>
          <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 3, padding: 22, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <Chip active={view === "front"} onClick={() => setView("front")}>Front</Chip>
              <Chip active={view === "back"} onClick={() => setView("back")}>Back</Chip>
            </div>
            <ClubKit spec={kit} size={240} view={view} number={number} playerName={playerName} />
            <div style={{ height: 1, width: "100%", background: LINE, margin: "16px 0 14px" }} />
            <div style={{ fontSize: 10, letterSpacing: ".14em", color: MUTE, marginBottom: 12 }}>SQUAD LIST VIEW</div>
            <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
              {[20, 28, 44].map((px) => (
                <div key={px} style={{ textAlign: "center" }}>
                  <ClubKit spec={kit} size={px} />
                  <div style={{ fontSize: 9, color: MUTE, marginTop: 6 }}>{px}px</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Chip onClick={invert}>Invert colours</Chip>
            {slot !== "home" && <Chip onClick={() => setKits((p) => ({ ...p, [slot]: { ...p.home } }))}>Copy from home</Chip>}
            <Chip onClick={() => navigator.clipboard?.writeText(json)}>Copy all four</Chip>
            <Chip onClick={() => setKits(DEFAULT_KITSET)}>Reset</Chip>
          </div>
          <p style={{ fontSize: 11, color: MUTE, marginTop: 8 }}>
            All four: {new Blob([json]).size} bytes as written. Shortened keys take a club's full set under 170.
          </p>
        </div>

        {/* ---------- CONTROLS ---------- */}
        <div>
          <Section label="Pattern" right={
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PATTERN_GROUPS.map((g) => (
                <button key={g.label} className="fl-chip" onClick={() => setGroup(g.label)} style={{
                  background: group === g.label ? "rgba(226,181,63,.14)" : "transparent",
                  border: `1px solid ${group === g.label ? GOLD : "rgba(255,255,255,.1)"}`,
                  color: group === g.label ? GOLD : "#c6c9d0", padding: "4px 8px", fontSize: 10,
                  letterSpacing: ".08em", cursor: "pointer", borderRadius: 2, textTransform: "uppercase",
                  fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif", fontWeight: 600,
                }}>{g.label}</button>
              ))}
            </div>
          }>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(60px,1fr))", gap: 8 }}>
              {groupKeys.map((key) => (
                <button key={key} className="fl-chip" onClick={() => set({ pat: key })} title={PATTERNS[key]}
                  style={{ background: "transparent", padding: 4, cursor: "pointer", color: MUTE, border: `1px solid ${kit.pat === key ? GOLD : "rgba(255,255,255,.08)"}`, borderRadius: 2 }}>
                  {/* Swatches render through the real component, so a preview
                      can never promise something the game won't draw. */}
                  <ClubKit spec={{ ...kit, pat: key, showBadge: false, frontNumber: false }} size={44} detail="small" />
                  <span style={{ fontSize: 8.5, letterSpacing: ".04em", display: "block", marginTop: 2, textTransform: "uppercase" }}>{PATTERNS[key]}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
              <input type="range" min="2" max="12" value={kit.patCount}
                onChange={(e) => set({ patCount: Number(e.target.value) })}
                style={{ flex: 1, height: 6, appearance: "none", background: "#23262c", borderRadius: 3 }} />
              <span style={{ fontSize: 11, color: MUTE, width: 58, fontVariantNumeric: "tabular-nums" }}>{kit.patCount} bands</span>
            </div>
          </Section>

          <Section label="Collar">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(COLLARS).map(([k, l]) => (
                <Chip key={k} active={kit.collar === k} onClick={() => set({ collar: k })}>{l}</Chip>
              ))}
            </div>
          </Section>

          <Section label="Colours" right={
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Chip onClick={() => setClip(current)} title="Copy this colour">Copy</Chip>
              <Chip onClick={() => clip && set({ [target]: clip })} disabled={!clip} title="Paste into the selected slot">Paste</Chip>
              {clip && <span style={{ width: 16, height: 16, background: clip, borderRadius: 2, border: "1px solid rgba(255,255,255,.3)" }} title={clip} />}
            </div>
          }>
            <div style={{ display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" }}>
              {colorTargets.map(([k, l]) => {
                const isSleeves = k === "sleeves";
                const swatch = isSleeves ? (kit.sleeves || kit.body) : kit[k];
                return (
                  <button key={k} className="fl-chip" onClick={() => setTarget(k)} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", cursor: "pointer",
                    background: target === k ? "rgba(226,181,63,.12)" : "transparent",
                    border: `1px solid ${target === k ? GOLD : "rgba(255,255,255,.1)"}`,
                    borderRadius: 2, color: target === k ? GOLD : "#c6c9d0",
                    fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase",
                  }}>
                    <span style={{ width: 12, height: 12, background: swatch, borderRadius: 2, border: "1px solid rgba(255,255,255,.25)", opacity: isSleeves && !kit.sleeves ? .4 : 1 }} />
                    {l}
                  </button>
                );
              })}
            </div>

            {inUse.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, letterSpacing: ".12em", color: MUTE, textTransform: "uppercase" }}>In this kit</span>
                {inUse.map((c) => (
                  <button key={c} onClick={() => set({ [target]: c })} title={c}
                    style={{ width: 20, height: 20, background: c, borderRadius: 2, border: `1px solid ${c === current ? GOLD : "rgba(255,255,255,.25)"}`, cursor: "pointer", padding: 0 }} />
                ))}
              </div>
            )}

            {target === "sleeves" && (
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Chip active={!kit.sleeves} onClick={() => set({ sleeves: "" })}>Match shirt</Chip>
                {!kit.sleeves && <span style={{ fontSize: 11, color: MUTE }}>Pick below to give the sleeves their own.</span>}
              </div>
            )}

            <div style={{ maxWidth: 230 }}>
              <ColorWheel value={current} onChange={(hex) => set({ [target]: hex })} />
            </div>
            <button className="fl-chip" onClick={() => set({ numberColor: readableOn(kit.body) })}
              style={{ marginTop: 12, background: "transparent", border: "1px solid rgba(255,255,255,.1)", color: "#c6c9d0", padding: "7px 10px", fontSize: 10.5, letterSpacing: ".08em", cursor: "pointer", borderRadius: 2, textTransform: "uppercase" }}>
              Auto-contrast number
            </button>
          </Section>

          <Section label="Details">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <Chip active={kit.cuffs} onClick={() => set({ cuffs: !kit.cuffs })}>Cuffs</Chip>
              <Chip active={kit.showBadge} onClick={() => set({ showBadge: !kit.showBadge })}>Chest badge</Chip>
              <Chip active={kit.frontNumber} onClick={() => set({ frontNumber: !kit.frontNumber })}>Front number</Chip>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, maxWidth: 320 }}>
              <label style={{ fontSize: 10, letterSpacing: ".12em", color: MUTE, textTransform: "uppercase" }}>
                Number
                <input value={number} maxLength={2}
                  onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
                  style={{ display: "block", width: "100%", marginTop: 5, background: PANEL, border: `1px solid ${LINE}`, color: "#e9eaee", padding: "8px 10px", fontSize: 13, borderRadius: 2 }} />
              </label>
              <label style={{ fontSize: 10, letterSpacing: ".12em", color: MUTE, textTransform: "uppercase" }}>
                Name
                <input value={playerName} maxLength={14}
                  onChange={(e) => setPlayerName(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: 5, background: PANEL, border: `1px solid ${LINE}`, color: "#e9eaee", padding: "8px 10px", fontSize: 13, borderRadius: 2 }} />
              </label>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: MUTE }}>
              Preview only. The number and name belong to the player, not the kit — only the number's colour is stored here.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
