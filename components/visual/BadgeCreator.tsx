"use client";

// The badge editor. It edits ONE small object and knows nothing about how that
// object draws — every preview and every picker swatch goes through
// `ClubBadge`, so the editor can never show a crest the game won't.

import { useMemo, useState } from "react";
import {
  BADGE_CHARGES,
  BADGE_SHAPES,
  badgeIsTooDark,
  generateBadge,
  normaliseBadge,
  type BadgeCharge,
  type BadgeShape,
  type BadgeSpec,
} from "@/lib/visual/badge";
import { PATTERN_GROUPS, PATTERNS, readableOn, type PatternId } from "@/lib/visual/patterns";
import { ClubBadge } from "./ClubBadge";
import { ColorWheel } from "./ColorWheel";
import { GhostButton } from "../ui";

const COLOR_TARGETS: { key: keyof BadgeSpec & string; label: string }[] = [
  { key: "ground", label: "Ground" },
  { key: "patColor", label: "Pattern" },
  { key: "border", label: "Trim" },
  { key: "chargeColor", label: "Emblem" },
  { key: "textColor", label: "Text" },
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

export function BadgeCreator({
  value,
  onChange,
  /** The club this badge belongs to — used only to seed "Surprise me" and to
   * label the reset. */
  club,
}: {
  value: BadgeSpec;
  onChange: (next: BadgeSpec) => void;
  club?: { name: string; short: string; colors: [string, string] };
}) {
  const spec = useMemo(() => normaliseBadge(value), [value]);
  const [target, setTarget] = useState<string>("ground");
  const [group, setGroup] = useState(PATTERN_GROUPS[0].label);

  const set = (patch: Partial<BadgeSpec>) => onChange(normaliseBadge({ ...spec, ...patch }));

  const groupKeys = PATTERN_GROUPS.find((g) => g.label === group)?.keys ?? [];
  const inUse = [...new Set(COLOR_TARGETS.map((t) => spec[t.key] as string).filter(Boolean))];
  const current = (spec[target as keyof BadgeSpec] as string) ?? spec.ground;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
      {/* ---------- PREVIEW ---------- */}
      <div>
        <div className="flex flex-col items-center rounded-md border border-line bg-raised p-4">
          <ClubBadge spec={spec} size={168} />
          <div className="gold-thread my-4 w-full" />
          <div className="display mb-2 text-[10px] tracking-widest text-faint">AS THE GAME DRAWS IT</div>
          <div className="flex items-end gap-4">
            {[18, 26, 40, 64].map((px) => (
              <div key={px} className="text-center">
                <ClubBadge spec={spec} size={px} />
                <div className="tnum mt-1.5 text-[9px] text-faint">{px}px</div>
              </div>
            ))}
          </div>
        </div>

        {badgeIsTooDark(spec) && (
          <p className="mt-2 rounded-md border border-[#e0a04a]/30 bg-[#e0a04a]/10 px-3 py-2 text-[11px] text-[#e0a04a]">
            This badge nearly disappears against the app&apos;s background. Lighten the trim or the ground.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip
            onClick={() =>
              onChange(
                generateBadge({
                  seed: Math.random(),
                  name: spec.name || club?.name,
                  code: spec.code || club?.short,
                  year: spec.year,
                })
              )
            }
          >
            Surprise me
          </Chip>
          {club && (
            <Chip
              title="Back to the crest this club's own name and colours produce"
              onClick={() =>
                onChange(
                  generateBadge({
                    seed: `${club.name}|${club.short}`,
                    name: club.name,
                    code: club.short,
                    colors: club.colors,
                    year: spec.year,
                  })
                )
              }
            >
              Reset
            </Chip>
          )}
        </div>
      </div>

      {/* ---------- CONTROLS ---------- */}
      <div>
        <Field label="Shape">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-2">
            {(Object.entries(BADGE_SHAPES) as [BadgeShape, { label: string; d: string }][]).map(([key, sh]) => (
              <button
                key={key}
                type="button"
                onClick={() => set({ shape: key })}
                title={sh.label}
                className={`rounded-md border p-1.5 transition-colors ${
                  spec.shape === key ? "border-gold bg-gold/10" : "border-line bg-raised hover:border-faint"
                }`}
              >
                <svg viewBox="0 0 100 100" width="30" height="30" className="mx-auto block">
                  <path d={sh.d} fill={spec.shape === key ? "var(--color-gold)" : "#3a3e46"} />
                </svg>
                <span className="display mt-1 block text-[8.5px] uppercase tracking-wider text-dim">{sh.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Pattern">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PATTERN_GROUPS.map((g) => (
              <Chip key={g.label} active={group === g.label} onClick={() => setGroup(g.label)}>
                {g.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
            {groupKeys.map((key: PatternId) => (
              <button
                key={key}
                type="button"
                onClick={() => set({ pat: key })}
                title={PATTERNS[key]}
                className={`rounded-md border p-1 transition-colors ${
                  spec.pat === key ? "border-gold bg-gold/10" : "border-line bg-raised hover:border-faint"
                }`}
              >
                {/* Through the real component: a swatch can never show
                    something the game won't draw. */}
                <ClubBadge
                  size={38}
                  detail="small"
                  spec={{ ...spec, pat: key, charge: "none", code: "", showName: false, showYear: false }}
                />
                <span className="display mt-1 block truncate text-[8px] uppercase tracking-wide text-dim">
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
              value={spec.patCount}
              aria-label="Pattern bands"
              onChange={(e) => set({ patCount: Number(e.target.value) })}
              className="h-1.5 flex-1 appearance-none rounded-full bg-hover accent-[var(--color-gold-hi)]"
            />
            <span className="tnum w-16 text-[11px] text-faint">{spec.patCount} bands</span>
          </div>
        </Field>

        <Field label="Colours">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {COLOR_TARGETS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTarget(t.key)}
                className={`display flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
                  target === t.key ? "border-gold bg-gold/10 text-gold" : "border-line bg-raised text-dim hover:border-faint"
                }`}
              >
                <span
                  className="h-3 w-3 rounded-sm border border-white/25"
                  style={{ background: spec[t.key] as string }}
                />
                {t.label}
              </button>
            ))}
          </div>
          <div className="max-w-[220px]">
            <ColorWheel value={current} onChange={(hex) => set({ [target]: hex } as Partial<BadgeSpec>)} swatches={inUse} />
          </div>
          <GhostButton
            className="mt-3 !px-3 !py-1.5 !text-[11px]"
            onClick={() => set({ textColor: readableOn(spec.ground), chargeColor: readableOn(spec.ground) })}
          >
            Auto-contrast text
          </GhostButton>
        </Field>

        <Field label="Emblem">
          <div className="flex flex-wrap gap-2">
            {(Object.entries(BADGE_CHARGES) as [BadgeCharge, string][]).map(([k, l]) => (
              <Chip key={k} active={spec.charge === k} onClick={() => set({ charge: k })}>
                {l}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Lettering">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { k: "code", l: "Short code", max: 4, wide: false },
                { k: "year", l: "Founded", max: 4, wide: false },
                { k: "name", l: "Club name", max: 22, wide: true },
              ] as const
            ).map(({ k, l, max, wide }) => (
              <label key={k} className={wide ? "col-span-2 block" : "block"}>
                <span className="display text-[10px] font-semibold uppercase tracking-widest text-faint">{l}</span>
                <input
                  value={String(spec[k])}
                  maxLength={max}
                  onChange={(e) =>
                    set({
                      [k]: k === "year" ? Number(e.target.value.replace(/\D/g, "")) || 0 : e.target.value,
                    } as Partial<BadgeSpec>)
                  }
                  className="mt-1 w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip active={spec.showName} onClick={() => set({ showName: !spec.showName })}>
              Name arc
            </Chip>
            <Chip active={spec.showYear} onClick={() => set({ showYear: !spec.showYear })}>
              Year
            </Chip>
            <Chip active={spec.innerLine} onClick={() => set({ innerLine: !spec.innerLine })}>
              Inner line
            </Chip>
          </div>
        </Field>
      </div>
    </div>
  );
}
