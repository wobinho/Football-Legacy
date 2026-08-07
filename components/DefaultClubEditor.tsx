"use client";

// ── Edit the default clubs (v2.0) ─────────────────────────────────────────
//
// The Database Editor's third tab, and deliberately NOT a fourth flavour of the
// two that were already there.
//
//   • A CUSTOM CLUB answers "I want a club that doesn't exist".
//   • IMPORT-FROM-DEFAULT answers "I want a club LIKE Real Madrid" — it makes an
//     editable copy, which you then have to remember to place over the original
//     at every new game. That leaves two Real Madrids in the setup screen and
//     silently reverts the moment you forget.
//   • This answers the third question: "Real Madrid's crest is wrong, and I want
//     it fixed in every legacy I ever start."
//
// So an edit here is an OVERRIDE, not a copy — a patch keyed by country and club
// name, stored in the same owner-scoped library, applied at `dbForChoice` in
// MainMenu (the one funnel every database choice passes through). See
// `ClubOverride` in lib/customdb.ts for why it is a patch rather than a whole
// club, and why the key is the name.
//
// What it edits is a club's IDENTITY — crest, kits, colours, name, short code,
// stadium, reputation. Deliberately not its squad: a roster is what
// import-from-default already exists for, and a stored roster would freeze the
// club at whatever the shipped database said on the day it was edited, opting it
// out of every future `npm run build:db`. Identity is exactly the part that
// doesn't go stale.

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { ClubSeed, CountryDatabase } from "@/lib/database";
import type { ClubOverride } from "@/lib/customdb";
import { overrideKey } from "@/lib/customdb";
import { PRESETS, loadPreset } from "@/lib/config/presets";
import { badgeFor, type BadgeSpec } from "@/lib/visual/badge";
import { kitsFor, type KitSet } from "@/lib/visual/kit";
import { matchesAny } from "@/lib/search";
import { ClubBadge } from "./visual/ClubBadge";
import { ClubKit } from "./visual/ClubKit";
import { BadgeCreator } from "./visual/BadgeCreator";
import { KitCreator } from "./visual/KitCreator";
import { GhostButton, GoldButton, Modal } from "./ui";

/** A club flattened out of the loaded country database, with its division. */
interface ClubRow {
  seed: ClubSeed;
  divisionName: string;
  tier: number;
}

export default function DefaultClubEditor() {
  const library = useGame((s) => s.library);
  const removeClubOverride = useGame((s) => s.removeClubOverride);
  const showToast = useGame((s) => s.showToast);

  const [code, setCode] = useState<string>(PRESETS[0]?.code ?? "ENG");
  const [db, setDb] = useState<CountryDatabase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ClubRow | null>(null);

  const overrides = useMemo(() => library.clubOverrides ?? [], [library.clubOverrides]);
  const overrideMap = useMemo(
    () => new Map(overrides.map((o) => [overrideKey(o.country, o.clubName), o])),
    [overrides]
  );

  // Presets are cached by `loadPreset`, so flipping back to a country already
  // seen is instant.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDb(null);
    loadPreset(code)
      .then((loaded) => {
        if (!cancelled) setDb(loaded);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load that database.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const rows = useMemo<ClubRow[]>(() => {
    if (!db) return [];
    const all = [...db.divisions]
      .sort((a, b) => a.tier - b.tier)
      .flatMap((d) => d.clubs.map((seed) => ({ seed, divisionName: d.name, tier: d.tier })));
    const q = query.trim();
    return q ? all.filter((r) => matchesAny([r.seed.name, r.seed.short], q)) : all;
  }, [db, query]);

  /** The club as it will actually be built — shipped seed with its patch on top.
   * Every preview on this screen reads through this, so the row and the editor
   * can never show a different club from the one a new legacy gets. */
  const effective = (seed: ClubSeed): ClubSeed => {
    const o = overrideMap.get(overrideKey(code, seed.name));
    if (!o) return seed;
    return {
      ...seed,
      ...(o.name !== undefined ? { name: o.name } : {}),
      ...(o.short !== undefined ? { short: o.short } : {}),
      ...(o.colors !== undefined ? { colors: [...o.colors] as [string, string] } : {}),
      ...(o.rep !== undefined ? { rep: o.rep } : {}),
      ...(o.stadium !== undefined ? { stadium: o.stadium } : {}),
      ...(o.badge !== undefined ? { badge: o.badge } : {}),
      ...(o.kits !== undefined ? { kits: o.kits } : {}),
    };
  };

  const editedInCountry = overrides.filter((o) => o.country.toUpperCase() === code.toUpperCase()).length;

  return (
    <section className="space-y-3">
      <p className="text-[13px] text-dim">
        Edit the clubs that <b className="text-ink">ship with the game</b>. Changes are permanent and apply to every
        new legacy you start — re-crest Real Madrid here and Real Madrid has that crest in every save from now on.
        Running saves are untouched: a world is built once.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
        >
          {PRESETS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clubs…"
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
        />
        <span className="text-[11px] text-faint">
          {editedInCountry > 0 ? (
            <>
              <span className="display gold-text tnum font-bold">{editedInCountry}</span> edited here
            </>
          ) : (
            "None edited here"
          )}
        </span>
      </div>

      {loading && <p className="px-4 py-8 text-center text-sm text-faint">Loading database…</p>}
      {error && (
        <p className="rounded-md border border-loss/40 bg-loss/5 px-4 py-3 text-center text-sm text-loss">{error}</p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-faint">
          {query ? `No clubs match “${query}”.` : "This database has no clubs."}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const eff = effective(r.seed);
          const edited = overrideMap.has(overrideKey(code, r.seed.name));
          return (
            <div
              key={`${r.tier}:${r.seed.name}`}
              className={`flex flex-wrap items-center gap-3 rounded-md border bg-surface px-3 py-2 ${
                edited ? "border-gold-lo/60" : "border-line"
              }`}
            >
              <ClubBadge spec={badgeFor(eff)} size={30} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{eff.name}</span>
                  {edited && (
                    <span className="display shrink-0 rounded-sm border border-gold-lo/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-gold">
                      Edited
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-faint">
                  {eff.short} · {r.divisionName}
                  {/* The name it is matched by, when the override renamed it —
                      otherwise "Edited" on a club you don't recognise is a
                      mystery you can't resolve from this screen. */}
                  {edited && eff.name !== r.seed.name && (
                    <span className="text-dim"> · was {r.seed.name}</span>
                  )}
                </div>
              </div>
              {/* The three outfield shirts, as the club card shows them. */}
              <div className="flex shrink-0 items-center gap-1">
                {(["home", "away", "third"] as const).map((slot) => (
                  // `title` goes on the kit itself, not a wrapper — the
                  // aria-label is the jersey's own (v1.97).
                  <ClubKit
                    key={slot}
                    spec={kitsFor(eff)[slot]}
                    size={24}
                    title={`${eff.name} ${slot} kit`}
                  />
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => setEditing(r)}
                  className="min-h-[32px] rounded border border-line px-2.5 py-1.5 text-[11px] text-dim hover:text-ink"
                >
                  Edit
                </button>
                {edited && (
                  <button
                    onClick={() => {
                      removeClubOverride(code, r.seed.name);
                      showToast(`${r.seed.name} reset to its shipped identity.`);
                    }}
                    className="min-h-[32px] rounded border border-line px-2.5 py-1.5 text-[11px] text-faint hover:text-loss"
                    title="Discard your edits and go back to the shipped club"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <DefaultClubModal
          country={code}
          row={editing}
          existing={overrideMap.get(overrideKey(code, editing.seed.name))}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/**
 * The editor itself.
 *
 * Every field starts at the shipped value, and is only written into the override
 * when it actually DIFFERS from it — which is what keeps a patch minimal, and
 * what makes "change the crest and nothing else" leave the club's name, colours
 * and reputation free to move when the shipped database is next rebuilt.
 *
 * The crest and kits start from `badgeFor`/`kitsFor` — the derived look, never
 * `seed.badge` directly (the v1.96 rule). So opening the editor on a club nobody
 * has touched shows the crest the game actually draws for it, rather than a
 * blank canvas that would throw its generated identity away the moment you
 * saved.
 */
function DefaultClubModal({
  country,
  row,
  existing,
  onClose,
}: {
  country: string;
  row: ClubRow;
  existing?: ClubOverride;
  onClose: () => void;
}) {
  const saveClubOverride = useGame((s) => s.saveClubOverride);
  const showToast = useGame((s) => s.showToast);
  const seed = row.seed;

  const [tab, setTab] = useState<"details" | "badge" | "kits">("details");
  const [name, setName] = useState(existing?.name ?? seed.name);
  const [short, setShort] = useState(existing?.short ?? seed.short);
  const [stadium, setStadium] = useState(existing?.stadium ?? seed.stadium);
  const [rep, setRep] = useState(existing?.rep ?? seed.rep);
  const [colors, setColors] = useState<[string, string]>(
    existing?.colors ? [...existing.colors] : [...seed.colors] as [string, string]
  );

  // The club as it stands in the editor, so both creators preview against the
  // live values rather than the shipped ones — changing the primary colour has
  // to move the derived crest under it.
  const draftClub = useMemo(
    () => ({ name, short, colors }),
    [name, short, colors]
  );

  const [badge, setBadge] = useState<BadgeSpec>(() =>
    badgeFor({ ...seed, ...(existing?.badge ? { badge: existing.badge } : {}) })
  );
  const [kits, setKits] = useState<KitSet>(() =>
    kitsFor({ ...seed, ...(existing?.kits ? { kits: existing.kits } : {}) })
  );
  // Whether the user has actually TOUCHED the visuals in this sitting. Without
  // this, opening the editor and pressing Save would store the derived crest as
  // an authored one on every club it was opened on — freezing a look that costs
  // nothing to derive and that a better generator should still be able to reach.
  const [badgeTouched, setBadgeTouched] = useState(!!existing?.badge);
  const [kitsTouched, setKitsTouched] = useState(!!existing?.kits);

  const commit = () => {
    const trimmedName = name.trim() || seed.name;
    const trimmedShort = short.trim().toUpperCase() || seed.short;
    saveClubOverride({
      country,
      clubName: seed.name,
      // Only genuine differences are stored — see the note above the component.
      ...(trimmedName !== seed.name ? { name: trimmedName } : {}),
      ...(trimmedShort !== seed.short ? { short: trimmedShort } : {}),
      ...(stadium.trim() && stadium.trim() !== seed.stadium ? { stadium: stadium.trim() } : {}),
      ...(rep !== seed.rep ? { rep } : {}),
      ...(colors[0] !== seed.colors[0] || colors[1] !== seed.colors[1] ? { colors } : {}),
      ...(badgeTouched ? { badge } : {}),
      ...(kitsTouched ? { kits } : {}),
    });
    showToast(`${trimmedName} saved — it will look like this in every new legacy.`);
    onClose();
  };

  return (
    <Modal title={`Edit ${seed.name}`} onClose={onClose} size="xl">
      <div className="space-y-4">
        <p className="text-[11px] leading-snug text-faint">
          A permanent edit to a shipped club. Only what you actually change is stored, so anything you leave alone
          keeps following the shipped database when it is next updated.
        </p>

        <div className="flex items-center gap-1 rounded-md border border-line p-0.5">
          {(
            [
              ["details", "DETAILS"],
              ["badge", "CREST"],
              ["kits", "KITS"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`display flex-1 rounded px-3 py-2 text-xs font-semibold tracking-widest transition-colors ${
                tab === id ? "bg-hover text-ink" : "text-faint hover:text-dim"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "details" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
            {/* The club as it will be drawn, so a colour change is visible
                against the crest and shirt it actually moves. */}
            <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-raised p-4">
              <ClubBadge spec={badgeTouched ? badge : badgeFor({ ...seed, ...draftClub })} size={96} />
              <div className="display text-center text-sm font-semibold">{name || seed.name}</div>
              <div className="flex items-center gap-2">
                {(["home", "away", "third", "gk"] as const).map((slot) => (
                  <ClubKit
                    key={slot}
                    spec={(kitsTouched ? kits : kitsFor({ ...seed, ...draftClub }))[slot]}
                    size={34}
                    title={`${name || seed.name} ${slot} kit`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </Field>
              <Field label="Short code">
                <input
                  value={short}
                  onChange={(e) => setShort(e.target.value.toUpperCase().slice(0, 4))}
                  className="w-24 rounded-md border border-line bg-raised px-3 py-2 text-sm tnum text-ink focus:border-gold focus:outline-none"
                />
              </Field>
              <Field label="Stadium">
                <input
                  value={stadium}
                  onChange={(e) => setStadium(e.target.value)}
                  maxLength={40}
                  className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </Field>
              <Field label="Colours">
                <div className="flex items-center gap-3">
                  {([0, 1] as const).map((i) => (
                    <label key={i} className="flex items-center gap-2 text-[11px] text-faint">
                      <input
                        type="color"
                        value={colors[i]}
                        onChange={(e) =>
                          setColors((c) => {
                            const next = [...c] as [string, string];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        className="h-8 w-12 cursor-pointer rounded border border-line bg-raised"
                      />
                      {i === 0 ? "Primary" : "Secondary"}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={`Reputation — ${rep}`}>
                {/* Reputation is a REAL simulation input (it gates who will sign
                    for the club and how much it earns), unlike everything else
                    on this tab. It is offered because "this club should be a
                    giant in my world" is a legitimate permanent edit, but it is
                    the one control here that changes more than the look. */}
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={rep}
                  onChange={(e) => setRep(Number(e.target.value))}
                  className="w-full accent-[var(--color-gold)]"
                />
                <div className="mt-1 text-[10px] text-faint">
                  Shipped value {seed.rep}. Reputation decides who will sign for this club and what it earns — the
                  only thing on this tab the simulation reads.
                </div>
              </Field>
            </div>
          </div>
        )}

        {tab === "badge" && (
          <BadgeCreator
            value={badge}
            onChange={(next) => {
              setBadge(next);
              setBadgeTouched(true);
            }}
            club={draftClub}
          />
        )}

        {tab === "kits" && (
          <KitCreator
            value={kits}
            onChange={(next) => {
              setKits(next);
              setKitsTouched(true);
            }}
            badge={badgeTouched ? badge : badgeFor({ ...seed, ...draftClub })}
            club={draftClub}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Clearing an authored crest goes back to DERIVED rather than
              freezing a copy of it — the v1.96 rule, and the reason these are
              two separate buttons rather than one "reset". */}
          <div className="flex flex-wrap gap-2">
            {badgeTouched && (
              <GhostButton
                onClick={() => {
                  setBadge(badgeFor({ ...seed, ...draftClub }));
                  setBadgeTouched(false);
                }}
                className="!px-3 !py-1 text-xs"
              >
                Reset crest
              </GhostButton>
            )}
            {kitsTouched && (
              <GhostButton
                onClick={() => {
                  setKits(kitsFor({ ...seed, ...draftClub }));
                  setKitsTouched(false);
                }}
                className="!px-3 !py-1 text-xs"
              >
                Reset kits
              </GhostButton>
            )}
          </div>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <GoldButton onClick={commit}>SAVE PERMANENTLY</GoldButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">{label}</div>
      {children}
    </div>
  );
}
