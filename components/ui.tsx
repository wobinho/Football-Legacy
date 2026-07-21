"use client";

// Shared UI primitives — the design system in miniature.

import { useEffect, useState } from "react";
import { formatMoney, groupDigits, parseMoney } from "@/lib/value";
import type { GameState, PlayerBio, Pos } from "@/lib/types";
import { posColors, resolvePos } from "@/lib/config/positions";
import { flagForNat, flagForCountry } from "@/lib/config/flags";
import { potentialView } from "@/lib/academy";
import { TRAIT_MAP } from "@/lib/config/traits";
import { TUNING } from "@/lib/config/tuning";

/** Section header with the signature gold thread. */
export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-1 flex items-end justify-between">
        <h2 className="display text-lg font-semibold text-ink">{title}</h2>
        {right}
      </div>
      <div className="gold-thread mb-3 w-full" />
      {children}
    </section>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`rounded-md border border-line bg-surface ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Overall rating in the condensed display face — tier-colored. */
export function Ovr({
  value,
  size = "md",
  growth,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  /** This season's overall change (v19). Rendered as a small +X/-X beside the
   * rating so a player's trajectory reads at a glance. Pass the player through
   * `seasonGrowth()` rather than computing a delta by hand. */
  growth?: number;
}) {
  const color =
    value >= 80 ? "gold-text" : value >= 72 ? "text-ink" : value >= 62 ? "text-dim" : "text-faint";
  const sz = size === "lg" ? "text-4xl" : size === "sm" ? "text-base" : "text-xl";
  const rating = <span className={`display font-bold tnum ${sz} ${color}`}>{value}</span>;
  if (!growth) return rating;
  return (
    <span className="inline-flex items-baseline gap-1">
      {rating}
      <GrowthBadge delta={growth} size={size} />
    </span>
  );
}

/**
 * A player's overall change so far this season (v19).
 *
 * Green for improvement, red for decline — deliberately understated so it reads
 * as an annotation on the rating rather than competing with it. Nothing is shown
 * for an unchanged player: a wall of "+0" is noise.
 */
export function GrowthBadge({ delta, size = "md" }: { delta: number; size?: "sm" | "md" | "lg" }) {
  if (!delta) return null;
  const up = delta > 0;
  const sz = size === "lg" ? "text-sm" : size === "sm" ? "text-[9px]" : "text-[10px]";
  return (
    <span
      className={`display font-bold tnum ${sz} ${up ? "text-win" : "text-loss"}`}
      title={`${up ? "Gained" : "Lost"} ${Math.abs(delta)} overall this season`}
    >
      {up ? "+" : "−"}
      {Math.abs(delta)}
    </span>
  );
}

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tnum ${className}`}>{formatMoney(value)}</span>;
}

/** An editable money field. Shows the amount as grouped digits ("54,000,000")
 * so a big figure stays legible, and accepts shorthand while typing — "54m",
 * "500k", or plain/grouped digits — parsing back to a number on the fly. */
export function MoneyInput({
  value,
  onChange,
  className = "",
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  // Keep raw keystrokes while focused so mid-edit text (a trailing "m", a
  // half-typed number) isn't clobbered by re-grouping; snap to the canonical
  // grouped form on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? groupDigits(value);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseMoney(e.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
      className={className}
      {...rest}
    />
  );
}

/** Fitness/condition as a compact bar, optionally with the numeric % beside it. */
export function FitnessBar({ value, showValue = false }: { value: number; showValue?: boolean }) {
  const color = value >= 80 ? "bg-win" : value >= 55 ? "bg-gold" : "bg-loss";
  const textColor = value >= 80 ? "text-win" : value >= 55 ? "text-gold" : "text-loss";
  const bar = (
    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line" title={`Condition ${Math.round(value)}%`}>
      <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
  if (!showValue) return bar;
  return (
    <span className="inline-flex items-center gap-2">
      {bar}
      <span className={`tnum text-xs font-semibold ${textColor}`}>{Math.round(value)}%</span>
    </span>
  );
}

/** Form as a small arrow trio. */
export function FormChip({ form }: { form: number }) {
  const pct = Math.round((form - 1) * 100);
  const label = pct > 1 ? `+${pct}%` : pct < -1 ? `${pct}%` : "—";
  const color = pct > 1 ? "text-win" : pct < -1 ? "text-loss" : "text-faint";
  return <span className={`tnum text-xs ${color}`} title="Form">{label}</span>;
}

/** Club identity chip: initials on club colors. */
export function Crest({ colors, short, size = 24 }: { colors: [string, string]; short: string; size?: number }) {
  return (
    <span
      className="display inline-flex shrink-0 items-center justify-center rounded-sm font-bold"
      style={{
        width: size,
        height: size,
        background: colors[0],
        color: colors[1],
        fontSize: size * 0.38,
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {short}
    </span>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="text-gold" aria-label={`${n} stars`}>
      {"★".repeat(n)}
      <span className="text-line">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/** Potential star range (§18 fog-of-war): solid gold up to the low estimate,
 * faded gold across the uncertainty band, empty beyond. Half-star precision. */
export function StarRange({ lo, hi, className = "" }: { lo: number; hi: number; className?: string }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / 5) * 100))}%`;
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  const title = lo === hi ? `${fmt(lo)}★ potential` : `${fmt(lo)}–${fmt(hi)}★ potential (scout estimate)`;
  return (
    <span className={`relative inline-block whitespace-nowrap leading-none ${className}`} title={title}>
      <span className="text-line">★★★★★</span>
      <span className="absolute inset-y-0 left-0 overflow-hidden text-gold-lo/50" style={{ width: pct(hi) }}>
        ★★★★★
      </span>
      <span className="absolute inset-y-0 left-0 overflow-hidden text-gold" style={{ width: pct(lo) }}>
        ★★★★★
      </span>
    </span>
  );
}

/** Potential readout honoring the §18 fog: exact number past the growth age,
 * a star range while the player is still an unknown. */
export function PotentialBadge({ game, p, className = "" }: { game: GameState; p: PlayerBio; className?: string }) {
  const v = potentialView(game, p, TUNING);
  if (v.exact !== null) {
    return <span className={`display tnum font-bold ${v.exact > p.overall ? "text-win" : "text-faint"} ${className}`}>{v.exact}</span>;
  }
  return <StarRange lo={v.loStars} hi={v.hiStars} className={className} />;
}

/** Position badge, color-coded per position (shades within GK/DEF/MID/ATT). */
export function PosBadge({ pos }: { pos: Pos | string }) {
  const c = posColors(resolvePos(pos));
  return (
    <span
      className="display inline-block min-w-8 rounded-sm px-1 text-center text-[11px] font-bold"
      style={{ background: c.bg, color: c.fg }}
      title={c.label}
    >
      {pos}
    </span>
  );
}

/** Nationality flag (from a 3-letter code) as a small rounded chip. */
export function Flag({ nat, size = 16, className = "" }: { nat: string; size?: number; className?: string }) {
  const src = flagForNat(nat);
  if (!src) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[2px] border border-line bg-raised text-[8px] font-semibold text-faint ${className}`}
        style={{ width: size * 1.4, height: size }}
        title={nat}
      >
        {nat}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={nat}
      title={nat}
      width={size * 1.4}
      height={size}
      className={`inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-black/30 ${className}`}
      style={{ width: size * 1.4, height: size }}
    />
  );
}

/** Country flag (from a full country name) — used for teams/leagues. */
export function CountryFlag({ country, size = 16, className = "" }: { country: string; size?: number; className?: string }) {
  const src = flagForCountry(country);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={country}
      title={country}
      width={size * 1.4}
      height={size}
      className={`inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-black/30 ${className}`}
      style={{ width: size * 1.4, height: size }}
    />
  );
}

/**
 * Archetype icon slot. Real art will live in /assets/archetypes (currently
 * empty), keyed by archetype id. Until then we render a placeholder ring so the
 * layout, spacing, and "icon before name" pattern are already in place.
 */
export function ArchetypeIcon({ archetypeId, size = 14 }: { archetypeId?: string; size?: number }) {
  void archetypeId; // reserved for keyed art once assets ship
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-gold-lo/60 bg-raised"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="rounded-full bg-gold-lo/50" style={{ width: size * 0.4, height: size * 0.4 }} />
    </span>
  );
}

/**
 * The one canonical "upgrade" container, shared by every upgrade surface —
 * Club → Income, Development → Facilities, and Academy → Upgrades — so they all
 * read as the same object. An optional `accent` hex tints the left border, icon
 * chip and level pips; without it the card uses the neutral gold treatment.
 *
 * Layout (uniform across pages): title + level header, an icon chip beside the
 * blurb with level pips, a current / after-upgrade / cost row, then a footer
 * note and the UPGRADE (or MAX) action.
 */
export function UpgradeCard({
  title,
  icon,
  level,
  maxLevel,
  blurb,
  accent,
  effectNow,
  effectNext,
  cost,
  maxed,
  canAfford,
  note,
  onUpgrade,
}: {
  title: string;
  icon: string;
  level: number;
  maxLevel: number;
  blurb: string;
  accent?: string;
  effectNow: React.ReactNode;
  effectNext: React.ReactNode;
  cost: React.ReactNode;
  maxed: boolean;
  canAfford: boolean;
  note?: React.ReactNode;
  onUpgrade: () => void;
}) {
  const pipOn = accent ?? "var(--color-gold-hi)";
  return (
    <section>
      <div className="mb-1 flex items-end justify-between">
        <h2 className="display text-lg font-semibold" style={accent ? { color: accent } : undefined}>
          {title}
        </h2>
        <span className="text-xs text-faint tnum">
          Level {level} / {maxLevel}
        </span>
      </div>
      <div className="gold-thread mb-3 w-full" />
      <Card
        className="p-4"
        style={
          accent
            ? {
                // Accent rings the WHOLE container (v15) rather than tinting one
                // edge, so an upgrade card reads as a single bounded module.
                border: `1px solid ${accent}`,
                boxShadow: `0 0 0 1px ${accent}26, 0 1px 12px -6px ${accent}66`,
                background: `linear-gradient(160deg, ${accent}12, transparent 55%)`,
              }
            : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-2xl"
            style={accent ? { borderColor: `${accent}80`, background: `${accent}14` } : { borderColor: "var(--color-line)", background: "var(--color-raised)" }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-relaxed text-dim">{blurb}</p>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: maxLevel }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < level ? (accent ? "" : "gold-grad") : "bg-line"}`}
                  style={accent && i < level ? { background: pipOn } : undefined}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line/60 pt-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Current effect</div>
            <div className="display font-semibold text-win">{effectNow}</div>
          </div>
          {!maxed && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-faint">After upgrade</div>
              <div className="display font-semibold text-win">{effectNext}</div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Upgrade cost</div>
            <div className="display tnum font-semibold">{maxed ? "—" : cost}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-faint">{note}</span>
          {maxed ? (
            <span className="display rounded-md border border-gold-lo/50 px-3 py-1.5 text-xs font-semibold text-gold">MAX</span>
          ) : (
            <GoldButton onClick={onUpgrade} disabled={!canAfford} className="!py-1.5 text-xs">
              UPGRADE
            </GoldButton>
          )}
        </div>
      </Card>
    </section>
  );
}

/** Primary action — the one gold object on screen. */
export function GoldButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`gold-grad display rounded-md px-5 py-2 text-sm font-bold tracking-wider text-[#14120a] transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-line bg-raised px-4 py-2 text-sm text-ink transition-colors hover:border-faint hover:bg-hover disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A two-step confirm button (no modal). First click arms it — the label swaps to
 * a confirm prompt and the button turns gold; a second click within a few seconds
 * commits. Clicking away / waiting resets it. Used for hiring and firing staff so
 * a decision always takes a deliberate second tap.
 */
export function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
  onConfirm,
  disabled,
  className = "",
  tone = "neutral",
}: {
  label: React.ReactNode;
  confirmLabel?: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  tone?: "neutral" | "danger";
}) {
  const [armed, setArmed] = useState(false);
  const idleCls =
    tone === "danger"
      ? "border-line bg-raised text-dim hover:border-loss/50 hover:text-loss"
      : "border-line bg-raised text-ink hover:border-faint hover:bg-hover";
  // Armed danger is a SOLID red fill, not a tint: an armed destructive button
  // has to be unmistakable at a glance, since the next click is irreversible.
  const armedCls =
    tone === "danger"
      ? "border-loss bg-loss text-white"
      : "gold-grad border-transparent text-black";
  return (
    <button
      onClick={() => {
        if (disabled) return;
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3000);
        }
      }}
      onBlur={() => setArmed(false)}
      disabled={disabled}
      className={`rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${armed ? armedCls : idleCls} ${className}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** "lg" is for content that carries a data table — a league table at the
   * default width wraps into unreadability. */
  size?: "md" | "lg";
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className={`max-h-[85vh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-2xl ${
          size === "lg" ? "max-w-3xl" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="display text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="px-2 text-dim hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="gold-thread mb-4" />
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`display relative px-3 py-2 text-sm font-semibold tracking-wide transition-colors ${
            active === t.id ? "text-ink" : "text-faint hover:text-dim"
          }`}
        >
          {t.label}
          {t.badge ? (
            <span className="ml-1.5 rounded-full bg-gold px-1.5 text-[10px] font-bold text-black">{t.badge}</span>
          ) : null}
          {active === t.id && <div className="gold-grad absolute inset-x-2 bottom-0 h-0.5" />}
        </button>
      ))}
    </div>
  );
}

/** Six-attribute readout; GK slots get keeper-flavored labels. */
export function AttrGrid({ p }: { p: PlayerBio }) {
  const isGk = p.positions[0] === "GK";
  const labels: [string, number][] = isGk
    ? [
        ["DIV", p.attrs.def],
        ["HAN", p.attrs.phy],
        ["KIC", p.attrs.pas],
        ["REF", p.attrs.sho],
        ["SPD", p.attrs.pac],
        ["POS", p.attrs.dri],
      ]
    : [
        ["PAC", p.attrs.pac],
        ["SHO", p.attrs.sho],
        ["PAS", p.attrs.pas],
        ["DRI", p.attrs.dri],
        ["DEF", p.attrs.def],
        ["PHY", p.attrs.phy],
      ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {labels.map(([label, v]) => (
        <div key={label} className="rounded-md border border-line bg-raised p-2 text-center">
          <div className="display text-[10px] font-semibold tracking-widest text-faint">{label}</div>
          <div className={`display tnum text-xl font-bold ${v >= 80 ? "gold-text" : v >= 70 ? "text-ink" : "text-dim"}`}>
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A trait chip with a styled hover tooltip that spells out the *actual* in-game
 * effect (each `influence` line) rather than flavour text. Reused on the player
 * profile, the squad list, and the tactics lineup. Unknown ids render inert. */
export function TraitChip({ id, size = "sm" }: { id: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const trait = TRAIT_MAP[id];
  if (!trait) return null;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className={`display inline-flex items-center gap-1 rounded-sm border border-gold-lo/40 bg-raised font-semibold text-gold transition-colors hover:border-gold-lo ${pad}`}
      >
        <span className="text-[9px] leading-none">◆</span>
        {trait.name}
      </span>
      {open && (
        <span className="absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-left shadow-2xl">
          <span className="display block text-sm font-bold text-ink">{trait.name}</span>
          <span className="gold-thread my-1.5 block" />
          <span className="block text-[12px] leading-relaxed text-dim">{trait.desc}</span>
          <span className="mt-2 block space-y-1">
            {trait.influence.map((inf, i) => (
              <span key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-faint">{inf.label}</span>
                <span className="tnum text-right font-semibold text-gold">{inf.detail}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

// ── List / grid view toggle (v25) ──────────────────────────────────────────
// Every screen that lists players offers the same choice between a dense list
// (the default) and a card grid. The preference is per-screen and remembered
// across sessions, so a manager who prefers cards on the Squad keeps them there
// without forcing the same on Transfers.

export type PlayerView = "list" | "grid";

/**
 * Per-screen list/grid preference, persisted to localStorage under `fl.view.<key>`.
 * Defaults to "list" — the established, information-dense layout — and only
 * upgrades to a stored value after mount so server and first client render agree
 * (no hydration mismatch).
 */
export function usePlayerView(key: string): [PlayerView, (v: PlayerView) => void] {
  const storageKey = `fl.view.${key}`;
  const [view, setView] = useState<PlayerView>("list");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {
      // localStorage unavailable (private mode / SSR) — the default stands.
    }
  }, [storageKey]);
  const set = (v: PlayerView) => {
    setView(v);
    try {
      window.localStorage.setItem(storageKey, v);
    } catch {
      // ignore — the in-memory choice still applies for this session.
    }
  };
  return [view, set];
}

/** The segmented list/grid control. Sits in a Section's `right` slot or beside a
 * screen's own filters; the active side wears the gold treatment. */
export function ViewToggle({ view, onChange }: { view: PlayerView; onChange: (v: PlayerView) => void }) {
  const opts: { id: PlayerView; label: string; icon: React.ReactNode }[] = [
    {
      id: "list",
      label: "List view",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "grid",
      label: "Grid view",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
  ];
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="View mode">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={view === o.id}
          title={o.label}
          className={`flex items-center justify-center px-2 py-1 transition-colors ${
            view === o.id ? "gold-grad text-black" : "bg-raised text-faint hover:text-dim"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </span>
  );
}

/** The responsive card-grid container for grid view. Auto-fills columns so cards
 * stay a comfortable width from phone to wide desktop. */
export function PlayerGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))] ${className}`}
    >
      {children}
    </div>
  );
}

/** One player as a card in grid view. Shared shell — the header (pos badge,
 * flag, name, age) and the OVR line are common; each screen supplies its own
 * `sub` (archetype / club line), `badges`, `stats` and `actions` so the card
 * carries the same information its list row would. Clicking the card body opens
 * the player unless the click lands on an interactive control. */
export function PlayerCard({
  p,
  onOpen,
  ovr,
  sub,
  badges,
  stats,
  actions,
}: {
  p: PlayerBio;
  onOpen?: () => void;
  /** OVR readout — screens pass their own <Ovr>/<PotentialBadge> so growth and
   * fog-of-war treatments match the list. */
  ovr?: React.ReactNode;
  sub?: React.ReactNode;
  badges?: React.ReactNode;
  stats?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="group flex flex-col rounded-md border border-line bg-surface p-3 transition-colors hover:border-faint">
      <div className="flex items-start gap-2">
        <PosBadge pos={p.positions[0]} />
        <button
          onClick={onOpen}
          disabled={!onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-1.5">
            <Flag nat={p.nationality} size={12} />
            <span className={`truncate font-semibold ${onOpen ? "transition-colors group-hover:text-gold" : ""}`}>
              {p.name}
            </span>
            <span className="ml-auto shrink-0 tnum text-[11px] text-faint">{p.age}y</span>
          </span>
          {sub && <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-faint">{sub}</span>}
        </button>
      </div>

      {badges && <div className="mt-2 flex flex-wrap items-center gap-1">{badges}</div>}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/60 pt-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-dim">{stats}</div>
        {ovr && <div className="shrink-0">{ovr}</div>}
      </div>

      {actions && <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** A styled player picker (button + popover) that shows a flag + position tag +
 * name — used where a native <select> can't render components (tactics
 * assignments, set-piece takers). Roles are independent, so no cross-clearing. */
export function PlayerSelect({
  players,
  value,
  onChange,
  placeholder = "— none —",
}: {
  players: PlayerBio[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? players.find((p) => p.id === value) ?? null : null;
  return (
    <span className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-line bg-raised px-2 py-1.5 text-left text-sm hover:border-faint"
      >
        {current ? (
          <>
            <Flag nat={current.nationality} size={11} />
            <PosBadge pos={current.positions[0]} />
            <span className="min-w-0 flex-1 truncate">{current.name}</span>
          </>
        ) : (
          <span className="flex-1 text-faint">{placeholder}</span>
        )}
        <span className={`shrink-0 text-xs text-dim transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-52 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-faint hover:bg-hover"
            >
              {placeholder}
            </button>
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover ${
                  p.id === value ? "bg-hover" : ""
                }`}
              >
                <Flag nat={p.nationality} size={11} />
                <PosBadge pos={p.positions[0]} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <Ovr value={p.overall} size="sm" />
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
