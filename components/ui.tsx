"use client";

// Shared UI primitives — the design system in miniature.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney, groupDigits, parseMoney } from "@/lib/value";
import type { Attributes, BadgeTier, FacilityId, GameState, PlayerBio, Pos } from "@/lib/types";
import { BADGE_COLOR, badgeIconSrc, facilityHeaderSrc } from "@/lib/config/facilities";
import { keyAttrsFor, overallFromAttrs, posColors, resolvePos } from "@/lib/config/positions";
import { shapeAttrsToArchetype } from "@/lib/config/archetype";
import {
  aggregateAttrs,
  attrGroupsFor,
  ATTR_FAMILY_LABELS,
  ATTR_FAMILY_ORDER,
  ATTR_GROUP_LABELS,
  ATTR_META,
  ATTRS_BY_GROUP,
  GK_FAMILY_LABELS,
  uniformAttrs,
  type AttrKey,
} from "@/lib/config/attributes";
import {
  deriveArchetype,
  archetypeIconSrc,
  ARCHETYPE_CLASS_BLURB,
  ARCHETYPE_CLASS_COLOR,
  type Archetype,
  type ArchetypeClass,
} from "@/lib/config/archetype";
import { flagForNat, flagForCountry, nameForNat } from "@/lib/config/flags";
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
  showCurrency = false,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  /** Render a permanent £ inside the field (v1.74). Off by default so the
   * existing bare inputs are unchanged; on where the field is unambiguously a
   * money box and the symbol removes a guess. Named `showCurrency` rather than
   * `prefix` because the latter collides with the native input attribute. */
  showCurrency?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "prefix">) {
  // Keep raw keystrokes while focused so mid-edit text (a trailing "m", a
  // half-typed number) isn't clobbered by re-grouping; snap to the canonical
  // grouped form on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? groupDigits(value);
  const input = (
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
      className={showCurrency ? `${className} pl-7` : className}
      {...rest}
    />
  );
  if (!showCurrency) return input;
  // The symbol is decoration over a real input rather than part of the value —
  // keeping it out of the string is what lets `parseMoney` stay strict.
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-dim">£</span>
      {input}
    </span>
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
        // Fixed, box-sized square so the crest is exactly `size`×`size`
        // regardless of the flex/grid row it sits in — a taller sibling (e.g. a
        // two-line league label) must never stretch or shrink the badge.
        flex: "0 0 auto",
        boxSizing: "border-box",
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        lineHeight: 1,
        overflow: "hidden",
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

/** Potential readout honoring the §18 fog. Always a star bar (never a bare
 * number): a fogged prospect shows the scout's low–high band, and a settled
 * player (age ≥ growth end) shows a solid bar where lo === hi. Keeping stars in
 * both cases means the modal never falls back to a raw potential integer. */
export function PotentialBadge({ game, p, className = "" }: { game: GameState; p: PlayerBio; className?: string }) {
  const v = potentialView(game, p, TUNING);
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

/**
 * A player's name at full length (v27) — "Gianluigi Donnarumma" where a list row
 * shows "G. Donnarumma".
 *
 * Only the real-world databases author a separate full name; generated players
 * and old saves carry one name only, so this falls back to `name` and the two
 * read identically.
 *
 * This is the DEFAULT (v1.63): a player should be called by his whole name
 * wherever the layout can hold it — profile headers, cards, squad and list rows,
 * pickers. Reach for the short `p.name` only where the space genuinely won't
 * take it: the pitch tokens on the tactics board, match commentary lines, and
 * fixed-width table columns that would otherwise truncate mid-name.
 */
export function displayFullName(p: Pick<PlayerBio, "name" | "fullName">): string {
  const full = p.fullName?.trim();
  return full ? full : p.name;
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
 * Nationality picker (v1.52) — a country list that reads as countries.
 *
 * A native <select> can't render an image inside an <option>, so the create-a-
 * player and database-editor pickers used to offer a wall of bare 3-letter codes
 * ("KVX", "CTA") that only the database author could decode. This is the
 * replacement: a button showing the flag and full name, opening a searchable
 * list of the same. The value is still the code — only the presentation changes,
 * so every caller and every stored player record is untouched.
 *
 * Search matches the name OR the code, so a manager who knows "BRA" is as fast
 * as one who types "Brazil".
 */
export function NationalityPicker({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: string[];
  onChange: (nat: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sorted by display name so the list reads alphabetically as a human sees it
  // ("Ivory Coast" under I), not by the code's spelling (CIV under C).
  const sorted = useMemo(
    () => options.map((code) => ({ code, name: nameForNat(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [options]
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
  }, [sorted, query]);

  useEffect(() => {
    if (!open) return;
    // Focus the search box so typing filters immediately.
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-line bg-raised px-2 py-2 text-left text-sm text-ink transition-colors hover:border-faint focus:border-gold focus:outline-none"
      >
        <Flag nat={value} size={13} />
        <span className="min-w-0 flex-1 truncate">{nameForNat(value)}</span>
        <span className="shrink-0 text-[10px] text-faint">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-line bg-surface shadow-xl">
          <div className="border-b border-line/60 p-1.5">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country…"
              className="w-full rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus:border-gold-lo/60"
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-3 py-3 text-xs text-faint">No country matches that.</div>}
            {shown.map((o) => (
              <button
                type="button"
                key={o.code}
                role="option"
                aria-selected={o.code === value}
                onClick={() => pick(o.code)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors ${
                  o.code === value ? "bg-hover text-gold" : "text-dim hover:bg-raised hover:text-ink"
                }`}
              >
                <Flag nat={o.code} size={12} />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="display shrink-0 text-[10px] tracking-widest text-faint">{o.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The archetype a player has earned, for display (§2, v1.73).
 *
 * The single place the UI reads identity from, so every surface — squad list,
 * transfer row, academy card, profile modal — names the player the same thing.
 * Archetypes are a derived view: nothing is stored, this reads his current
 * attribute line every time, which is what makes retraining visibly change who
 * he is.
 *
 * Memoised on the attribute line and position, since the ranking runs over all
 * 35 attributes × 5 plans and squad tables render it a few hundred times.
 *
 * Falls back to `undefined` for a player with no attribute sheet (a scouted
 * preview whose attributes are still hidden), and callers show the archetype in
 * that case — what he was made to be, when what he has become isn't yet known.
 */
export function useArchetype(p: { attrs?: Attributes; positions: Pos[] }): Archetype | undefined {
  const attrs = p.attrs;
  const pos = p.positions[0];
  return useMemo(() => (attrs ? deriveArchetype(attrs, pos) : undefined), [attrs, pos]);
}

/**
 * Archetype name for a non-hook context (table cell renderers, `sub` props).
 *
 * Same derivation as `useArchetype` without the memo — call it in a loop only
 * where the list is short, or prefer the hook.
 */
export function archetypeName(p: { attrs?: Attributes; positions: Pos[] }): string | undefined {
  return p.attrs ? deriveArchetype(p.attrs, p.positions[0])?.name : undefined;
}

/**
 * An archetype's icon — the picture form of an earned identity (v1.75).
 *
 * The art is the fastest way to read a squad list: a manager learns the Sniper
 * mark long before he reads 45 role names, and unlike the class dot it
 * identifies the exact archetype rather than its family. The class colour stays on
 * the ring around it, so both facts are on screen at once and the colour
 * association the rest of the UI teaches is never dropped.
 *
 * An archetype whose PNG is missing falls back to the plain `ClassDot` rather than
 * a broken image — the roster and the icon folder are maintained separately, so
 * an archetype without art has to degrade to something honest rather than break the
 * row it sits in. `next/image` is deliberately not used: these are small fixed
 * assets from our own public folder, and a bare `img` keeps the fallback logic
 * to one `onError`.
 */
export function ArchetypeIcon({
  archetype,
  size = 16,
  ring = true,
  className = "",
}: {
  archetype: Archetype;
  size?: number;
  /** The class-coloured ring. Off for surfaces that name the class alongside. */
  ring?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const color = ARCHETYPE_CLASS_COLOR[archetype.cls];

  if (failed) return <ClassDot cls={archetype.cls} size={Math.max(6, Math.round(size / 2.5))} />;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full align-middle ${className}`}
      style={{
        width: size,
        height: size,
        background: `${color}1f`,
        border: ring ? `1px solid ${color}66` : undefined,
      }}
      title={`${archetype.name} · ${archetype.cls} — ${archetype.desc}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={archetypeIconSrc(archetype)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </span>
  );
}

// ── Facility art (v1.81) ──────────────────────────────────────────────────

/**
 * A staff badge as the crest it is.
 *
 * The art carries two facts at once — the building's mark in the middle, the
 * tier in the ring — so at the sizes used here (18px in a list, 56px on the
 * card for the badge being BUILT) it stays legible as "a gold ETC badge"
 * without a word of text beside it.
 *
 * A facility with no art falls back to the tinted pip this replaced rather than
 * a broken image: the crest set and the facility table are maintained
 * separately, and a missing PNG must degrade to something that still names the
 * tier. Same `onError` contract as `ArchetypeIcon`, and a bare `img` for the
 * same reason — small fixed assets from our own public folder.
 */
export function BadgeIcon({
  facility,
  tier,
  size = 18,
  className = "",
  title,
}: {
  facility: FacilityId;
  tier: BadgeTier;
  size?: number;
  className?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = badgeIconSrc(facility, tier);
  const color = BADGE_COLOR[tier];
  const label = title ?? tier;

  if (!src || failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border align-middle text-[9px] font-semibold uppercase ${className}`}
        style={{
          width: size,
          height: size,
          borderColor: `${color}66`,
          color,
          backgroundColor: `${color}14`,
        }}
        title={label}
      >
        {tier[0]}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      title={label}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

/**
 * The facility's establishing shot, as the banner behind a card's masthead.
 *
 * The photo is atmosphere, not information, so it is treated as such: darkened
 * under a scrim that runs to near-opaque at the bottom edge, which is what lets
 * the headline number sit ON the image and still hit contrast. `children` are
 * rendered above the scrim.
 *
 * With no art the scrim alone remains — a dark gold-washed panel that still
 * frames the masthead, so an art-less facility loses the photograph and nothing
 * else.
 */
export function FacilityBanner({
  facility,
  height = 168,
  children,
}: {
  facility: FacilityId;
  height?: number;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const src = facilityHeaderSrc(facility);
  const showArt = src !== null && !failed;

  return (
    <div className="relative overflow-hidden" style={{ minHeight: height }}>
      {showArt && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          /* Anchored high: the buildings and pitches live in the top two-thirds
             of the frame, and the bottom is where the scrim is heaviest. */
          style={{ objectPosition: "50% 38%" }}
        />
      )}
      {/* Two scrims. The vertical one guarantees legibility at the bottom edge
          where the masthead sits; the horizontal one keeps the left column —
          where every line of text starts — darker than the open pitch behind it. */}
      <div
        className="absolute inset-0"
        style={{
          background: showArt
            ? "linear-gradient(180deg, rgba(11,12,15,0.10) 0%, rgba(11,12,15,0.26) 42%, rgba(11,12,15,0.88) 88%, rgba(11,12,15,0.97) 100%)"
            : "linear-gradient(180deg, rgba(168,127,46,0.10) 0%, rgba(11,12,15,0.75) 100%)",
        }}
      />
      {showArt && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(11,12,15,0.72) 0%, rgba(11,12,15,0.22) 46%, rgba(11,12,15,0) 100%)",
          }}
        />
      )}
      <div className="relative flex h-full flex-col justify-end">{children}</div>
    </div>
  );
}

/**
 * A class dot — the one-glyph form of a archetype's class (v1.74).
 *
 * Used wherever the class matters but there is no room to spell it: beside a
 * archetype name in a squad row, in the Tactics legend, on a transfer target. The
 * colour is the information, so the `title` carries the same fact in words for
 * anyone who can't use it.
 */
export function ClassDot({ cls, size = 6 }: { cls: ArchetypeClass; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full align-middle"
      style={{ width: size, height: size, background: ARCHETYPE_CLASS_COLOR[cls] }}
      title={`${cls} — ${ARCHETYPE_CLASS_BLURB[cls]}`}
      aria-label={cls}
    />
  );
}

/**
 * The class name as a tinted pill — for the surfaces with room to name it
 * (the profile header, the Tactics legend).
 *
 * Tinted rather than filled: a solid block of colour would compete with the gold
 * accent, which is reserved for the active/important thing. A 15%-alpha fill
 * with a full-strength label reads clearly at 10px without shouting.
 */
export function ClassPill({ cls, className = "" }: { cls: ArchetypeClass; className?: string }) {
  const color = ARCHETYPE_CLASS_COLOR[cls];
  return (
    <span
      className={`display inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] uppercase leading-none tracking-wider ${className}`}
      style={{ background: `${color}26`, color, border: `1px solid ${color}59` }}
      title={ARCHETYPE_CLASS_BLURB[cls]}
    >
      {cls}
    </span>
  );
}

/**
 * A player's identity as one line: his archetype name, coloured by class.
 *
 * This is the canonical replacement for the `archetypeName(p) ?? archetype.name`
 * pattern that every player-listing surface repeated. Folding it into one
 * component is what makes the colour coding consistent by construction — a new
 * screen gets it for free rather than having to remember the fallback and the
 * palette.
 *
 * A player whose attributes are still hidden (an unscouted target) has no
 * archetype at all: since v1.77 identity is read off the attribute line and
 * nothing is stored, so there is genuinely nothing to name yet. He shows a
 * neutral placeholder rather than a guess — the honest signal that scouting him
 * further is what reveals who he is.
 */
export function ArchetypeLabel({
  p,
  dot = true,
  icon = true,
  iconSize = 16,
  className = "",
}: {
  p: { attrs?: Attributes; positions: Pos[] };
  dot?: boolean;
  /** Show the archetype artwork. On by default — this is the canonical identity
   * surface, so turning it on here is what puts the icons on every list at once.
   * Off for the tightest rows, which fall back to the class dot. */
  icon?: boolean;
  iconSize?: number;
  className?: string;
}) {
  const archetype = useArchetype(p);
  if (!archetype) {
    return (
      <span className={`truncate text-faint ${className}`} title="Scout this player to reveal his archetype">
        Unknown
      </span>
    );
  }
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
      title={`${archetype.name} · ${archetype.cls} — ${archetype.desc}`}
    >
      {icon ? (
        <ArchetypeIcon archetype={archetype} size={iconSize} />
      ) : (
        dot && <ClassDot cls={archetype.cls} />
      )}
      <span className="truncate" style={{ color: ARCHETYPE_CLASS_COLOR[archetype.cls] }}>
        {archetype.name}
      </span>
    </span>
  );
}

/**
 * The one canonical "upgrade" container, shared by every upgrade surface —
 * Club → Income, Development → Facilities, and Academy → Upgrades — so they all
 * read as the same object. An optional `accent` hex tints the card border, icon
 * chip and level pips; without it the card uses the neutral gold treatment.
 *
 * Layout (v1.65). The card used to spend most of its height on furniture: five
 * full-width level bars separating the description from the numbers, the current
 * and post-upgrade effects as two columns the eye had to compare across, a cost
 * stranded in a third column away from the button that spends it, and a line of
 * flavour text repeated identically on every card. It now reads top to bottom in
 * three beats:
 *
 *   1. header — icon, title, and the level as compact pips beside "3 / 5"
 *   2. effect — ONE line showing the progression: "+0% ➔ +12% development speed"
 *   3. action — the price sits inside the button that pays it
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
  /** Only shown when it says something this card alone can say — a blocked or
   * maxed state. Generic per-card flavour is deliberately not rendered. */
  note?: React.ReactNode;
  onUpgrade: () => void;
}) {
  const pipOn = accent ?? "var(--color-gold-hi)";
  return (
    <Card
      className="flex flex-col p-4"
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
      {/* 1 — identity + level, grouped together in one row */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-2xl"
          style={
            accent
              ? { borderColor: `${accent}80`, background: `${accent}14` }
              : { borderColor: "var(--color-line)", background: "var(--color-raised)" }
          }
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="display text-base font-semibold leading-tight" style={accent ? { color: accent } : undefined}>
              {title}
            </h2>
            {/* Compact pips beside the count — the level lives in one place in
                the corner instead of a full-width bar across the card. */}
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="flex gap-[3px]">
                {Array.from({ length: maxLevel }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${i < level ? (accent ? "" : "gold-grad") : "bg-line"}`}
                    style={accent && i < level ? { background: pipOn } : undefined}
                  />
                ))}
              </span>
              <span className="tnum text-[11px] text-dim">
                {level}/{maxLevel}
              </span>
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-dim">{blurb}</p>
        </div>
      </div>

      {/* 2 — the effect as a single progression, so the gain reads at a glance */}
      <div className="mt-3 border-t border-line/60 pt-3">
        <div className="text-[10px] uppercase tracking-widest text-mute">Effect</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          {maxed ? (
            <span className="display font-semibold text-win">{effectNow}</span>
          ) : (
            <>
              <span className="display font-semibold text-dim">{effectNow}</span>
              <span aria-hidden className="text-[11px] text-mute">
                ➔
              </span>
              <span className="display font-semibold text-win">{effectNext}</span>
            </>
          )}
        </div>
      </div>

      {/* 3 — the price is part of the action that spends it */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {note && <span className="mr-auto text-[11px] text-mute">{note}</span>}
        {maxed ? (
          <span className="display rounded-md border border-gold-lo/50 px-3 py-1.5 text-xs font-semibold text-gold">
            MAX LEVEL
          </span>
        ) : (
          <GoldButton onClick={onUpgrade} disabled={!canAfford} className="!py-1.5 text-xs">
            <span className="flex items-center gap-2">
              UPGRADE
              <span className="tnum opacity-75">·</span>
              <span className="tnum">{cost}</span>
            </span>
          </GoldButton>
        )}
      </div>
    </Card>
  );
}

/** Primary action — the one gold object on screen. */
export function GoldButton({
  children,
  onClick,
  disabled,
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** Hover text. Worth setting on a DISABLED button in particular — it is the
   * only room a greyed-out control has to say why it is greyed out. */
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
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
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
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
  /** `primary` is for the one action a card exists for (the market's Hire). It
   * carries a gold outline and tint at rest so it reads as the thing to click
   * without spending the solid gold fill, which stays reserved for the ARMED
   * state — a button that already looks committed can't then look more so. */
  tone?: "neutral" | "danger" | "primary";
}) {
  const [armed, setArmed] = useState(false);
  const idleCls =
    tone === "danger"
      ? "border-line bg-raised text-dim hover:border-loss/50 hover:text-loss"
      : tone === "primary"
        ? "border-gold-lo/55 bg-gold-lo/[0.10] text-gold hover:border-gold hover:bg-gold-lo/20 hover:text-gold-hi"
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
  // A modal closes on its ✕ or Escape and nothing else. Clicking the backdrop
  // used to dismiss it, which meant a stray click beside a dialog threw away
  // whatever was half-filled in — a mid-negotiation counter, a contract's terms.
  useEscapeKey(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`max-h-[85vh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-2xl ${
          size === "lg" ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="display text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="-mr-1 rounded px-2 py-1 text-dim transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>
        <div className="gold-thread mb-4" />
        {children}
      </div>
    </div>
  );
}

/** Close-on-Escape for a dialog. Escape is a deliberate, unambiguous dismiss —
 * unlike a backdrop click, you can't hit it by accident while reaching for
 * something inside the dialog. Shared by every overlay in the app. */
export function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Tailwind's `sm` breakpoint, in px — the line this app already draws between
 * "phone" and "everything else" in its responsive classes. Kept in one place so
 * the JS-side check and the CSS-side one can't drift apart. */
const MOBILE_BREAKPOINT = 640;

/**
 * True on a phone-sized viewport. For layout that CSS alone can't express —
 * chiefly the Tactics board, where the drag-and-drop pitch is replaced by list
 * controls on a phone rather than merely restyled.
 *
 * Starts false and corrects itself after mount: the server has no viewport, so
 * rendering the desktop tree first is what keeps hydration consistent. Anything
 * gated on this must therefore be a progressive swap, never the only route to a
 * feature.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap gap-1 border-b border-line ${className}`}>
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

/** One option in a {@link Select}. `hint` renders as a second line in the open
 * menu — room for the thing the label alone can't say. */
export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: React.ReactNode;
  /** Trailing marker on the row (a recommendation dot, a badge). */
  badge?: React.ReactNode;
  disabled?: boolean;
  /** Section this option belongs to (v1.77). Consecutive options sharing a
   * `group` render under one sticky heading — what turns a flat list of twenty
   * formations into three readable buckets. Options are NOT reordered: the
   * caller supplies them already grouped, so the keyboard order and the visual
   * order can never disagree. */
  group?: string;
}

/**
 * A dropdown in the app's own theme (v1.74).
 *
 * A native `<select>` renders its menu with the OS widget — square corners, a
 * system-blue highlight, the platform's font — which is the one part of this
 * app the design system cannot reach. This is the replacement: a button plus a
 * popover list, styled like everything else, with room for a hint line and a
 * trailing badge per row that `<option>` (text-only by spec) can never carry.
 *
 * Keyboard behaviour mirrors the native control closely enough to be
 * unsurprising: ↑/↓ move the highlight, Enter/Space commit, Escape cancels,
 * Home/End jump. It closes on outside click and on scroll of an ancestor, since
 * the menu is absolutely positioned against the trigger.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  title,
  placeholder = "—",
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  title?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Menus near the bottom of a long list would open off-screen, so the popover
  // flips above the trigger when there isn't room below it.
  const [flip, setFlip] = useState(false);
  // Viewport-space geometry for the portalled menu, measured off the trigger at
  // open time. `flipBottom` is the CSS `bottom` for the flipped case, which is
  // measured from the viewport's bottom edge rather than its top.
  const [menuBox, setMenuBox] = useState<{ left: number; width: number; top: number; flipBottom: number } | null>(null);

  const selected = options.find((o) => o.value === value);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    // The menu is portalled to the body, so it is NOT a descendant of the
    // trigger — both refs have to count as "inside" or a mousedown on a row
    // closes the menu before the row's own click can commit it.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Any scroll detaches the menu from its trigger — close rather than let it
    // float somewhere it doesn't belong.
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const openMenu = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      setFlip(window.innerHeight - r.bottom < 240 && r.top > 240);
      setMenuBox({
        left: r.left,
        width: r.width,
        top: r.bottom + 4,
        flipBottom: window.innerHeight - r.top + 4,
      });
    }
    setActive(selectedIndex);
    setOpen(true);
  };

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  /** Next selectable index in `dir`, skipping disabled rows. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((i) => step(i, 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((i) => step(i, -1)); break;
      case "Home": e.preventDefault(); setActive(step(-1, 1)); break;
      case "End": e.preventDefault(); setActive(step(options.length, -1)); break;
      case "Enter": case " ": e.preventDefault(); commit(active); break;
      case "Escape": e.preventDefault(); setOpen(false); break;
      case "Tab": setOpen(false); break;
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-1.5 rounded-md border bg-raised px-2 py-1.5 text-left text-sm text-ink transition-colors ${
          open ? "border-gold" : "border-line hover:border-faint"
        } ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        {selected?.badge}
        <span className={`shrink-0 text-[10px] leading-none text-faint transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {/* The menu is PORTALLED to the body and positioned fixed, rather than
          absolutely inside the trigger. In a long list every row is its own
          stacking context painted after the last, so an in-flow menu is
          overlapped by the rows beneath it however high its z-index goes —
          which is exactly what a dropdown must never do. Fixed positioning also
          means no ancestor's overflow can clip it. */}
      {open && menuBox && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "fixed",
            left: menuBox.left,
            width: menuBox.width,
            ...(flip ? { bottom: menuBox.flipBottom } : { top: menuBox.top }),
          }}
          className={`z-[70] max-h-60 min-w-max overflow-y-auto rounded-md border border-gold-lo/40 bg-surface py-1 shadow-[0_12px_28px_rgba(0,0,0,0.55)] ${menuClassName}`}
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            // A heading whenever the group changes — including the first row, so
            // a grouped list always opens with one.
            const heading = o.group && o.group !== options[i - 1]?.group ? o.group : null;
            return (
              <Fragment key={o.value}>
              {heading && (
                <div className="sticky top-0 z-[1] bg-surface px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-widest text-faint">
                  {heading}
                </div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={o.disabled}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => commit(i)}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors ${
                  o.disabled ? "cursor-not-allowed opacity-40" : i === active ? "bg-hover" : ""
                }`}
              >
                <span className={`mt-[3px] w-1.5 shrink-0 self-stretch rounded-full ${isSel ? "gold-grad" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${isSel ? "font-semibold text-gold" : "text-ink"}`}>{o.label}</span>
                  {o.hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{o.hint}</span>}
                </span>
                {o.badge}
              </button>
              </Fragment>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/** Colour ramp shared by every attribute readout. */
function attrTone(v: number): string {
  return v >= 80 ? "gold-text" : v >= 70 ? "text-ink" : v >= 55 ? "text-dim" : "text-faint";
}

/** The six card faces, derived from the 35 attributes (GKs get keeper labels).
 * The at-a-glance summary — `AttrSheet` is the full breakdown. */
export function AttrGrid({ p }: { p: PlayerBio }) {
  const isGk = p.positions[0] === "GK";
  const agg = aggregateAttrs(p.attrs, isGk);
  const labelsFor = isGk ? GK_FAMILY_LABELS : ATTR_FAMILY_LABELS;
  return (
    // Six across from tablet up (v1.71) — the card faces are a summary strip, so
    // they read as one line above the full sheet rather than a 3×2 block.
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {ATTR_FAMILY_ORDER.map((f) => (
        <div key={f} className="rounded-md border border-line bg-raised p-2 text-center" title={labelsFor[f]}>
          <div className="display text-[10px] font-semibold tracking-widest text-faint">
            {labelsFor[f].slice(0, 3).toUpperCase()}
          </div>
          <div className={`display tnum text-xl font-bold ${attrTone(agg[f])}`}>{agg[f]}</div>
        </div>
      ))}
    </div>
  );
}

/** The bar colour behind an attribute value — the same four bands as the text
 * ramp, so a number and its meter always agree. */
function attrBar(v: number): string {
  return v >= 80
    ? "bg-[var(--color-gold-hi)]"
    : v >= 70
      ? "bg-ink/70"
      : v >= 55
        ? "bg-dim/50"
        : "bg-faint/30";
}

/** One attribute: name, a proportional meter, and the number. The meter is what
 * makes a 35-row sheet scannable — a manager reads the shape of a player long
 * before he reads any single figure. */
function AttrRow({ k, v, isKey, pos }: { k: AttrKey; v: number; isKey: boolean; pos: Pos }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-line/30 py-1 last:border-0"
      title={isKey ? `${ATTR_META[k].name} — a key attribute at ${pos}` : ATTR_META[k].name}
    >
      <span className={`min-w-0 flex-1 truncate text-[11px] ${isKey ? "text-dim" : "text-faint"}`}>
        {isKey && <span className="mr-1 text-gold">◆</span>}
        {ATTR_META[k].name}
      </span>
      <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-line/60 sm:w-14">
        <span className={`block h-full rounded-full ${attrBar(v)}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
      </span>
      <span className={`display tnum w-6 shrink-0 text-right text-sm font-bold ${attrTone(v)}`}>{v}</span>
    </div>
  );
}

/**
 * The full 35-attribute breakdown, grouped as players expect to read it
 * (Attacking / Skill / Movement / Power / Mentality / Defending, plus
 * Goalkeeping for a keeper).
 *
 * Laid out as a MASONRY of group cards (v1.71) rather than one narrow column:
 * the sheet is the densest thing on the profile, and stacking six groups in a
 * half-width column made it a scroll instead of a read. Each group is its own
 * bordered card so the eye can jump straight to "how does he defend"; the
 * columns are CSS columns rather than a grid so groups of different lengths
 * pack tightly instead of leaving a ragged bottom edge.
 *
 * Attributes the player's PRIMARY position actually rates are marked with a gold
 * diamond, so a manager can see at a glance which numbers are carrying his
 * rating and which are incidental — a centre-back's finishing is real, but it
 * isn't what makes him good.
 */
export function AttrSheet({ p }: { p: PlayerBio }) {
  const pos = p.positions[0];
  const isGk = pos === "GK";
  const key = new Set(keyAttrsFor(pos, 8));
  return (
    <div className="gap-3 [column-fill:balance] sm:columns-2 lg:columns-3">
      {attrGroupsFor(isGk).map((g) => (
        <div
          key={g}
          className="mb-3 break-inside-avoid rounded-md border border-line bg-raised/40 px-3 py-2"
        >
          <div className="display mb-1 flex items-baseline justify-between text-[10px] font-semibold tracking-widest text-faint">
            <span>{ATTR_GROUP_LABELS[g].toUpperCase()}</span>
            {/* The group's own mean — the one-number answer to "is he good at
                this?", which the individual rows then explain. */}
            <span className="tnum text-dim">
              {Math.round(
                ATTRS_BY_GROUP[g].reduce((n, k) => n + p.attrs[k], 0) / ATTRS_BY_GROUP[g].length
              )}
            </span>
          </div>
          {ATTRS_BY_GROUP[g].map((k) => (
            <AttrRow key={k} k={k} v={p.attrs[k]} isKey={key.has(k)} pos={pos} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The 35-attribute editor, shared by the two authoring flows (create-a-player at
 * new-game setup, and the reusable library editor). Renders the derived six-face
 * summary, two shaping shortcuts, and a grouped slider per attribute.
 *
 * Editing 35 numbers by hand is a lot of work to reach something plausible, so
 * "SHAPE TO ROLE" rewrites the sheet into a realistic profile for the chosen
 * position and archetype while holding the current overall — the same spread
 * worldgen would produce. From there the author hand-tunes whatever they like.
 */
export function AttrEditor({
  attrs,
  setAttrs,
  primary,
  planId,
}: {
  attrs: Attributes;
  setAttrs: (a: Attributes) => void;
  primary: Pos;
  planId?: string;
}) {
  const isGk = primary === "GK";
  const overall = overallFromAttrs(attrs, primary);
  const agg = useMemo(() => aggregateAttrs(attrs, isGk), [attrs, isGk]);
  const keyAttrs = useMemo(() => new Set(keyAttrsFor(primary, 8)), [primary]);
  const famLabels = isGk ? GK_FAMILY_LABELS : ATTR_FAMILY_LABELS;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="display text-xs font-semibold tracking-widest text-faint">ATTRIBUTES</span>
        <span className="text-[11px] text-faint">
          Overall derives from these — <Ovr value={overall} size="sm" />
        </span>
      </div>

      {/* The six card faces, derived live from the 35 below. */}
      <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {ATTR_FAMILY_ORDER.map((f) => (
          <div key={f} className="rounded-md border border-line bg-raised px-1 py-1 text-center">
            <div className="display text-[9px] font-semibold tracking-widest text-faint">
              {famLabels[f].slice(0, 3).toUpperCase()}
            </div>
            <div className={`display tnum text-base font-bold ${agg[f] >= 80 ? "gold-text" : "text-ink"}`}>
              {agg[f]}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAttrs(shapeAttrsToArchetype(primary, planId, overall))}
          className="display rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-dim hover:text-ink"
          title="Rewrite the sheet to fit this position and archetype, keeping the current overall"
        >
          SHAPE TO ROLE
        </button>
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          SET ALL
          <input
            type="number"
            min={1}
            max={99}
            defaultValue={68}
            onChange={(e) => setAttrs(uniformAttrs(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1)))))}
            className="tnum w-14 rounded border border-line bg-raised px-1.5 py-0.5 text-ink focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      {/* The full sheet, grouped. An outfielder gets no goalkeeping sliders —
          those attributes contribute nothing at his position, so offering them
          would only mislead. */}
      <div className="mt-2 space-y-2">
        {attrGroupsFor(isGk).map((g) => (
          <div key={g}>
            <div className="display mb-0.5 text-[10px] font-semibold tracking-widest text-faint">
              {ATTR_GROUP_LABELS[g].toUpperCase()}
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {ATTRS_BY_GROUP[g].map((k) => {
                const isKey = keyAttrs.has(k);
                return (
                  <label key={k} className="flex items-center gap-2">
                    <span
                      className={`w-[104px] shrink-0 truncate text-[11px] ${isKey ? "text-dim" : "text-faint"}`}
                      title={isKey ? `Key attribute at ${primary}` : ATTR_META[k].name}
                    >
                      {isKey && <span className="mr-0.5 text-gold">◆</span>}
                      {ATTR_META[k].name}
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={99}
                      value={attrs[k]}
                      onChange={(e) => setAttrs({ ...attrs, [k]: Number(e.target.value) })}
                      className="flex-1 accent-[var(--color-gold-hi)]"
                    />
                    <span
                      className={`display tnum w-7 text-right text-sm font-bold ${
                        attrs[k] >= 80 ? "gold-text" : "text-ink"
                      }`}
                    >
                      {attrs[k]}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
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
  fullName = true,
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
  /** Render the abbreviated list name instead of the full one. Cards have a
   * whole row to themselves, so the full name is the default (v1.63) — pass
   * false only somewhere genuinely too tight for it. */
  fullName?: boolean;
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
              {fullName ? displayFullName(p) : p.name}
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
            <span className="min-w-0 flex-1 truncate">{displayFullName(current)}</span>
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
                <span className="min-w-0 flex-1 truncate">{displayFullName(p)}</span>
                <Ovr value={p.overall} size="sm" />
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
