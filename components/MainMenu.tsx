"use client";

// Main menu: continue a save, start a new legacy, or import a JSON save.

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import { COUNTRIES, getCountry } from "@/lib/config/countries";
import { PRESETS, getPreset, loadPreset } from "@/lib/config/presets";
import {
  COUNTRY_DB_SCHEMA,
  countryDBTemplate,
  defaultCountryDB,
  validateCountryDB,
  type CountryDatabase,
} from "@/lib/database";
import { teamIdFor } from "@/lib/worldgen";
import { storedKey } from "@/lib/auth";
import { CountryFlag, Crest, GoldButton, GhostButton, Modal } from "./ui";

export default function MainMenu() {
  const [mode, setMode] = useState<"menu" | "new">("menu");
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
      {mode === "menu" ? <SaveList onNew={() => setMode("new")} /> : <NewGameForm onBack={() => setMode("menu")} />}
    </div>
  );
}

function SaveList({ onNew }: { onNew: () => void }) {
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
      <div className="flex justify-center gap-3 pt-4">
        <GoldButton onClick={onNew}>NEW LEGACY</GoldButton>
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
// validated upload. Countries that ship no procedural default (preset-only, e.g.
// USA) can never carry `{ source: "default" }` — their choice is preset/custom.
type DbChoice =
  | { source: "default" }
  | { source: "preset" }
  | { source: "custom"; db: CountryDatabase; fileName: string };

/** A selectable country in the setup form: a code + display name, plus whether it
 * has a built-in procedural default and/or a bundled preset. Merges the engine's
 * default countries with any preset-only countries (Portugal, Türkiye, USA…). */
interface CountryOption {
  code: string;
  name: string;
  hasDefault: boolean;
  hasPreset: boolean;
}

const COUNTRY_OPTIONS: CountryOption[] = (() => {
  const byCode = new Map<string, CountryOption>();
  for (const c of COUNTRIES) byCode.set(c.code, { code: c.code, name: c.name, hasDefault: true, hasPreset: false });
  for (const p of PRESETS) {
    const existing = byCode.get(p.code);
    if (existing) existing.hasPreset = true;
    else byCode.set(p.code, { code: p.code, name: p.name, hasDefault: false, hasPreset: true });
  }
  return Array.from(byCode.values());
})();

const OPTION_MAP: Record<string, CountryOption> = Object.fromEntries(COUNTRY_OPTIONS.map((o) => [o.code, o]));

/** The default choice for a country: its procedural default if it has one, else
 * its preset (preset-only countries have no valid "default"). */
function initialChoice(code: string): DbChoice {
  return OPTION_MAP[code]?.hasDefault ? { source: "default" } : { source: "preset" };
}

function NewGameForm({ onBack }: { onBack: () => void }) {
  const newGame = useGame((s) => s.newGame);
  const showToast = useGame((s) => s.showToast);
  const [managerName, setManagerName] = useState("");
  const [saveName, setSaveName] = useState("My Legacy");
  const [playableCountry, setPlayableCountry] = useState<string>("ENG");
  const [clubIndex, setClubIndex] = useState<number | null>(null);
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

  const includedCodes = useMemo(
    () => Array.from(new Set([playableCountry, ...viewCountries])),
    [playableCountry, viewCountries]
  );

  const choiceFor = (code: string): DbChoice => dbChoices[code] ?? initialChoice(code);

  // Load every preset that an included country resolves to, once. Presets are
  // immutable static assets, so a single fetch per country suffices.
  useEffect(() => {
    for (const code of includedCodes) {
      const choice = choiceFor(code);
      if (choice.source !== "preset" || presetDbs[code]) continue;
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
    return defaultCountryDB(code);
  };

  // The playable country's top division clubs, honoring its chosen database. Null
  // while a preset is still loading (the club grid shows a spinner state then).
  const playableDb = dbForChoice(playableCountry);
  const topDiv = playableDb ? [...playableDb.divisions].sort((a, b) => a.tier - b.tier)[0] : null;
  const clubs = topDiv?.clubs ?? [];
  const playableLoading = choiceFor(playableCountry).source === "preset" && !presetDbs[playableCountry];

  const setChoice = (code: string, choice: DbChoice) => setDbChoices((m) => ({ ...m, [code]: choice }));

  const start = async () => {
    if (clubIndex === null || !managerName.trim() || starting || !topDiv) return;
    setStarting(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    // Anything but the procedural default must be passed as an explicit DB.
    const countryDBs: Record<string, CountryDatabase> = {};
    for (const code of includedCodes) {
      const db = dbForChoice(code);
      const choice = choiceFor(code);
      if (choice.source !== "default" && db) countryDBs[code] = db;
    }
    await newGame({
      saveName: saveName.trim() || "My Legacy",
      managerName: managerName.trim(),
      userTeamId: teamIdFor(topDiv.id, clubIndex),
      playableCountry,
      viewCountries: viewCountries.filter((c) => c !== playableCountry),
      countryDBs,
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
          You&apos;ll manage a club in this country&apos;s top division. Its lower division runs as a sim until you&apos;re
          promoted or relegated between them.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COUNTRY_OPTIONS.map((c) => (
            <button
              key={c.code}
              onClick={() => {
                setPlayableCountry(c.code);
                setClubIndex(null);
                setViewCountries((prev) => prev.filter((x) => x !== c.code));
              }}
              className={`flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors ${
                playableCountry === c.code ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
              }`}
            >
              <CountryFlag country={c.name} size={16} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-[10px] text-faint">
                  {c.hasPreset && !c.hasDefault ? "Preset database" : c.hasPreset ? "Default or preset" : "Default database"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: club within the top division */}
      <div>
        <span className="display text-xs font-semibold tracking-widest text-faint">
          CHOOSE YOUR CLUB — {topDiv?.name ?? ""}
        </span>
        {playableLoading ? (
          <div className="mt-2 rounded-md border border-line bg-surface px-3 py-6 text-center text-xs text-faint">
            Loading preset clubs…
          </div>
        ) : (
          <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {clubs.map((c, i) => (
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
                  <div className="text-[11px] text-faint">Reputation {c.rep}</div>
                </div>
              </button>
            ))}
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
                onClick={() =>
                  setViewCountries(on ? viewCountries.filter((id) => id !== c.code) : [...viewCountries, c.code])
                }
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
                if (code === playableCountry) setClubIndex(null);
              }}
              onError={showToast}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <GhostButton onClick={onBack}>Back</GhostButton>
        <GoldButton onClick={start} disabled={clubIndex === null || !managerName.trim() || starting}>
          {starting ? "BUILDING WORLD…" : "START LEGACY"}
        </GoldButton>
      </div>

      {guideOpen && <CustomDbGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

/** One country's database picker: choose the procedural default (when available)
 * or the bundled preset, or upload + validate a custom JSON file (with a
 * Download-template shortcut). Preset-only countries omit the default option. */
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
            onClick={() => onChange(initialChoice(code))}
            className="text-faint hover:text-loss"
            title="Discard custom file"
          >
            ✕
          </button>
        </span>
      ) : (
        <div className="flex items-center gap-1 rounded border border-line/70 p-0.5">
          {option?.hasDefault &&
            segBtn(choice.source === "default", "Default", () => onChange({ source: "default" }), "Procedural default database")}
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
            gives a hand-authored roster; omit it and the squad is generated for you.
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
