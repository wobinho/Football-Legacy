import { useId, useMemo, useRef, useState, useCallback } from "react";

/* ============================================================================
   FOOTBALL LEGACY — BADGE CREATOR
   ----------------------------------------------------------------------------
   Three layers, deliberately separate:

     1. THE SPEC      a flat, serialisable object. This is what lives in the save.
     2. THE RENDERER  a pure function of (spec, size) -> SVG. No state, no effects.
     3. THE CREATOR   UI that edits the spec. Knows nothing about how it draws.

   The renderer is the single source of truth for what a badge looks like —
   the pickers below render real badges through it, so a preview can never
   promise something the game won't draw.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1. THE SPEC
   Flat on purpose: cheap to serialise, cheap to diff, trivial to migrate.
   In your save you'd shorten these keys further (sh/gr/pt/...) — ~80 bytes/club.
   `v` is the schema version. Add fields; never repurpose one.
   ------------------------------------------------------------------------- */

export const BADGE_SCHEMA_VERSION = 1;

export const DEFAULT_BADGE = {
  v: BADGE_SCHEMA_VERSION,
  shape: "shield",
  ground: "#16325c",
  pat: "bars",
  patColor: "#e2b53f",
  patCount: 5,
  border: "#e2b53f",
  borderW: 2.5,
  innerLine: true,
  charge: "star",
  chargeColor: "#f5f5f5",
  code: "FCL",
  name: "FOOTBALL LEGACY",
  year: 1897,
  textColor: "#f5f5f5",
  showName: true,
  showYear: true,
};

/* Anything missing is filled from the default — that's your migration path.
   A v1 badge loaded by v2 code just picks up v2's defaults for new fields. */
export function normaliseBadge(spec) {
  return { ...DEFAULT_BADGE, ...(spec || {}), v: BADGE_SCHEMA_VERSION };
}

/* ---------------------------------------------------------------------------
   GEOMETRY — every shape drawn in the same 100x100 box.
   Fixed box + CSS sizing means one path works at 18px and at 400px.
   ------------------------------------------------------------------------- */

export const SHAPES = {
  shield: { label: "Shield", d: "M10 6 H90 V50 C90 72 72 88 50 96 C28 88 10 72 10 50 Z" },
  heater: { label: "Heater", d: "M50 4 C72 4 85 8 90 12 V50 C90 72 72 88 50 96 C28 88 10 72 10 50 V12 C15 8 28 4 50 4 Z" },
  circle: { label: "Roundel", d: "M50 4 A46 46 0 1 1 49.98 4 Z" },
  hex:    { label: "Hex",     d: "M50 3 L91 26 V74 L50 97 L9 74 V26 Z" },
  spade:  { label: "Spade",   d: "M50 3 L88 24 V52 C88 74 70 88 50 97 C30 88 12 74 12 52 V24 Z" },
  crest:  { label: "Crest",   d: "M14 5 H86 L94 14 V68 C94 83 74 92 50 96 C26 92 6 83 6 68 V14 Z" },
  arch:   { label: "Arch",    d: "M50 4 C74 4 92 21 92 45 V88 C92 92 89 96 84 96 H16 C11 96 8 92 8 88 V45 C8 21 26 4 50 4 Z" },
  banner: { label: "Banner",  d: "M8 8 H92 V78 L74 96 L50 82 L26 96 L8 78 Z" },
  diamond:{ label: "Diamond", d: "M50 3 L95 50 L50 97 L5 50 Z" },
};

export const PATTERNS = {
  solid:      "Solid",
  bars:       "Stripes",
  hoops:      "Hoops",
  halves:     "Halves",
  quarters:   "Quarters",
  sash:       "Sash",
  diagonals:  "Diagonals",
  chevrons:   "Chevrons",
  checks:     "Checks",
  pinstripes: "Pinstripes",
  pale:       "Pale",
  fess:       "Fess",
  rays:       "Rays",
  fade:       "Fade",
};

export const CHARGES = {
  none: "None", star: "Star", ball: "Ball", crown: "Crown",
  tower: "Tower", bolt: "Bolt", cross: "Cross", wreath: "Wreath",
};

/* ---------------------------------------------------------------------------
   COLOUR HELPERS
   ------------------------------------------------------------------------- */

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (n) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
  return `#${hex(0)}${hex(8)}${hex(4)}`;
}

export function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return [0, 0, 50];
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2; const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

/* Perceptual luminance — used to auto-pick legible text and to warn when a
   badge would disappear against the app's near-black background (#0b0c0f). */
export function luminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const readableOn = (hex) => (luminance(hex) > 0.42 ? "#0b0c0f" : "#ffffff");

/* ---------------------------------------------------------------------------
   DETERMINISTIC GENERATION
   The reason the whole feature is spec-based. Feed a club's existing seed in,
   get a stable badge out — no storage cost, and every AI club in the world
   has a crest without anyone drawing one.
   ------------------------------------------------------------------------- */

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUND_POOL = ["#16325c","#8a1220","#0f3d2e","#1a1a1f","#5a1246","#0d4a63","#7a3a0c","#2b2f6b","#3d1436","#0b5c3b"];
const TRIM_POOL   = ["#e2b53f","#f5f5f5","#101014","#c9d1d9","#e0632a","#7fd4c1"];

export function generateBadge({ seed, name = "Club", code = "CLB", year = 1900, colors }) {
  const rng = mulberry32(hashString(String(seed)));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const shape = pick(Object.keys(SHAPES));
  const ground = colors?.[0] || pick(GROUND_POOL);
  let trim = colors?.[1] || pick(TRIM_POOL);
  /* Never generate a trim that vanishes into its own ground. */
  if (Math.abs(luminance(trim) - luminance(ground)) < 0.12) trim = "#f5f5f5";
  return normaliseBadge({
    shape, ground, patColor: trim, border: trim,
    pat: pick(Object.keys(PATTERNS)),
    patCount: 3 + Math.floor(rng() * 5),
    borderW: 2 + rng() * 2,
    innerLine: rng() > 0.4,
    charge: pick(Object.keys(CHARGES)),
    chargeColor: readableOn(ground) === "#0b0c0f" ? "#101014" : "#f5f5f5",
    code: code.slice(0, 4).toUpperCase(),
    name: name.toUpperCase(),
    year,
    textColor: readableOn(ground),
    showName: rng() > 0.35,
    showYear: rng() > 0.5,
  });
}

/* ---------------------------------------------------------------------------
   2. THE RENDERER
   ------------------------------------------------------------------------- */

function starPath(points = 5, outer = 15, inner = 6.4) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += (i ? "L" : "M") + (Math.cos(a) * r).toFixed(2) + "," + (Math.sin(a) * r).toFixed(2);
  }
  return d + "Z";
}

function Charge({ type, color }) {
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

function PatternLayer({ spec, uid }) {
  const { pat, patColor, patCount } = spec;
  const n = Math.max(2, Math.min(12, patCount || 5));
  const rects = [];

  switch (pat) {
    case "bars":
    case "pinstripes": {
      const count = pat === "pinstripes" ? n * 2 : n;
      const w = 100 / count;
      for (let i = 0; i < count; i++) {
        if (i % 2) continue;
        const bw = pat === "pinstripes" ? w * 0.28 : w;
        rects.push(<rect key={i} x={i * w} y="0" width={bw} height="100" fill={patColor} />);
      }
      return <g>{rects}</g>;
    }
    case "hoops": {
      const h = 100 / n;
      for (let i = 0; i < n; i++) if (i % 2 === 0) rects.push(<rect key={i} x="0" y={i * h} width="100" height={h} fill={patColor} />);
      return <g>{rects}</g>;
    }
    case "halves":
      return <rect x="50" y="0" width="50" height="100" fill={patColor} />;
    case "quarters":
      return (<g><rect x="50" y="0" width="50" height="50" fill={patColor} /><rect x="0" y="50" width="50" height="50" fill={patColor} /></g>);
    case "pale":
      return <rect x="36" y="0" width="28" height="100" fill={patColor} />;
    case "fess":
      return <rect x="0" y="36" width="100" height="28" fill={patColor} />;
    case "sash":
      return <rect x="-40" y="38" width="180" height="24" fill={patColor} transform="rotate(-38 50 50)" />;
    case "diagonals": {
      const w = 140 / n;
      for (let i = 0; i < n * 2; i++) if (i % 2 === 0) rects.push(<rect key={i} x={-70 + i * w} y="-40" width={w} height="180" fill={patColor} />);
      return <g transform="rotate(-45 50 50)">{rects}</g>;
    }
    case "chevrons": {
      const step = 100 / n;
      for (let i = 0; i < n; i++) {
        const y = i * step * 1.4 - 20;
        rects.push(<path key={i} d={`M-10,${y + step * 0.7} L50,${y} L110,${y + step * 0.7} L110,${y + step * 1.1} L50,${y + step * 0.4} L-10,${y + step * 1.1} Z`} fill={patColor} />);
      }
      return <g>{rects}</g>;
    }
    case "rays": {
      const slices = n * 2;
      for (let i = 0; i < slices; i++) {
        if (i % 2) continue;
        const a1 = ((Math.PI * 2) / slices) * i, a2 = ((Math.PI * 2) / slices) * (i + 1);
        rects.push(<path key={i} d={`M50,50 L${50 + Math.cos(a1) * 90},${50 + Math.sin(a1) * 90} L${50 + Math.cos(a2) * 90},${50 + Math.sin(a2) * 90} Z`} fill={patColor} />);
      }
      return <g>{rects}</g>;
    }
    case "checks": {
      const s = 100 / n;
      return (
        <g>
          <defs>
            <pattern id={`chk-${uid}`} width={s * 2} height={s * 2} patternUnits="userSpaceOnUse">
              <rect x="0" y="0" width={s} height={s} fill={patColor} />
              <rect x={s} y={s} width={s} height={s} fill={patColor} />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill={`url(#chk-${uid})`} />
        </g>
      );
    }
    case "fade":
      return (
        <g>
          <defs>
            <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={patColor} stopOpacity="0.95" />
              <stop offset="100%" stopColor={patColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill={`url(#fade-${uid})`} />
        </g>
      );
    default:
      return null;
  }
}

/**
 * ClubBadge — the only thing in the game that draws a badge.
 *
 * @param spec   badge spec (see DEFAULT_BADGE)
 * @param size   rendered px. Drives level of detail automatically.
 * @param detail force "micro" | "small" | "full" (e.g. for an export at 512px)
 */
export function ClubBadge({ spec, size = 160, detail, title }) {
  const s = normaliseBadge(spec);
  /* useId is SSR-safe (Math.random() is NOT — it hydration-mismatches).
     Colons are stripped because url(#:r0:) is fragile in some browsers. */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const lod = detail || (size < 28 ? "micro" : size < 60 ? "small" : "full");
  const d = SHAPES[s.shape]?.d || SHAPES.shield.d;
  const hasCharge = s.charge !== "none" && lod !== "micro";
  const showCode = lod !== "micro" && s.code;
  const codeY = hasCharge ? 79 : 62;
  const codeSize = hasCharge ? 17 : 32;

  return (
    <svg
      viewBox="0 0 100 100" width={size} height={size}
      role="img" aria-label={title || `${s.name} club badge`}
      style={{ display: "block", overflow: "visible" }}
    >
      <clipPath id={`clip-${uid}`}><path d={d} /></clipPath>

      <g clipPath={`url(#clip-${uid})`}>
        <path d={d} fill={s.ground} />
        {lod !== "micro" || s.pat === "halves" || s.pat === "bars" ? (
          <PatternLayer spec={s} uid={uid} />
        ) : null}
      </g>

      {/* Inner line: the same path scaled about the centre. Works for every
          shape without authoring a second path per silhouette. */}
      {s.innerLine && lod === "full" && (
        <path d={d} fill="none" stroke={s.border} strokeWidth="1" opacity="0.8"
              transform="translate(50 50) scale(0.9) translate(-50 -50)" />
      )}

      {hasCharge && (
        <g transform={`translate(50 ${s.showName ? 48 : 44})`}>
          <Charge type={s.charge} color={s.chargeColor} />
        </g>
      )}

      {s.showName && lod === "full" && (
        <g>
          <path id={`arc-${uid}`} d="M20 34 A32 32 0 0 1 80 34" fill="none" />
          <text fill={s.textColor} fontSize="8" letterSpacing="1.1"
                fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif" fontWeight="600">
            <textPath href={`#arc-${uid}`} startOffset="50%" textAnchor="middle">
              {String(s.name).toUpperCase().slice(0, 22)}
            </textPath>
          </text>
        </g>
      )}

      {showCode && (
        <text x="50" y={codeY} textAnchor="middle" fill={s.textColor}
              fontSize={codeSize} fontWeight="700" letterSpacing="1.5"
              fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif">
          {String(s.code).toUpperCase().slice(0, 4)}
        </text>
      )}

      {s.showYear && lod === "full" && (
        <text x="50" y="89" textAnchor="middle" fill={s.textColor} fontSize="6.5"
              opacity="0.85" letterSpacing="1"
              fontFamily="'Saira Condensed','Oswald',system-ui,sans-serif">
          {s.year}
        </text>
      )}

      <path d={d} fill="none" stroke={s.border}
            strokeWidth={lod === "micro" ? Math.max(2.5, s.borderW) : s.borderW}
            strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   3. THE CREATOR UI
   ------------------------------------------------------------------------- */

const GOLD = "#e2b53f";
const INK = "#0b0c0f";
const PANEL = "#131519";
const LINE = "rgba(226,181,63,0.22)";
const MUTE = "#8b8f98";

function ColorWheel({ value, onChange }) {
  const ref = useRef(null);
  const [h, sat, light] = hexToHsl(value);

  const pointTo = useCallback((e) => {
    const r = ref.current.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const x = e.clientX - r.left - cx, y = e.clientY - r.top - cy;
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
    const radius = Math.min(1, Math.hypot(x, y) / cx);
    onChange(hslToHex(angle, Math.round(radius * 100), light));
  }, [onChange, light]);

  const markerA = ((h - 90) * Math.PI) / 180;
  const mx = 50 + Math.cos(markerA) * sat * 0.5;
  const my = 50 + Math.sin(markerA) * sat * 0.5;

  return (
    <div>
      <div
        ref={ref} className="fl-wheel"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pointTo(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) pointTo(e); }}
        style={{
          position: "relative", width: "100%", aspectRatio: "1", borderRadius: "50%",
          touchAction: "none", cursor: "crosshair",
          background:
            "radial-gradient(circle, #fff 0%, rgba(255,255,255,0) 72%)," +
            "conic-gradient(from 0deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)",
        }}
      >
        {/* Lightness is shown as a veil so the wheel matches the swatch */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none",
          background: light < 50 ? "#000" : "#fff",
          opacity: Math.abs(light - 50) / 50 * 0.85,
        }} />
        <div style={{
          position: "absolute", left: `${mx}%`, top: `${my}%`, width: 16, height: 16,
          marginLeft: -8, marginTop: -8, borderRadius: "50%", background: value,
          border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.6)", pointerEvents: "none",
        }} />
      </div>

      <label style={{ display: "block", marginTop: 12, fontSize: 10, letterSpacing: ".12em", color: MUTE }}>
        LIGHTNESS
      </label>
      <input
        type="range" min="4" max="96" value={light}
        onChange={(e) => onChange(hslToHex(h, sat, Number(e.target.value)))}
        style={{
          width: "100%", marginTop: 6, accentColor: GOLD,
          background: `linear-gradient(90deg,#000,${hslToHex(h, sat, 50)},#fff)`,
          height: 6, borderRadius: 3, appearance: "none", outline: "none",
        }}
      />
      <input
        value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        style={{
          width: "100%", marginTop: 10, background: INK, border: `1px solid ${LINE}`,
          color: "#e9eaee", padding: "8px 10px", fontSize: 13, letterSpacing: ".08em",
          fontVariantNumeric: "tabular-nums", borderRadius: 2, textTransform: "uppercase",
        }}
      />
    </div>
  );
}

function Section({ label, children, right }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{
          margin: 0, fontSize: 11, letterSpacing: ".18em", color: GOLD, fontWeight: 700,
          fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif",
        }}>{label}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children, title }) {
  return (
    <button className="fl-chip" onClick={onClick} title={title} style={{
      background: active ? "rgba(226,181,63,.14)" : "transparent",
      border: `1px solid ${active ? GOLD : "rgba(255,255,255,.1)"}`,
      color: active ? GOLD : "#c6c9d0", padding: "7px 10px", fontSize: 11,
      letterSpacing: ".08em", cursor: "pointer", borderRadius: 2, textTransform: "uppercase",
      fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif", fontWeight: 600,
    }}>{children}</button>
  );
}

export default function BadgeCreator() {
  const [spec, setSpec] = useState(DEFAULT_BADGE);
  const [target, setTarget] = useState("ground");
  const set = (patch) => setSpec((prev) => ({ ...prev, ...patch }));

  const dark = luminance(spec.ground) < 0.045 && luminance(spec.border) < 0.06;

  const shapeChips = useMemo(() => Object.entries(SHAPES), []);
  const patternChips = useMemo(() => Object.entries(PATTERNS), []);

  const json = JSON.stringify(spec);

  return (
    <div style={{
      background: INK, color: "#e9eaee", minHeight: "100%", padding: "20px",
      fontFamily: "'Instrument Sans',system-ui,-apple-system,sans-serif",
    }}>
      <style>{`
        .fl-chip:hover { border-color: ${GOLD} !important; color: ${GOLD} !important; }
        .fl-grid { display: grid; grid-template-columns: 1fr; gap: 22px; }
        @media (min-width: 860px) { .fl-grid { grid-template-columns: 320px 1fr; } }
        .fl-wheel:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 3px; }
        input[type=range]::-webkit-slider-thumb {
          appearance: none; width: 14px; height: 14px; border-radius: 50%;
          background: ${GOLD}; cursor: pointer; border: 2px solid ${INK};
        }
      `}</style>

      <header style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 22 }}>
        <h1 style={{
          margin: 0, fontSize: 22, letterSpacing: ".16em", fontWeight: 700, textTransform: "uppercase",
          fontFamily: "'Saira Condensed','Oswald',system-ui,sans-serif",
          background: `linear-gradient(90deg, ${GOLD}, #f6e0a0)`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>Badge Creator</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTE }}>
          Everything here edits one small object. That object is what the save stores.
        </p>
      </header>

      <div className="fl-grid">
        {/* ---------- PREVIEW ---------- */}
        <div>
          <div style={{
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 3,
            padding: 24, display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <ClubBadge spec={spec} size={200} />
            <div style={{ height: 1, width: "100%", background: LINE, margin: "22px 0 16px" }} />
            <div style={{ fontSize: 10, letterSpacing: ".14em", color: MUTE, marginBottom: 12 }}>
              AS THE GAME DRAWS IT
            </div>
            <div style={{ display: "flex", gap: 18, alignItems: "flex-end" }}>
              {[18, 26, 40, 64].map((px) => (
                <div key={px} style={{ textAlign: "center" }}>
                  <ClubBadge spec={spec} size={px} />
                  <div style={{ fontSize: 9, color: MUTE, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{px}px</div>
                </div>
              ))}
            </div>
          </div>

          {dark && (
            <p style={{
              marginTop: 12, fontSize: 12, color: "#e0a04a", background: "rgba(224,160,74,.08)",
              border: "1px solid rgba(224,160,74,.3)", padding: "10px 12px", borderRadius: 2,
            }}>
              This badge is nearly invisible on the app's background. Lighten the trim or the ground.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Chip onClick={() => setSpec(generateBadge({
              seed: Math.random(), name: spec.name, code: spec.code, year: spec.year,
            }))}>Surprise me</Chip>
            <Chip onClick={() => setSpec(DEFAULT_BADGE)}>Reset</Chip>
            <Chip onClick={() => navigator.clipboard?.writeText(json)}>Copy spec</Chip>
          </div>

          <pre style={{
            marginTop: 12, background: PANEL, border: `1px solid ${LINE}`, padding: 12,
            fontSize: 10.5, color: MUTE, overflowX: "auto", borderRadius: 2, lineHeight: 1.6,
          }}>{json}</pre>
          <p style={{ fontSize: 11, color: MUTE, marginTop: 6 }}>
            {new Blob([json]).size} bytes. Shorten the keys and it's under 90.
          </p>
        </div>

        {/* ---------- CONTROLS ---------- */}
        <div>
          <Section label="Shape">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: 8 }}>
              {shapeChips.map(([key, sh]) => (
                <button key={key} className="fl-chip" onClick={() => set({ shape: key })} title={sh.label}
                  style={{
                    background: spec.shape === key ? "rgba(226,181,63,.12)" : "transparent",
                    border: `1px solid ${spec.shape === key ? GOLD : "rgba(255,255,255,.08)"}`,
                    borderRadius: 2, padding: "8px 4px", cursor: "pointer", color: MUTE,
                  }}>
                  <svg viewBox="0 0 100 100" width="34" height="34" style={{ display: "block", margin: "0 auto" }}>
                    <path d={sh.d} fill={spec.shape === key ? GOLD : "#3a3e46"} />
                  </svg>
                  <span style={{ fontSize: 9, letterSpacing: ".08em", display: "block", marginTop: 5, textTransform: "uppercase" }}>
                    {sh.label}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section label="Pattern" right={
            <span style={{ fontSize: 11, color: MUTE, fontVariantNumeric: "tabular-nums" }}>
              {spec.patCount} bands
            </span>
          }>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(58px,1fr))", gap: 8 }}>
              {patternChips.map(([key, label]) => (
                <button key={key} className="fl-chip" onClick={() => set({ pat: key })} title={label}
                  style={{
                    background: "transparent", padding: 4, cursor: "pointer", color: MUTE,
                    border: `1px solid ${spec.pat === key ? GOLD : "rgba(255,255,255,.08)"}`, borderRadius: 2,
                  }}>
                  {/* The picker renders through the real component, so a swatch
                      can never show something the game won't draw. */}
                  <ClubBadge
                    size={40} detail="small"
                    spec={{ ...spec, pat: key, charge: "none", code: "", showName: false, showYear: false }}
                  />
                  <span style={{ fontSize: 8.5, letterSpacing: ".06em", display: "block", marginTop: 4, textTransform: "uppercase" }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <input type="range" min="2" max="12" value={spec.patCount}
              onChange={(e) => set({ patCount: Number(e.target.value) })}
              style={{ width: "100%", marginTop: 14, accentColor: GOLD, height: 6, appearance: "none", background: "#23262c", borderRadius: 3 }} />
          </Section>

          <Section label="Colours">
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {[["ground", "Ground"], ["patColor", "Pattern"], ["border", "Trim"], ["chargeColor", "Emblem"], ["textColor", "Text"]].map(([k, l]) => (
                <button key={k} className="fl-chip" onClick={() => setTarget(k)} style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", cursor: "pointer",
                  background: target === k ? "rgba(226,181,63,.12)" : "transparent",
                  border: `1px solid ${target === k ? GOLD : "rgba(255,255,255,.1)"}`,
                  borderRadius: 2, color: target === k ? GOLD : "#c6c9d0",
                  fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
                }}>
                  <span style={{ width: 13, height: 13, background: spec[k], border: "1px solid rgba(255,255,255,.25)", borderRadius: 2 }} />
                  {l}
                </button>
              ))}
            </div>
            <div style={{ maxWidth: 240 }}>
              <ColorWheel value={spec[target]} onChange={(hex) => set({ [target]: hex })} />
            </div>
            <button className="fl-chip" onClick={() => set({ textColor: readableOn(spec.ground), chargeColor: readableOn(spec.ground) })}
              style={{
                marginTop: 12, background: "transparent", border: `1px solid rgba(255,255,255,.1)`,
                color: "#c6c9d0", padding: "7px 10px", fontSize: 10.5, letterSpacing: ".08em",
                cursor: "pointer", borderRadius: 2, textTransform: "uppercase",
              }}>
              Auto-contrast text
            </button>
          </Section>

          <Section label="Emblem">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(CHARGES).map(([k, l]) => (
                <Chip key={k} active={spec.charge === k} onClick={() => set({ charge: k })}>{l}</Chip>
              ))}
            </div>
          </Section>

          <Section label="Lettering">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["code", "Short code", 4], ["year", "Founded", 4], ["name", "Club name", 22]].map(([k, l, max]) => (
                <label key={k} style={{ fontSize: 10, letterSpacing: ".12em", color: MUTE, textTransform: "uppercase", gridColumn: k === "name" ? "1 / -1" : "auto" }}>
                  {l}
                  <input value={spec[k]} maxLength={max}
                    onChange={(e) => set({ [k]: k === "year" ? e.target.value.replace(/\D/g, "") : e.target.value })}
                    style={{
                      display: "block", width: "100%", marginTop: 5, background: PANEL,
                      border: `1px solid ${LINE}`, color: "#e9eaee", padding: "8px 10px",
                      fontSize: 13, borderRadius: 2, letterSpacing: ".06em",
                    }} />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Chip active={spec.showName} onClick={() => set({ showName: !spec.showName })}>Name arc</Chip>
              <Chip active={spec.showYear} onClick={() => set({ showYear: !spec.showYear })}>Year</Chip>
              <Chip active={spec.innerLine} onClick={() => set({ innerLine: !spec.innerLine })}>Inner line</Chip>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
