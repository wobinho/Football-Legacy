"use client";

// The kit editor: four jerseys per club, edited one at a time. Same contract as
// the badge creator — it edits objects and every preview goes through
// `ClubKit`, so nothing here can promise a shirt the game won't draw.

import { useMemo, useState } from "react";
import {
  COLLARS,
  DEFAULT_KITSET,
  generateKits,
  kitsClash,
  KIT_SLOTS,
  normaliseKit,
  normaliseKitSet,
  type CollarId,
  type KitSet,
  type KitSlot,
  type KitSpec,
} from "@/lib/visual/kit";
import { PATTERN_GROUPS, PATTERNS, readableOn, type PatternId } from "@/lib/visual/patterns";
import type { BadgeSpec } from "@/lib/visual/badge";
import { ClubKit } from "./ClubKit";
import { ColorWheel } from "./ColorWheel";
import { GhostButton } from "../ui";

const COLOR_TARGETS: { key: keyof KitSpec & string; label: string }[] = [
  { key: "body", label: "Shirt" },
  { key: "patColor", label: "Pattern" },
  { key: "sleeves", label: "Sleeves" },
  { key: "collarColor", label: "Collar" },
  { key: "trim", label: "Cuffs" },
  { key: "numberColor", label: "Number" },
];

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`display rounded-md border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        active
          ? "border-gold bg-gold/10 text-gold"
          : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="display mb-2 text-[11px] font-semibold tracking-widest text-gold">{label}</h4>
      {children}
    </section>
  );
}

export function KitCreator({
  value,
  onChange,
  badge,
  club,
}: {
  value: KitSet;
  onChange: (next: KitSet) => void;
  /** The club's crest, so the chest badge previews as the real thing. */
  badge?: BadgeSpec;
  club?: { name: string; short: string; colors: [string, string] };
}) {
  const kits = useMemo(() => normaliseKitSet(value), [value]);
  const [slot, setSlot] = useState<KitSlot>("home");
  const [target, setTarget] = useState<string>("body");
  const [view, setView] = useState<"front" | "back">("front");
  const [group, setGroup] = useState(PATTERN_GROUPS[0].label);
  // Preview only — the player, never the kit.
  const [number, setNumber] = useState("9");
  const [playerName, setPlayerName] = useState("MARQUEZ");

  const kit = kits[slot];
  const set = (patch: Partial<KitSpec>) =>
    onChange({ ...kits, [slot]: normaliseKit({ ...kit, ...patch }) });

  const groupKeys = PATTERN_GROUPS.find((g) => g.label === group)?.keys ?? [];
  const current = target === "sleeves" ? kit.sleeves || kit.body : (kit[target as keyof KitSpec] as string);
  const inUse = [
    ...new Set(
      COLOR_TARGETS.map((t) => (t.key === "sleeves" ? kit.sleeves : (kit[t.key] as string))).filter(Boolean)
    ),
  ];

  // The one thing a kit set has to get right: the away shirt must survive a
  // trip to a club that plays in the home shirt's colours. Checked against this
  // club's OWN home kit, which is the fixture the manager can actually see.
  const clash = slot !== "home" && slot !== "gk" ? kitsClash(kits.home, kit) : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {KIT_SLOTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSlot(s.key)}
            className={`display flex items-center gap-2 rounded-md border py-1 pl-1.5 pr-3 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              slot === s.key ? "border-gold bg-gold/10 text-gold" : "border-line bg-raised text-dim hover:border-faint"
            }`}
          >
            <ClubKit spec={kits[s.key]} size={26} detail="small" />
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* ---------- PREVIEW ---------- */}
        <div>
          <div className="flex flex-col items-center rounded-md border border-line bg-raised p-4">
            <div className="mb-3 flex gap-2">
              <Chip active={view === "front"} onClick={() => setView("front")}>
                Front
              </Chip>
              <Chip active={view === "back"} onClick={() => setView("back")}>
                Back
              </Chip>
            </div>
            <ClubKit spec={kit} size={200} view={view} number={number} playerName={playerName} badge={badge} />
            <div className="gold-thread my-4 w-full" />
            <div className="display mb-2 text-[10px] tracking-widest text-faint">SQUAD LIST VIEW</div>
            <div className="flex items-end gap-4">
              {[20, 28, 44].map((px) => (
                <div key={px} className="text-center">
                  <ClubKit spec={kit} size={px} />
                  <div className="tnum mt-1.5 text-[9px] text-faint">{px}px</div>
                </div>
              ))}
            </div>
          </div>

          {clash?.clash && (
            <p className="mt-2 rounded-md border border-[#e0a04a]/30 bg-[#e0a04a]/10 px-3 py-2 text-[11px] text-[#e0a04a]">
              Too close to the home shirt to be a change kit — a referee would make you change again.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              title="Swap the shirt and pattern colours"
              onClick={() =>
                set({ body: kit.patColor, patColor: kit.body, numberColor: readableOn(kit.patColor) })
              }
            >
              Invert
            </Chip>
            {slot !== "home" && (
              <Chip onClick={() => onChange({ ...kits, [slot]: { ...kits.home } })}>Copy home</Chip>
            )}
            <Chip
              onClick={() =>
                onChange(
                  club
                    ? generateKits({ seed: `kit|${club.name}|${club.short}`, colors: club.colors })
                    : DEFAULT_KITSET
                )
              }
            >
              Reset all
            </Chip>
          </div>
        </div>

        {/* ---------- CONTROLS ---------- */}
        <div>
          <Field label="Pattern">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PATTERN_GROUPS.map((g) => (
                <Chip key={g.label} active={group === g.label} onClick={() => setGroup(g.label)}>
                  {g.label}
                </Chip>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-2">
              {groupKeys.map((key: PatternId) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set({ pat: key })}
                  title={PATTERNS[key]}
                  className={`rounded-md border p-1 transition-colors ${
                    kit.pat === key ? "border-gold bg-gold/10" : "border-line bg-raised hover:border-faint"
                  }`}
                >
                  <ClubKit spec={{ ...kit, pat: key, showBadge: false, frontNumber: false }} size={40} detail="small" />
                  <span className="display mt-0.5 block truncate text-[8px] uppercase tracking-wide text-dim">
                    {PATTERNS[key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={2}
                max={12}
                value={kit.patCount}
                aria-label="Pattern bands"
                onChange={(e) => set({ patCount: Number(e.target.value) })}
                className="h-1.5 flex-1 appearance-none rounded-full bg-hover accent-[var(--color-gold-hi)]"
              />
              <span className="tnum w-16 text-[11px] text-faint">{kit.patCount} bands</span>
            </div>
          </Field>

          <Field label="Collar">
            <div className="flex flex-wrap gap-2">
              {(Object.entries(COLLARS) as [CollarId, string][]).map(([k, l]) => (
                <Chip key={k} active={kit.collar === k} onClick={() => set({ collar: k })}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Colours">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {COLOR_TARGETS.map((t) => {
                const isSleeves = t.key === "sleeves";
                const swatch = isSleeves ? kit.sleeves || kit.body : (kit[t.key] as string);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTarget(t.key)}
                    className={`display flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
                      target === t.key
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-line bg-raised text-dim hover:border-faint"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-sm border border-white/25"
                      style={{ background: swatch, opacity: isSleeves && !kit.sleeves ? 0.4 : 1 }}
                    />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {target === "sleeves" && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip active={!kit.sleeves} onClick={() => set({ sleeves: "" })}>
                  Match shirt
                </Chip>
                {!kit.sleeves && <span className="text-[11px] text-faint">Pick below to give the sleeves their own.</span>}
              </div>
            )}

            <div className="max-w-[220px]">
              <ColorWheel
                value={current}
                onChange={(hex) => set({ [target]: hex } as Partial<KitSpec>)}
                swatches={inUse}
              />
            </div>
            <GhostButton
              className="mt-3 !px-3 !py-1.5 !text-[11px]"
              onClick={() => set({ numberColor: readableOn(kit.body) })}
            >
              Auto-contrast number
            </GhostButton>
          </Field>

          <Field label="Details">
            <div className="mb-3 flex flex-wrap gap-2">
              <Chip active={kit.cuffs} onClick={() => set({ cuffs: !kit.cuffs })}>
                Cuffs
              </Chip>
              <Chip active={kit.showBadge} onClick={() => set({ showBadge: !kit.showBadge })}>
                Chest badge
              </Chip>
              <Chip active={kit.frontNumber} onClick={() => set({ frontNumber: !kit.frontNumber })}>
                Front number
              </Chip>
            </div>
            <div className="grid max-w-[320px] grid-cols-[90px_1fr] gap-3">
              <label className="block">
                <span className="display text-[10px] font-semibold uppercase tracking-widest text-faint">Number</span>
                <input
                  value={number}
                  maxLength={2}
                  onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
                  className="mt-1 w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="display text-[10px] font-semibold uppercase tracking-widest text-faint">Name</span>
                <input
                  value={playerName}
                  maxLength={14}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-faint">
              Preview only. The number and the name belong to the player, not the kit — only the number&apos;s colour
              is stored here.
            </p>
          </Field>
        </div>
      </div>
    </div>
  );
}
