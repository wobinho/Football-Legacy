"use client";

// Create-a-player (new-game setup): author a custom player — identity, the six
// attributes (overall derives from them, exactly like a custom database),
// potential, archetype, traits — and pick any club in the included world to
// start at. MainMenu injects the result as a PlayerSeed into that club's
// database entry before worldgen runs.

import { useMemo, useState } from "react";
import type { Attributes, Pos } from "@/lib/types";
import type { CountryDatabase, PlayerSeed } from "@/lib/database";
import { archetypesForPosition } from "@/lib/config/archetypes";
import { traitsForPosition } from "@/lib/config/traits";
import { overallFromAttrs } from "@/lib/config/positions";
import { Crest, Flag, GhostButton, GoldButton, Modal, Ovr, PosBadge } from "./ui";

/** The setup-form state for a created player: the seed fields plus where in the
 * included world they start. */
export interface CustomPlayer {
  id: string; // local list key, not a world player id
  name: string;
  age: number;
  nationality: string;
  positions: Pos[]; // [primary, ...secondaries]
  attrs: Attributes;
  potential: number;
  archetypeId?: string; // undefined = auto (rolled for the position)
  traits: string[];
  /** Destination: country code + division id + club index within that division. */
  country: string;
  divisionId: string;
  clubIndex: number;
}

export function customPlayerSeed(p: CustomPlayer): PlayerSeed {
  return {
    name: p.name,
    positions: p.positions,
    attrs: { ...p.attrs },
    age: p.age,
    nationality: p.nationality,
    potential: p.potential,
    ...(p.archetypeId ? { archetypeId: p.archetypeId } : {}),
    ...(p.traits.length ? { traits: p.traits } : {}),
  };
}

const ALL_POS: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
const ATTR_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;
// Outfield vs keeper slot labels — mirrors AttrGrid so the created player reads
// the same here as on their profile.
const ATTR_LABELS: Record<(typeof ATTR_KEYS)[number], string> = {
  pac: "PAC", sho: "SHO", pas: "PAS", dri: "DRI", def: "DEF", phy: "PHY",
};
const GK_ATTR_LABELS: Record<(typeof ATTR_KEYS)[number], string> = {
  pac: "SPD", sho: "REF", pas: "KIC", dri: "POS", def: "DIV", phy: "HAN",
};

const selectCls =
  "mt-1 w-full rounded-md border border-line bg-raised px-2 py-2 text-sm text-ink focus:border-gold focus:outline-none";
const labelCls = "display text-xs font-semibold tracking-widest text-faint";

export default function CreatePlayerModal({
  countries,
  dbFor,
  natOptions,
  initial,
  onSave,
  onClose,
}: {
  /** Included countries (playable + view-only), in display order. */
  countries: { code: string; name: string }[];
  /** Effective database for a country (custom club already spliced in) — null
   * while a preset is still loading. */
  dbFor: (code: string) => CountryDatabase | null;
  /** Nationality codes offered in the dropdown. */
  natOptions: string[];
  initial: CustomPlayer | null;
  onSave: (p: CustomPlayer) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [age, setAge] = useState(initial?.age ?? 21);
  const [nationality, setNationality] = useState(initial?.nationality ?? countries[0]?.code ?? "ENG");
  const [primary, setPrimary] = useState<Pos>(initial?.positions[0] ?? "ST");
  const [secondaries, setSecondaries] = useState<Pos[]>(initial?.positions.slice(1) ?? []);
  const [attrs, setAttrs] = useState<Attributes>(
    initial?.attrs ?? { pac: 68, sho: 68, pas: 68, dri: 68, def: 68, phy: 68 }
  );
  const [potential, setPotential] = useState(initial?.potential ?? 80);
  const [archetypeId, setArchetypeId] = useState<string | undefined>(initial?.archetypeId);
  const [traits, setTraits] = useState<string[]>(initial?.traits ?? []);
  const [country, setCountry] = useState(initial?.country ?? countries[0]?.code ?? "");
  const [divisionId, setDivisionId] = useState<string | null>(initial?.divisionId ?? null);
  const [clubIndex, setClubIndex] = useState(initial?.clubIndex ?? 0);

  const overall = overallFromAttrs(attrs, primary);
  const effectivePotential = Math.max(overall, potential);
  const isGk = primary === "GK";
  const attrLabels = isGk ? GK_ATTR_LABELS : ATTR_LABELS;
  const archetypes = useMemo(() => archetypesForPosition(primary), [primary]);
  const eligibleTraits = useMemo(() => traitsForPosition(primary), [primary]);

  // Destination resolution: the chosen country's divisions (top tier first) and
  // the chosen division's clubs. Selections self-heal if the db changed.
  const db = dbFor(country);
  const divisions = useMemo(() => (db ? [...db.divisions].sort((a, b) => a.tier - b.tier) : []), [db]);
  const division = divisions.find((d) => d.id === divisionId) ?? divisions[0] ?? null;
  const clubs = division?.clubs ?? [];
  const club = clubs[Math.min(clubIndex, Math.max(0, clubs.length - 1))] ?? null;

  const setPrimaryPos = (pos: Pos) => {
    setPrimary(pos);
    setSecondaries((s) => s.filter((x) => x !== pos));
    // an archetype/trait picked for the old position may not fit the new one
    setArchetypeId(undefined);
    setTraits((t) => t.filter((id) => traitsForPosition(pos).some((tr) => tr.id === id)));
  };

  const toggleSecondary = (pos: Pos) =>
    setSecondaries((s) => (s.includes(pos) ? s.filter((x) => x !== pos) : s.length >= 2 ? s : [...s, pos]));

  const toggleTrait = (id: string) =>
    setTraits((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length >= 2 ? t : [...t, id]));

  const valid = name.trim().length > 0 && division !== null && club !== null;

  return (
    <Modal title="Create a Player" onClose={onClose}>
      <div className="space-y-4">
        {/* Live summary card */}
        <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-3">
          <Ovr value={overall} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="display flex items-center gap-2 truncate text-lg font-semibold">
              <Flag nat={nationality} size={13} />
              {name.trim() || "Your Player"}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-faint">
              <PosBadge pos={primary} />
              {secondaries.map((p) => (
                <PosBadge key={p} pos={p} />
              ))}
              <span className="tnum">Age {age}</span>
              <span className="tnum">· Potential {effectivePotential}</span>
            </div>
          </div>
          {club && <Crest colors={club.colors} short={club.short} size={30} />}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className={labelCls}>PLAYER NAME</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Legacy"
              className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />
          </label>
          <label className="block">
            <span className={labelCls}>AGE</span>
            <input
              type="number"
              min={15}
              max={40}
              value={age}
              onChange={(e) => setAge(Math.max(15, Math.min(40, Math.round(Number(e.target.value) || 15))))}
              className="tnum mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink focus:border-gold focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>NATIONALITY</span>
            <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={selectCls}>
              {natOptions.map((nat) => (
                <option key={nat} value={nat}>
                  {nat}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>ARCHETYPE</span>
            <select
              value={archetypeId ?? ""}
              onChange={(e) => setArchetypeId(e.target.value || undefined)}
              className={selectCls}
            >
              <option value="">Auto (fits position)</option>
              {archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <span className={labelCls}>PRIMARY POSITION</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ALL_POS.map((pos) => (
              <button
                key={pos}
                onClick={() => setPrimaryPos(pos)}
                className={`display rounded-md border px-2.5 py-1 text-xs font-bold ${
                  primary === pos ? "border-gold bg-hover text-ink" : "border-line text-faint hover:text-dim"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <span className={`mt-2 block ${labelCls}`}>SECONDARY POSITIONS (up to 2)</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ALL_POS.filter((p) => p !== primary).map((pos) => {
              const on = secondaries.includes(pos);
              return (
                <button
                  key={pos}
                  onClick={() => toggleSecondary(pos)}
                  className={`display rounded-md border px-2.5 py-1 text-xs font-bold ${
                    on ? "border-gold-lo bg-hover text-ink" : "border-line text-faint hover:text-dim"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {pos}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className={labelCls}>ATTRIBUTES</span>
            <span className="text-[11px] text-faint">
              Overall derives from these{isGk ? " (keeper skills)" : ""} — <Ovr value={overall} size="sm" />
            </span>
          </div>
          <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {ATTR_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="display w-9 text-[11px] font-semibold tracking-widest text-faint">{attrLabels[k]}</span>
                <input
                  type="range"
                  min={30}
                  max={99}
                  value={attrs[k]}
                  onChange={(e) => setAttrs({ ...attrs, [k]: Number(e.target.value) })}
                  className="flex-1 accent-[var(--color-gold-hi)]"
                />
                <span className={`display tnum w-7 text-right text-sm font-bold ${attrs[k] >= 80 ? "gold-text" : "text-ink"}`}>
                  {attrs[k]}
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex items-baseline justify-between">
            <span className={labelCls}>POTENTIAL</span>
            <span className="display tnum text-sm font-bold text-gold">{effectivePotential}</span>
          </span>
          <input
            type="range"
            min={40}
            max={96}
            value={effectivePotential}
            onChange={(e) => setPotential(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--color-gold-hi)]"
          />
        </label>

        <div>
          <span className={labelCls}>TRAITS (up to 2)</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {eligibleTraits.map((t) => {
              const on = traits.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTrait(t.id)}
                  title={t.desc}
                  className={`display rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${
                    on ? "border-gold-lo bg-raised text-gold" : "border-line text-faint hover:text-dim"
                  }`}
                >
                  ◆ {t.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className={labelCls}>STARTS AT</span>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setDivisionId(null);
                setClubIndex(0);
              }}
              className={selectCls + " !mt-0"}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={division?.id ?? ""}
              onChange={(e) => {
                setDivisionId(e.target.value);
                setClubIndex(0);
              }}
              className={selectCls + " !mt-0"}
            >
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              value={club ? Math.min(clubIndex, clubs.length - 1) : ""}
              onChange={(e) => setClubIndex(Number(e.target.value))}
              className={selectCls + " !mt-0"}
            >
              {clubs.map((c, i) => (
                <option key={c.short + i} value={i}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {!db && <p className="mt-1 text-[11px] text-faint">Loading this country&apos;s database…</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton
            disabled={!valid}
            onClick={() =>
              division &&
              onSave({
                id: initial?.id ?? `cp${Date.now().toString(36)}`,
                name: name.trim(),
                age,
                nationality,
                positions: [primary, ...secondaries],
                attrs: { ...attrs },
                potential: effectivePotential,
                archetypeId,
                traits,
                country,
                divisionId: division.id,
                clubIndex: Math.min(clubIndex, clubs.length - 1),
              })
            }
          >
            SAVE PLAYER
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}
