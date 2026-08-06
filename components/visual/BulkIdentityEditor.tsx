"use client";

// Bulk identity editing (v1.97) — a whole division on one page.
//
// The full creators are the right tool for ONE crest: a colour wheel, a 168px
// preview, four jerseys behind a slot picker. They are the wrong tool for
// twenty clubs, where the job is not "design this badge" but "make this league
// look right", and the manager is comparing rows against each other rather than
// perfecting any one of them.
//
// So this is deliberately a TABLE of dropdowns. Every control is a `<select>`
// or a colour input, one row per club, the crest and the three outfield kits
// redrawn live beside them. Nothing here can express anything the creators
// can't — it edits the same two specs through the same normalisers and draws
// through the same two components — it just trades depth for width.
//
// It commits per club, immediately. A page-wide draft would mean holding twenty
// unsaved clubs and having one Save button that either writes all of them or
// loses all of them; a row is small enough that "changed it, it's changed" is
// the honest model, and `Reset` on the row puts it back to derived.

import { useMemo, useState } from "react";
import {
  BADGE_CHARGES,
  BADGE_SHAPES,
  badgeFor,
  normaliseBadge,
  type BadgeCharge,
  type BadgeShape,
  type BadgeSpec,
} from "@/lib/visual/badge";
import {
  COLLARS,
  kitsFor,
  normaliseKit,
  KIT_SLOTS,
  type CollarId,
  type KitSet,
  type KitSlot,
  type KitSpec,
} from "@/lib/visual/kit";
import { PATTERNS, PATTERN_GROUPS, type PatternId } from "@/lib/visual/patterns";
import type { Team } from "@/lib/types";
import { ClubBadge } from "./ClubBadge";
import { ClubKit } from "./ClubKit";

/** The pattern list, grouped exactly as the creators group it — a manager who
 * learned "Stripes lives under Vertical" there must not have to re-learn it. */
const PATTERN_OPTGROUPS = PATTERN_GROUPS.map((g) => ({
  label: g.label,
  keys: g.keys,
}));

const selectCls =
  "w-full rounded-md border border-line bg-raised px-2 py-1 text-[11px] text-ink focus:border-gold focus:outline-none";

function PatternSelect({ value, onChange }: { value: PatternId; onChange: (v: PatternId) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value as PatternId)}>
      {PATTERN_OPTGROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.keys.map((k) => (
            <option key={k} value={k}>
              {PATTERNS[k]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** A labelled colour well. `<input type="color">` rather than the wheel: at this
 * density the wheel is bigger than the row it would sit in, and the OS picker
 * is the control a user reaching for "just make it red" already knows. */
function ColorCell({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center gap-1.5" title={label}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-6 w-6 cursor-pointer rounded border border-line bg-transparent p-0"
      />
      <span className="display text-[9px] uppercase tracking-wider text-faint">{label}</span>
    </label>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="display mb-0.5 text-[9px] uppercase tracking-wider text-faint">{label}</div>
      {children}
    </div>
  );
}

/**
 * One club's row. Badge controls on the left, then a kit block per slot.
 *
 * The row reads through `badgeFor`/`kitsFor` like every other consumer, so a
 * club nobody has edited shows its DERIVED crest and kits and the first change
 * authors from there. That is what makes bulk editing a league feasible at all
 * — the starting point is already a full, club-specific identity rather than a
 * blank spec somebody has to build up from a default shield.
 */
function ClubRow({
  club,
  rev,
  onBadge,
  onKits,
  onReset,
}: {
  club: Team;
  /** The store's revision counter. In the deps below because the store mutates
   * the club IN PLACE — `club` is the same object before and after a commit, so
   * a memo keyed on it alone never invalidates and the row goes on drawing (and
   * reporting, through its dropdowns) the identity it had before the edit. */
  rev: number;
  onBadge: (spec: BadgeSpec) => void;
  onKits: (set: KitSet) => void;
  onReset: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const badge = useMemo(() => badgeFor(club), [club, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kits = useMemo(() => kitsFor(club), [club, rev]);
  const [slot, setSlot] = useState<KitSlot>("home");

  const kit = kits[slot];
  const setBadge = (patch: Partial<BadgeSpec>) => onBadge(normaliseBadge({ ...badge, ...patch }));
  const setKit = (patch: Partial<KitSpec>) => onKits({ ...kits, [slot]: normaliseKit({ ...kit, ...patch }) });
  const authored = !!club.badge || !!club.kits;

  return (
    <div className="border-b border-line/50 px-3 py-3 last:border-0">
      <div className="flex flex-wrap items-start gap-4">
        {/* ---- identity at a glance ---- */}
        <div className="flex w-[168px] shrink-0 items-center gap-2.5">
          <ClubBadge spec={badge} size={44} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{club.name}</div>
            <div className="display text-[10px] uppercase tracking-wider text-faint">{club.short}</div>
            <button
              type="button"
              onClick={onReset}
              disabled={!authored}
              title={
                authored
                  ? "Discard the authored crest and kits — back to the ones this club's name and colours generate"
                  : "This club is already showing its generated identity"
              }
              className="display mt-0.5 text-[9px] uppercase tracking-wider text-faint underline decoration-dotted transition-colors hover:text-gold disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
            >
              {authored ? "Reset" : "Generated"}
            </button>
          </div>
        </div>

        {/* ---- badge ---- */}
        <div className="grid w-[300px] shrink-0 grid-cols-2 gap-x-3 gap-y-2">
          <Cell label="Shape">
            <select
              className={selectCls}
              value={badge.shape}
              onChange={(e) => setBadge({ shape: e.target.value as BadgeShape })}
            >
              {(Object.entries(BADGE_SHAPES) as [BadgeShape, { label: string }][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Cell>
          <Cell label="Emblem">
            <select
              className={selectCls}
              value={badge.charge}
              onChange={(e) => setBadge({ charge: e.target.value as BadgeCharge })}
            >
              {(Object.entries(BADGE_CHARGES) as [BadgeCharge, string][]).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Cell>
          <Cell label="Badge pattern">
            <PatternSelect value={badge.pat} onChange={(pat) => setBadge({ pat })} />
          </Cell>
          <Cell label="Bands">
            <select
              className={selectCls}
              value={badge.patCount}
              onChange={(e) => setBadge({ patCount: Number(e.target.value) })}
            >
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Cell>
          <div className="col-span-2 flex flex-wrap items-center gap-3">
            <ColorCell label="Ground" value={badge.ground} onChange={(ground) => setBadge({ ground })} />
            <ColorCell label="Pattern" value={badge.patColor} onChange={(patColor) => setBadge({ patColor })} />
            <ColorCell label="Trim" value={badge.border} onChange={(border) => setBadge({ border })} />
            <ColorCell label="Text" value={badge.textColor} onChange={(textColor) => setBadge({ textColor })} />
          </div>
        </div>

        {/* ---- kits: all four drawn, one edited ---- */}
        <div className="min-w-[300px] flex-1">
          <div className="mb-2 flex items-end gap-2">
            {KIT_SLOTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSlot(s.key)}
                title={`Edit the ${s.label.toLowerCase()} kit`}
                className={`rounded-md border px-1.5 pb-1 pt-1.5 transition-colors ${
                  slot === s.key ? "border-gold bg-gold/10" : "border-line bg-raised hover:border-faint"
                }`}
              >
                <ClubKit spec={kits[s.key]} size={34} badge={badge} />
                <div
                  className={`display mt-0.5 text-[8.5px] uppercase tracking-wider ${
                    slot === s.key ? "text-gold" : "text-faint"
                  }`}
                >
                  {s.key === "gk" ? "GK" : s.key}
                </div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Cell label="Kit pattern">
              <PatternSelect value={kit.pat} onChange={(pat) => setKit({ pat })} />
            </Cell>
            <Cell label="Collar">
              <select
                className={selectCls}
                value={kit.collar}
                onChange={(e) => setKit({ collar: e.target.value as CollarId })}
              >
                {(Object.entries(COLLARS) as [CollarId, string][]).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Cell>
            <Cell label="Bands">
              <select
                className={selectCls}
                value={kit.patCount}
                onChange={(e) => setKit({ patCount: Number(e.target.value) })}
              >
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Cell>
            <div className="col-span-3 flex flex-wrap items-center gap-3">
              <ColorCell label="Shirt" value={kit.body} onChange={(body) => setKit({ body })} />
              <ColorCell label="Pattern" value={kit.patColor} onChange={(patColor) => setKit({ patColor })} />
              {/* "" means "match the shirt", which a colour input can't say —
                  so the toggle is explicit and the well only appears once the
                  sleeves have their own colour. */}
              <label className="flex items-center gap-1.5 text-[10px] text-dim" title="Give the sleeves their own colour">
                <input
                  type="checkbox"
                  checked={!!kit.sleeves}
                  onChange={(e) => setKit({ sleeves: e.target.checked ? kit.patColor : "" })}
                  className="accent-[var(--color-gold-hi)]"
                />
                <span className="display text-[9px] uppercase tracking-wider text-faint">Sleeves</span>
              </label>
              {kit.sleeves && (
                <ColorCell label="" value={kit.sleeves} onChange={(sleeves) => setKit({ sleeves })} />
              )}
              <ColorCell label="Collar" value={kit.collarColor} onChange={(collarColor) => setKit({ collarColor })} />
              <ColorCell label="Number" value={kit.numberColor} onChange={(numberColor) => setKit({ numberColor })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BulkIdentityEditor({
  clubs,
  rev,
  onBadge,
  onKits,
  onReset,
}: {
  clubs: Team[];
  /** The store's revision counter — see `ClubRow`. */
  rev: number;
  onBadge: (clubId: string, spec: BadgeSpec) => void;
  onKits: (clubId: string, set: KitSet) => void;
  onReset: (clubId: string) => void;
}) {
  if (clubs.length === 0) {
    return <div className="p-4 text-sm text-faint">No clubs in this division.</div>;
  }
  return (
    <div>
      {clubs.map((c) => (
        <ClubRow
          key={c.id}
          club={c}
          rev={rev}
          onBadge={(spec) => onBadge(c.id, spec)}
          onKits={(set) => onKits(c.id, set)}
          onReset={() => onReset(c.id)}
        />
      ))}
    </div>
  );
}
