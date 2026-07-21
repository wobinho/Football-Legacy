"use client";

// Main menu: continue a save, start a new legacy, or import a JSON save.

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import { COUNTRIES, getCountry } from "@/lib/config/countries";
import { PRESETS, getPreset, loadPreset, proceduralFromPreset } from "@/lib/config/presets";
import {
  COUNTRY_DB_SCHEMA,
  countryDBTemplate,
  defaultCountryDB,
  validateCountryDB,
  type CountryDatabase,
  type PlayerSeed,
} from "@/lib/database";
import { libraryClubToSeed } from "@/lib/customdb";
import { divisionSeed, teamIdFor } from "@/lib/worldgen";
import { DEFAULT_TIER_NAMES, MAX_DIVISION_DEPTH, generateDivisionClubs } from "@/lib/config/divisions";
import { storedKey } from "@/lib/auth";
import { NAME_POOLS } from "@/lib/config/names";
import { overallFromAttrs } from "@/lib/config/positions";
import { CountryFlag, Crest, Flag, GoldButton, GhostButton, Modal, Ovr, PosBadge } from "./ui";
import CreateClubModal, { customClubSeed, type CustomClub } from "./CreateClubModal";
import CreatePlayerModal, { customPlayerSeed, type CustomPlayer } from "./CreatePlayerModal";
import DatabaseEditor from "./DatabaseEditor";

export default function MainMenu() {
  const [mode, setMode] = useState<"menu" | "new" | "database">("menu");
  const logout = useGame((s) => s.logout);
  const who = storedKey();
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <header className="mb-10 text-center">
        <div className="display text-4xl font-bold tracking-wide sm:text-6xl">
          FOOTBALL <span className="gold-text">LEGACY</span>
        </div>
        <div className="gold-thread mx-auto mt-3 w-64" />
        <p className="mt-3 text-sm text-dim">Build a dynasty. Write the history books.</p>
        {who && (
          <p className="mt-2 text-xs text-faint">
            Signed in as <span className="text-dim">{who.label}</span> ·{" "}
            <button onClick={logout} className="text-gold hover:underline">
              Log out
            </button>
          </p>
        )}
      </header>
      {mode === "menu" && (
        <SaveList onNew={() => setMode("new")} onDatabase={() => setMode("database")} />
      )}
      {mode === "new" && <NewGameForm onBack={() => setMode("menu")} />}
      {mode === "database" && <DatabaseEditor onBack={() => setMode("menu")} />}
    </div>
  );
}

function SaveList({ onNew, onDatabase }: { onNew: () => void; onDatabase: () => void }) {
  const saves = useGame((s) => s.saves);
  const loadSave = useGame((s) => s.loadSave);
  const removeSave = useGame((s) => s.removeSave);
  const importFile = useGame((s) => s.importFile);
  const showToast = useGame((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {saves.map((s) => (
        <div key={s.saveName} className="flex items-center justify-between rounded-md border border-line bg-surface p-4">
          <div>
            <div className="display text-lg font-semibold">{s.saveName}</div>
            <div className="text-xs text-dim">
              {s.managerName} · {s.teamName} · Season {s.season}
            </div>
          </div>
          <div className="flex gap-2">
            {confirmDelete === s.saveName ? (
              <>
                <GhostButton onClick={() => removeSave(s.saveName)} className="!border-loss !text-loss">
                  Delete forever
                </GhostButton>
                <GhostButton onClick={() => setConfirmDelete(null)}>Keep</GhostButton>
              </>
            ) : (
              <>
                <GhostButton onClick={() => setConfirmDelete(s.saveName)}>Delete</GhostButton>
                <GoldButton onClick={() => loadSave(s.saveName)}>CONTINUE</GoldButton>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap justify-center gap-3 pt-4">
        <GoldButton onClick={onNew}>NEW LEGACY</GoldButton>
        <GhostButton onClick={onDatabase}>Database editor</GhostButton>
        <GhostButton onClick={() => fileRef.current?.click()}>Import save</GhostButton>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                await importFile(f);
              } catch (err) {
                showToast(err instanceof Error ? err.message : "Import failed.");
              }
            }
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// A per-country database choice: the procedural default, a built-in preset, or a
// validated upload. Every country carries a default: engine countries have a
// fictional procedural world; preset-only countries derive theirs from the
// preset (real clubs, generated squads — see proceduralFromPreset).
type DbChoice =
  | { source: "default" }
  | { source: "preset" }
  | { source: "custom"; db: CountryDatabase; fileName: string };

/** A selectable country in the setup form: a code + display name, plus whether
 * its default is the engine's fictional world (vs. derived from the preset) and
 * whether it ships a bundled preset. Merges the engine's default countries with
 * the preset-only countries. */
interface CountryOption {
  code: string;
  name: string;
  hasEngineDefault: boolean;
  hasPreset: boolean;
}

const COUNTRY_OPTIONS: CountryOption[] = (() => {
  const byCode = new Map<string, CountryOption>();
  for (const c of COUNTRIES) byCode.set(c.code, { code: c.code, name: c.name, hasEngineDefault: true, hasPreset: false });
  for (const p of PRESETS) {
    const existing = byCode.get(p.code);
    if (existing) existing.hasPreset = true;
    else byCode.set(p.code, { code: p.code, name: p.name, hasEngineDefault: false, hasPreset: true });
  }
  return Array.from(byCode.values());
})();

const OPTION_MAP: Record<string, CountryOption> = Object.fromEntries(COUNTRY_OPTIONS.map((o) => [o.code, o]));

/** Every country starts on its default database (procedural or preset-derived). */
function initialChoice(): DbChoice {
  return { source: "default" };
}

/** A country whose "default" is derived from its preset (no engine club pool)
 * needs the preset asset fetched even when Default is the active choice. */
function defaultNeedsPreset(code: string): boolean {
  return !OPTION_MAP[code]?.hasEngineDefault;
}

function NewGameForm({ onBack }: { onBack: () => void }) {
  const newGame = useGame((s) => s.newGame);
  const showToast = useGame((s) => s.showToast);
  const [managerName, setManagerName] = useState("");
  const [saveName, setSaveName] = useState("My Legacy");
  const [playableCountry, setPlayableCountry] = useState<string>("ENG");
  const [clubIndex, setClubIndex] = useState<number | null>(null);
  // Which tier of the playable ladder you start in (v17, 1-based). You may begin
  // in a lower division and work your way up.
  const [startTier, setStartTier] = useState<number>(1);
  // How many tiers EACH included country runs (v17), keyed by country code.
  // Tiers beyond what a country's database authors are generated procedurally.
  const [divisionDepths, setDivisionDepths] = useState<Record<string, number>>({ ENG: 2 });
  // Optional user-chosen league names, keyed by tier. Blank = keep the default.
  const [divisionNames, setDivisionNames] = useState<Record<number, string>>({});
  // other countries to include as sim-only (view/shopping). Default: the other
  // engine-default countries (preset-only countries are opt-in).
  const [viewCountries, setViewCountries] = useState<string[]>(
    COUNTRIES.filter((c) => c.code !== "ENG").map((c) => c.code)
  );
  // per-country database choice, keyed by country code
  const [dbChoices, setDbChoices] = useState<Record<string, DbChoice>>({});
  // resolved preset databases, keyed by country code (lazy-loaded from /public)
  const [presetDbs, setPresetDbs] = useState<Record<string, CountryDatabase>>({});
  const [starting, setStarting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // Create-a-club / create-a-player (setup-only state; both are spliced into the
  // chosen databases at start, so worldgen sees them as ordinary authored data).
  const [customClub, setCustomClub] = useState<CustomClub | null>(null);
  const [clubModalOpen, setClubModalOpen] = useState(false);
  const [customPlayers, setCustomPlayers] = useState<CustomPlayer[]>([]);
  /** null = closed, "new" = creating, otherwise the player being edited. */
  const [playerModal, setPlayerModal] = useState<CustomPlayer | "new" | null>(null);
  // The persistent library (v25): saved clubs/players the user can pull in.
  const library = useGame((s) => s.library);
  // The roster carried by a library club chosen as the created club — kept
  // separately because CustomClub itself has no roster field, and spliced onto
  // the created club's seed in effectiveDbFor.
  const [customClubRoster, setCustomClubRoster] = useState<PlayerSeed[] | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState<"clubs" | "players" | null>(null);

  const includedCodes = useMemo(
    () => Array.from(new Set([playableCountry, ...viewCountries])),
    [playableCountry, viewCountries]
  );

  /** A country's chosen depth, defaulting to what its database authors. */
  const depthFor = (code: string, authoredCount: number) => divisionDepths[code] ?? authoredCount;
  const setDepth = (code: string, depth: number) => setDivisionDepths((m) => ({ ...m, [code]: depth }));

  const choiceFor = (code: string): DbChoice => dbChoices[code] ?? initialChoice();

  /** Drop created players whose destination country is no longer valid. */
  const prunePlayers = (keptCodes: string[], invalidatedCode?: string) =>
    setCustomPlayers((list) =>
      list.filter((p) => keptCodes.includes(p.country) && p.country !== invalidatedCode)
    );

  // Load every preset that an included country resolves to, once. Presets are
  // immutable static assets, so a single fetch per country suffices. A country
  // whose default is preset-derived needs the asset for "default" too.
  useEffect(() => {
    for (const code of includedCodes) {
      const choice = choiceFor(code);
      const wanted =
        choice.source === "preset" || (choice.source === "default" && defaultNeedsPreset(code));
      if (!wanted || presetDbs[code]) continue;
      loadPreset(code)
        .then((db) => setPresetDbs((m) => ({ ...m, [code]: db })))
        .catch((err) => showToast(err instanceof Error ? err.message : "Couldn't load preset."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedCodes, dbChoices]);

  // The database that will actually be used for a country given its choice.
  const dbForChoice = (code: string): CountryDatabase | null => {
    const choice = choiceFor(code);
    if (choice.source === "custom") return choice.db;
    if (choice.source === "preset") return presetDbs[code] ?? null;
    const engine = defaultCountryDB(code);
    if (engine) return engine;
    return presetDbs[code] ? proceduralFromPreset(presetDbs[code]) : null;
  };

  // The database as worldgen will actually receive it: the chosen source with
  // the created club spliced into the top division and any created players
  // appended to their destination club's roster.
  const effectiveDbFor = (code: string): CountryDatabase | null => {
    const base = dbForChoice(code);
    if (!base) return null;
    const withClub = code === playableCountry && customClub !== null;
    const playersHere = customPlayers.filter((p) => p.country === code);
    if (!withClub && playersHere.length === 0) return base;
    const db = structuredClone(base);
    if (withClub && customClub) {
      const top = [...db.divisions].sort((a, b) => a.tier - b.tier)[0];
      if (top && customClub.replaceIndex < top.clubs.length) {
        const seed = customClubSeed(customClub);
        // A club pulled from the library carries an authored roster; CustomClub
        // itself has no roster field, so re-attach it here.
        if (customClubRoster && customClubRoster.length) seed.players = customClubRoster.map((p) => ({ ...p }));
        top.clubs[customClub.replaceIndex] = seed;
      }
    }
    for (const cp of playersHere) {
      const club = db.divisions.find((d) => d.id === cp.divisionId)?.clubs[cp.clubIndex];
      if (club) (club.players ??= []).push(customPlayerSeed(cp));
    }
    return db;
  };

  /** The explicit per-country databases worldgen will receive — anything but an
   * untouched engine default. Shared by the preview seed and `start()` so the
   * clubs previewed below are exactly the clubs the world is built with. */
  const resolveCountryDBs = (): Record<string, CountryDatabase> => {
    const out: Record<string, CountryDatabase> = {};
    for (const code of includedCodes) {
      const db = effectiveDbFor(code);
      if (!db) continue;
      const modified =
        (code === playableCountry && customClub !== null) || customPlayers.some((p) => p.country === code);
      if (choiceFor(code).source !== "default" || defaultNeedsPreset(code) || modified) out[code] = db;
    }
    return out;
  };

  // The seed generated divisions are built from. Club-independent by design, so
  // picking a club out of a generated tier never reshuffles that tier.
  const previewSeed = divisionSeed({
    playableCountry,
    viewCountries: viewCountries.filter((c) => c !== playableCountry),
    countryDBs: resolveCountryDBs(),
  });

  // The playable country's clubs, honoring its chosen database and the created
  // club. Null while a preset is still loading (the club grid shows a spinner
  // state then). `originalTopDiv` (pre-replacement) feeds the create-a-club
  // modal's "club to replace" list.
  const basePlayableDb = dbForChoice(playableCountry);
  const originalTopDiv = basePlayableDb ? [...basePlayableDb.divisions].sort((a, b) => a.tier - b.tier)[0] : null;
  const playableDb = effectiveDbFor(playableCountry);
  const authoredDivs = useMemo(
    () => (playableDb ? [...playableDb.divisions].sort((a, b) => a.tier - b.tier) : []),
    [playableDb]
  );
  const playableDepth = depthFor(playableCountry, authoredDivs.length);

  // The full ladder the world will actually build (v17): the tiers the database
  // authors, plus any deeper tiers generated exactly as worldgen generates them,
  // so the club list you pick from IS the club list you'll get. Generated tiers
  // key off the same preview seed for stability while the form is open.
  const previewLadder = useMemo(() => {
    const authored = authoredDivs.slice(0, playableDepth);
    if (!playableDb) return authored;
    const exclude = new Set(authoredDivs.flatMap((d) => d.clubs.map((c) => c.name)));
    const out = [...authored];
    for (let tier = authoredDivs.length + 1; tier <= playableDepth; tier++) {
      out.push({
        id: `${playableCountry}${tier}`,
        name: DEFAULT_TIER_NAMES[tier] ?? `Division ${tier}`,
        tier,
        clubs: generateDivisionClubs(previewSeed, playableCountry, tier, exclude),
      });
    }
    return out;
  }, [authoredDivs, playableDepth, playableCountry, playableDb, previewSeed]);

  // The division you'll start in — clamped in case the depth shrank under you.
  const startDiv = previewLadder[Math.min(startTier, previewLadder.length) - 1] ?? previewLadder[0] ?? null;
  const clubs = startDiv?.clubs ?? [];
  const playableChoice = choiceFor(playableCountry);
  const playableLoading =
    !presetDbs[playableCountry] &&
    (playableChoice.source === "preset" ||
      (playableChoice.source === "default" && defaultNeedsPreset(playableCountry)));

  const setChoice = (code: string, choice: DbChoice) => setDbChoices((m) => ({ ...m, [code]: choice }));

  const start = async () => {
    if (clubIndex === null || !managerName.trim() || starting || !startDiv) return;
    setStarting(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    // Anything but the untouched engine default must be passed as an explicit
    // DB — including a default modified by a created club or player, and the
    // preset-derived defaults (worldgen can't reconstruct those on its own).
    const countryDBs = resolveCountryDBs();
    await newGame({
      saveName: saveName.trim() || "My Legacy",
      managerName: managerName.trim(),
      // You manage in whichever tier you chose — not necessarily the top flight.
      userTeamId: teamIdFor(startDiv.id, clubIndex),
      playableCountry,
      viewCountries: viewCountries.filter((c) => c !== playableCountry),
      countryDBs,
      divisionDepths,
      divisionDepth: playableDepth,
      // Only send names the user actually typed; blanks keep the defaults.
      divisionNames: Object.fromEntries(
        Object.entries(divisionNames)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => [Number(k), v.trim()])
      ),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="display text-xs font-semibold tracking-widest text-faint">MANAGER NAME</span>
          <input
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            placeholder="Your name"
            className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="display text-xs font-semibold tracking-widest text-faint">SAVE NAME</span>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      {/* Step 1: country to manage in */}
      <div>
        <span className="display text-xs font-semibold tracking-widest text-faint">COUNTRY TO MANAGE IN</span>
        <p className="mb-2 mt-0.5 text-[11px] text-faint">
          You&apos;ll manage a club in this country. Pick how deep its pyramid runs below, then start in any tier of it —
          including a lower division, if you fancy the climb.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COUNTRY_OPTIONS.map((c) => (
            <button
              key={c.code}
              onClick={() => {
                setPlayableCountry(c.code);
                setClubIndex(null);
                setStartTier(1);
                setViewCountries((prev) => prev.filter((x) => x !== c.code));
                // The created club belongs to the previous country's top division.
                if (c.code !== playableCountry) setCustomClub(null);
                prunePlayers([c.code, ...viewCountries.filter((x) => x !== c.code)]);
              }}
              className={`flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors ${
                playableCountry === c.code ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
              }`}
            >
              <CountryFlag country={c.name} size={16} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-[10px] text-faint">
                  {c.hasPreset ? "Default or preset" : "Default database"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 1b: how deep the league pyramid runs, plus optional league names.
          Tiers the country's database doesn't author are generated. */}
      <div>
        <span className="display text-xs font-semibold tracking-widest text-faint">LEAGUE STRUCTURE</span>
        <p className="mb-2 mt-0.5 text-[11px] text-faint">
          How many divisions this country runs. Every tier plays out in full, with 3 up and 3 down between each — so you
          can climb from the bottom or fall a long way.
        </p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: MAX_DIVISION_DEPTH }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDepth(playableCountry, d);
                // Starting below the new floor is impossible — clamp back up.
                if (startTier > d) {
                  setStartTier(d);
                  setClubIndex(null);
                }
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                playableDepth === d ? "border-gold bg-hover text-ink" : "border-line text-faint hover:text-dim"
              }`}
            >
              {d} division{d === 1 ? "" : "s"}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: playableDepth }, (_, i) => i + 1).map((tier) => {
            const authored = [...(basePlayableDb?.divisions ?? [])].sort((a, b) => a.tier - b.tier)[tier - 1];
            const fallback = authored?.name ?? DEFAULT_TIER_NAMES[tier] ?? `Division ${tier}`;
            return (
              <label key={tier} className="flex items-center gap-2">
                <span className="display w-16 shrink-0 text-[11px] font-semibold tracking-wider text-faint">
                  TIER {tier}
                </span>
                <input
                  value={divisionNames[tier] ?? ""}
                  onChange={(e) => setDivisionNames((m) => ({ ...m, [tier]: e.target.value }))}
                  placeholder={fallback}
                  className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                />
                {!authored && (
                  <span className="shrink-0 text-[10px] text-faint" title="Clubs for this tier are generated">
                    generated
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Leave a name blank to use the default.</p>
      </div>

      {/* Step 1c: which tier you start in (v17). With a multi-division pyramid
          you may begin anywhere on the ladder, not just the top flight. */}
      {previewLadder.length > 1 && (
        <div>
          <span className="display text-xs font-semibold tracking-widest text-faint">DIVISION TO START IN</span>
          <p className="mb-2 mt-0.5 text-[11px] text-faint">
            Start lower down and earn your way up. Every division runs the real engine, so a promotion is a real
            promotion.
          </p>
          <div className="flex flex-wrap gap-2">
            {previewLadder.map((div, i) => (
              <button
                key={div.id}
                onClick={() => {
                  setStartTier(i + 1);
                  setClubIndex(null); // club indices are per-division
                  setCustomClub(null); // a created club replaces a top-flight side
                }}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  startTier === i + 1 ? "border-gold bg-hover text-ink" : "border-line text-faint hover:text-dim"
                }`}
              >
                {div.name}
                <span className="ml-1.5 text-[10px] text-faint">tier {i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: club within the chosen division — pick an existing club or
          create your own (which replaces one of them). */}
      <div>
        <div className="flex items-center justify-between">
          <span className="display text-xs font-semibold tracking-widest text-faint">
            CHOOSE YOUR CLUB — {startDiv?.name ?? ""}
          </span>
          {/* Create-a-club replaces a top-flight side, so it only applies when
              you're starting in tier 1. */}
          {!customClub && !playableLoading && startTier === 1 && (
            <div className="flex items-center gap-3">
              {library.clubs.length > 0 && (
                <button
                  onClick={() => setLibraryPickerOpen("clubs")}
                  className="text-[11px] text-gold hover:underline"
                >
                  ↧ From library
                </button>
              )}
              <button
                onClick={() => {
                  setCustomClubRoster(null); // a fresh manual club has no roster
                  setClubModalOpen(true);
                }}
                className="text-[11px] text-gold hover:underline"
              >
                ＋ Create your own club
              </button>
            </div>
          )}
        </div>
        {customClub && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-gold-lo/50 bg-surface px-3 py-2">
            <Crest colors={customClub.colors} short={customClub.short} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{customClub.name}</span>
            <span className="text-[11px] text-faint">
              replaces {originalTopDiv?.clubs[customClub.replaceIndex]?.name ?? "—"}
            </span>
            <button
              onClick={() => setClubModalOpen(true)}
              className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:text-ink"
            >
              Edit
            </button>
            <button
              onClick={() => {
                setCustomClub(null);
                setClubIndex(null);
              }}
              className="rounded border border-line px-2 py-1 text-[11px] text-faint hover:text-loss"
              title="Remove created club"
            >
              ✕
            </button>
          </div>
        )}
        {playableLoading ? (
          <div className="mt-2 rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-faint">
            Loading preset clubs…
          </div>
        ) : (
          <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {clubs.map((c, i) => {
              const isYours = customClub !== null && i === customClub.replaceIndex;
              return (
                <button
                  key={c.short + i}
                  onClick={() => setClubIndex(i)}
                  className={`flex items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
                    clubIndex === i ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
                  }`}
                >
                  <Crest colors={c.colors} short={c.short} size={30} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-faint">
                      Reputation {c.rep}
                      {isYours && <span className="display ml-1.5 font-semibold text-gold">YOUR CREATION</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 3: other countries to include (view-only) */}
      <div>
        <span className="display text-xs font-semibold tracking-widest text-faint">
          OTHER COUNTRIES TO INCLUDE (view-only, shopping allowed)
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {COUNTRY_OPTIONS.filter((c) => c.code !== playableCountry).map((c) => {
            const on = viewCountries.includes(c.code);
            return (
              <button
                key={c.code}
                onClick={() => {
                  setViewCountries(on ? viewCountries.filter((id) => id !== c.code) : [...viewCountries, c.code]);
                  if (on) prunePlayers(includedCodes.filter((x) => x !== c.code));
                }}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                  on ? "border-gold-lo bg-hover text-ink" : "border-line text-faint hover:text-dim"
                }`}
              >
                <CountryFlag country={c.name} size={12} />
                {on ? "✓ " : ""}
                {c.name}
              </button>
            );
          })}
        </div>

        {/* Per-country pyramid depth (v17): each included country runs its own
            number of divisions — 2 in England, 3 in Germany, 1 in France. */}
        {viewCountries.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] text-faint">
              Divisions per country. Tiers beyond what a country&apos;s database ships are generated.
            </p>
            {viewCountries.map((code) => {
              const db = dbForChoice(code);
              const authoredCount = db?.divisions.length ?? 1;
              const current = depthFor(code, authoredCount);
              const name = OPTION_MAP[code]?.name ?? code;
              return (
                <div key={code} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5">
                  <CountryFlag country={name} size={12} />
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <div className="flex items-center gap-1 rounded border border-line/70 p-0.5">
                    {Array.from({ length: MAX_DIVISION_DEPTH }, (_, i) => i + 1).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDepth(code, d)}
                        className={`rounded px-2 py-1 text-[11px] transition-colors ${
                          current === d ? "bg-hover text-ink ring-1 ring-gold-lo/50" : "text-faint hover:text-dim"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 4: per-country database (default, preset, or custom upload) */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="display text-xs font-semibold tracking-widest text-faint">DATABASES</span>
          <button onClick={() => setGuideOpen(true)} className="text-[11px] text-gold hover:underline">
            Custom database guide →
          </button>
        </div>
        <div className="space-y-2">
          {includedCodes.map((code) => (
            <CountryDbRow
              key={code}
              code={code}
              choice={choiceFor(code)}
              onChange={(choice) => {
                setChoice(code, choice);
                if (code === playableCountry) {
                  setClubIndex(null);
                  setCustomClub(null); // replaceIndex refers to the old club list
                }
                // Division ids / club indices may differ in the new database.
                prunePlayers(includedCodes, code);
              }}
              onError={showToast}
            />
          ))}
        </div>
      </div>

      {/* Step 5 (optional): created players, injected into their destination
          club's roster at world build. */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="display text-xs font-semibold tracking-widest text-faint">CREATE-A-PLAYER (OPTIONAL)</span>
          <div className="flex items-center gap-3">
            {library.players.length > 0 && (
              <button onClick={() => setLibraryPickerOpen("players")} className="text-[11px] text-gold hover:underline">
                ↧ From library
              </button>
            )}
            <button onClick={() => setPlayerModal("new")} className="text-[11px] text-gold hover:underline">
              ＋ Create a player
            </button>
          </div>
        </div>
        {customPlayers.length === 0 ? (
          <p className="text-[11px] text-faint">
            Design your own players and place them at any included club — yours or a rival&apos;s.
          </p>
        ) : (
          <div className="space-y-2">
            {customPlayers.map((p) => {
              const db = effectiveDbFor(p.country);
              const clubName =
                db?.divisions.find((d) => d.id === p.divisionId)?.clubs[p.clubIndex]?.name ?? "Unknown club";
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <Flag nat={p.nationality} size={12} />
                  <PosBadge pos={p.positions[0]} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  <Ovr value={overallFromAttrs(p.attrs, p.positions[0])} size="sm" />
                  <span className="text-[11px] text-faint">→ {clubName}</span>
                  <button
                    onClick={() => setPlayerModal(p)}
                    className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setCustomPlayers((list) => list.filter((x) => x.id !== p.id))}
                    className="rounded border border-line px-2 py-1 text-[11px] text-faint hover:text-loss"
                    title="Remove created player"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-between pt-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <GoldButton onClick={start} disabled={clubIndex === null || !managerName.trim() || starting}>
          {starting ? "BUILDING WORLD…" : "START LEGACY"}
        </GoldButton>
      </div>

      {guideOpen && <CustomDbGuide onClose={() => setGuideOpen(false)} />}
      {clubModalOpen && originalTopDiv && (
        <CreateClubModal
          clubs={originalTopDiv.clubs}
          initial={customClub}
          onSave={(club) => {
            setCustomClub(club);
            setClubIndex(club.replaceIndex); // you manage the club you created
            setClubModalOpen(false);
          }}
          onClose={() => setClubModalOpen(false)}
        />
      )}
      {playerModal !== null && (
        <CreatePlayerModal
          countries={includedCodes.map((code) => ({ code, name: OPTION_MAP[code]?.name ?? code }))}
          dbFor={effectiveDbFor}
          natOptions={NAT_OPTIONS}
          initial={playerModal === "new" ? null : playerModal}
          onSave={(p) => {
            setCustomPlayers((list) =>
              playerModal === "new" ? [...list, p] : list.map((x) => (x.id === p.id ? p : x))
            );
            setPlayerModal(null);
          }}
          onClose={() => setPlayerModal(null)}
        />
      )}

      {/* Library picker (v25): pull a saved club or player in, then confirm its
          placement in the normal create-a-club / create-a-player modal. */}
      {libraryPickerOpen === "clubs" && (
        <LibraryPicker
          title="Add a Club From Your Library"
          empty="No saved clubs in your library."
          items={library.clubs.map((c) => ({
            id: c.id,
            crest: { colors: c.colors, short: c.short },
            title: c.name,
            sub: `Rep ${c.rep} · Squad ${c.squadQuality ?? c.rep}${c.players?.length ? ` · ${c.players.length} authored` : ""}`,
          }))}
          onPick={(id) => {
            const lc = library.clubs.find((c) => c.id === id);
            if (!lc) return;
            const seed = libraryClubToSeed(lc);
            setCustomClubRoster(seed.players ?? null);
            // Prefill the create-a-club modal; the user confirms which club to
            // replace (defaulting to the current pick or the first slot).
            setCustomClub({
              name: lc.name,
              short: lc.short,
              colors: lc.colors,
              stadium: lc.stadium,
              rep: lc.rep,
              squadQuality: lc.squadQuality ?? lc.rep,
              replaceIndex: clubIndex ?? 0,
            });
            setLibraryPickerOpen(null);
            setClubModalOpen(true);
          }}
          onClose={() => setLibraryPickerOpen(null)}
        />
      )}
      {libraryPickerOpen === "players" && (
        <LibraryPicker
          title="Add a Player From Your Library"
          empty="No saved players in your library."
          items={library.players.map((p) => ({
            id: p.id,
            flag: p.nationality,
            pos: p.positions[0],
            title: p.name,
            ovr: overallFromAttrs(p.attrs, p.positions[0]),
            sub: `Age ${p.age} · Potential ${p.potential}`,
          }))}
          onPick={(id) => {
            const lp = library.players.find((p) => p.id === id);
            if (!lp) return;
            // Default destination: the playable country's first authored division
            // and first club — the user adjusts it in the create-a-player modal.
            const destDb = effectiveDbFor(playableCountry);
            const topDiv = destDb ? [...destDb.divisions].sort((a, b) => a.tier - b.tier)[0] : null;
            setPlayerModal({
              id: `cp${Date.now().toString(36)}`,
              name: lp.name,
              age: lp.age,
              nationality: lp.nationality,
              positions: [...lp.positions],
              attrs: { ...lp.attrs },
              potential: lp.potential,
              archetypeId: lp.archetypeId,
              traits: [...lp.traits],
              country: playableCountry,
              divisionId: topDiv?.id ?? "",
              clubIndex: 0,
            });
            setLibraryPickerOpen(null);
          }}
          onClose={() => setLibraryPickerOpen(null)}
        />
      )}
    </div>
  );
}

/** A simple chooser over saved library entries (clubs or players). Picking one
 * hands its id back so the caller can prefill the matching create modal. */
function LibraryPicker({
  title,
  empty,
  items,
  onPick,
  onClose,
}: {
  title: string;
  empty: string;
  items: {
    id: string;
    title: string;
    sub: string;
    crest?: { colors: [string, string]; short: string };
    flag?: string;
    pos?: string;
    ovr?: number;
  }[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">{empty}</p>
      ) : (
        <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto pr-1">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onPick(it.id)}
              className="flex items-center gap-2.5 rounded-md border border-line bg-surface p-2.5 text-left transition-colors hover:bg-hover"
            >
              {it.crest && <Crest colors={it.crest.colors} short={it.crest.short} size={30} />}
              {it.flag && <Flag nat={it.flag} size={13} />}
              {it.pos && <PosBadge pos={it.pos} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="text-[11px] text-faint">{it.sub}</div>
              </div>
              {it.ovr !== undefined && <Ovr value={it.ovr} size="sm" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Nationality codes offered by create-a-player: every name pool plus every
 * selectable country. */
const NAT_OPTIONS: string[] = Array.from(
  new Set([...NAME_POOLS.map((p) => p.nat), ...COUNTRY_OPTIONS.map((o) => o.code)])
).sort();

/** One country's database picker: choose the default (procedural for engine
 * countries; real clubs + generated squads for preset-only ones) or the bundled
 * preset, or upload + validate a custom JSON file (with a Download-template
 * shortcut). */
function CountryDbRow({
  code,
  choice,
  onChange,
  onError,
}: {
  code: string;
  choice: DbChoice;
  onChange: (choice: DbChoice) => void;
  onError: (msg: string) => void;
}) {
  const option = OPTION_MAP[code];
  const country = getCountry(code);
  const preset = getPreset(code);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = option?.name ?? country?.name ?? preset?.name ?? code;

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = validateCountryDB(parsed);
      if (!result.ok || !result.db) {
        onError(`Custom database invalid: ${result.errors[0] ?? "unknown error"}`);
        return;
      }
      onChange({ source: "custom", db: result.db, fileName: file.name });
    } catch {
      onError("That file isn't valid JSON.");
    }
  };

  // A small segmented control lets you flip between the available built-in
  // sources; "Upload custom" is a separate action that captures a file.
  const segBtn = (active: boolean, label: string, onClick: () => void, title?: string) => (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-2 py-1 text-[11px] transition-colors ${
        active ? "bg-hover text-ink ring-1 ring-gold-lo/50" : "text-faint hover:text-dim"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <CountryFlag country={name} size={14} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>

      {choice.source === "custom" ? (
        <span className="flex items-center gap-1.5 text-[11px] text-win">
          ✓ {choice.fileName}
          <button
            onClick={() => onChange(initialChoice())}
            className="text-faint hover:text-loss"
            title="Discard custom file"
          >
            ✕
          </button>
        </span>
      ) : (
        <div className="flex items-center gap-1 rounded border border-line/70 p-0.5">
          {segBtn(
            choice.source === "default",
            "Default",
            () => onChange({ source: "default" }),
            option?.hasEngineDefault
              ? "Procedural default database"
              : "Real clubs with generated squads"
          )}
          {preset &&
            segBtn(choice.source === "preset", "Preset", () => onChange({ source: "preset" }), preset.blurb)}
        </div>
      )}

      <button
        onClick={() => downloadTemplate(code)}
        className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:text-ink"
        title="Download a JSON template for this country"
      >
        Template
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        className="rounded border border-gold-lo/50 px-2 py-1 text-[11px] text-gold hover:bg-hover"
      >
        Upload custom
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function downloadTemplate(code: string) {
  const blob = new Blob([countryDBTemplate(code)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code}-country-db-template.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** In-app documentation for the custom-database JSON format. */
function CustomDbGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Custom Database Guide" onClose={onClose}>
      <div className="space-y-3 text-[13px] leading-relaxed text-dim">
        <p>
          A country database is a JSON file describing one country&apos;s leagues, clubs and (optionally) players. Upload
          one to replace that country&apos;s default world — build your own teams, custom rosters and leagues.
        </p>
        <p>
          Prefer a ready-made world? Several countries ship a <b className="text-ink">Preset</b> — a real-world-flavored
          database you can pick right in the Databases list, no file needed.
        </p>
        <div>
          <div className="display text-xs font-semibold uppercase tracking-widest text-faint">Top-level shape</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <code className="text-gold">schema</code> — must be exactly{" "}
              <code className="text-ink">&quot;{COUNTRY_DB_SCHEMA}&quot;</code>
            </li>
            <li>
              <code className="text-gold">code</code>, <code className="text-gold">name</code>,{" "}
              <code className="text-gold">nat</code> — country code, display name, and dominant nationality code
            </li>
            <li>
              <code className="text-gold">divisions[]</code> — each has <code>id</code>, <code>name</code>,{" "}
              <code>tier</code> (1 = top), and <code>clubs[]</code> (an even number, ≥ 4)
            </li>
          </ul>
        </div>
        <div>
          <div className="display text-xs font-semibold uppercase tracking-widest text-faint">Each club</div>
          <p className="mt-1">
            <code className="text-gold">name</code>, <code className="text-gold">short</code> (2–4 letters),{" "}
            <code className="text-gold">colors</code> (two hex strings), <code className="text-gold">rep</code> (1–100),{" "}
            <code className="text-gold">stadium</code>. An optional <code className="text-gold">players[]</code> array
            gives a hand-authored roster; omit it and the squad is generated for you. An optional{" "}
            <code className="text-gold">squadQuality</code> (1–100) sets the generated squad&apos;s strength
            independently of <code>rep</code>.
          </p>
        </div>
        <div>
          <div className="display text-xs font-semibold uppercase tracking-widest text-faint">Each player (optional)</div>
          <p className="mt-1">
            <code className="text-gold">name</code>, <code className="text-gold">positions</code> (e.g.{" "}
            <code>[&quot;ST&quot;]</code>), <code className="text-gold">overall</code> (40–99), plus optional{" "}
            <code>age</code>, <code>nationality</code>, <code>potential</code>, <code>archetypeId</code>,{" "}
            <code>traits</code>. Missing fields are filled automatically.
          </p>
        </div>
        <p className="text-[12px] text-faint">
          Download a <b className="text-ink">Template</b> next to any country to get a working starter file, then edit and
          re-upload it. Invalid files are rejected with a message telling you what to fix.
        </p>
        <div className="flex justify-end pt-1">
          <GhostButton onClick={onClose}>Got it</GhostButton>
        </div>
      </div>
    </Modal>
  );
}
