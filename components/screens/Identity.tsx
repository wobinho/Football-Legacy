"use client";

// Club → Identity (v1.96; other clubs and bulk editing v1.97).
//
// Three modes, and the split is the point:
//
//   MY CLUB   — the manager's own crest and four kits, in the full creators.
//   ONE CLUB  — the same creators pointed at any club in the world.
//   A DIVISION— every club in one league as a row of dropdowns.
//
// The first two share every control, so "edit another club" is genuinely the
// same editor rather than a lesser one. The third is a different tool for a
// different job (see BulkIdentityEditor) and deliberately not the creators
// twenty times over.
//
// The single-club modes edit a DRAFT and commit on Save. A live-committing
// editor would autosave the world on every drag of a colour wheel, and would
// leave a manager who was only exploring with a crest he didn't choose. The
// bulk mode commits per row, for the reason given in that file.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import { badgeFor, type BadgeSpec } from "@/lib/visual/badge";
import { kitsFor, pickKitsForFixture, type KitSet } from "@/lib/visual/kit";
import { BadgeCreator } from "../visual/BadgeCreator";
import { KitCreator } from "../visual/KitCreator";
import { BulkIdentityEditor } from "../visual/BulkIdentityEditor";
import { ClubKit } from "../visual/ClubKit";
import { ClubBadge } from "../visual/ClubBadge";
import { Card, GhostButton, GoldButton, Section, Select, Tabs } from "../ui";

type IdTab = "badge" | "kits";
type Mode = "mine" | "other" | "bulk";

export default function IdentityTab() {
  const game = useGame((s) => s.game);
  const save = useGame((s) => s.setClubIdentity);
  // The bulk rows read `club.badge`/`club.kits` off the live state object, which
  // the store mutates in place — so this screen has to re-render on `rev` or a
  // committed row would keep drawing what it looked like before the change.
  const rev = useGame((s) => s.rev);
  const [tab, setTab] = useState<IdTab>("badge");
  const [mode, setMode] = useState<Mode>("mine");
  // Which club the "other" mode is pointed at, and which league the bulk mode
  // is showing. Kept per-mode so switching back and forth doesn't lose the
  // place — a manager re-branding a league steps out to check one crest in the
  // full creator and expects his division still selected when he returns.
  const [otherId, setOtherId] = useState<string>("");
  const [leagueId, setLeagueId] = useState<string>("");

  // The draft. Cleared whenever the edited club changes — a half-finished crest
  // must never be committed onto a different club than the one it was drawn for.
  const [badge, setBadge] = useState<BadgeSpec | null>(null);
  const [kits, setKits] = useState<KitSet | null>(null);

  const userTeamId = game?.userTeamId ?? "";
  const editingId = mode === "other" ? otherId || userTeamId : userTeamId;
  const club = game ? game.teams[editingId] : null;

  // `rev` is in the deps for the same reason as above: `club` is the same object
  // identity before and after a commit, so `club` alone never invalidates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveBadge = useMemo(() => badgeFor(club), [club, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveKits = useMemo(() => kitsFor(club), [club, rev]);

  // Every club in the world, grouped by league, for the "other" picker. Sorted
  // the way the rest of the app sorts leagues: the manager's own country first,
  // then by tier — every top flight is `tier: 1`, so tier alone would bury his
  // own division behind whichever foreign one sorts first (v1.89's rule).
  const { clubOptions, leagueOptions } = useMemo(() => {
    if (!game) return { clubOptions: [], leagueOptions: [] };
    const home = game.leagues[game.teams[game.userTeamId]?.leagueId ?? ""]?.country;
    const leagues = Object.values(game.leagues).sort(
      (a, b) =>
        Number(b.country === home) - Number(a.country === home) ||
        a.country.localeCompare(b.country) ||
        a.tier - b.tier
    );
    return {
      leagueOptions: leagues.map((l) => ({
        value: l.id,
        label: `${l.name} · ${l.country}`,
      })),
      clubOptions: leagues.flatMap((l) =>
        l.teamIds
          .map((id) => game.teams[id])
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({
            value: t.id,
            // Grouped by division rather than flattened: a world is ~800 clubs
            // and `Select` already renders consecutive same-group options under
            // one sticky heading (v1.77), which is the difference between a
            // picker and a wall.
            group: `${l.name} · ${l.country}`,
            label: `${t.name}${t.id === game.userTeamId ? " (you)" : ""}`,
            hint: t.badge || t.kits ? "Edited" : undefined,
          }))
      ),
    };
  }, [game]);

  const bulkClubs = useMemo(() => {
    if (!game || !leagueId) return [];
    return (game.leagues[leagueId]?.teamIds ?? [])
      .map((id) => game.teams[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, leagueId, rev]);

  if (!game || !club) return null;

  const draftBadge = badge ?? liveBadge;
  const draftKits = kits ?? liveKits;
  const dirty = badge !== null || kits !== null;

  // `allowAny` is passed on every write from this screen, including the
  // manager's own club: the screen IS the cosmetic authority, and threading the
  // flag conditionally would only mean the same call site sometimes asked for
  // permission it already had. The ownership rule still lives in
  // lib/visual/identity.ts for every other caller.
  const commit = () => {
    save(
      club.id,
      { ...(badge ? { badge } : {}), ...(kits ? { kits } : {}) },
      { allowAny: true }
    );
    setBadge(null);
    setKits(null);
  };

  const revert = () => {
    setBadge(null);
    setKits(null);
  };

  const switchTo = (next: Mode) => {
    revert();
    setMode(next);
  };

  // What the club would actually wear away at a club playing in its own home
  // colours — the one question a kit designer wants answered and the one a
  // static preview can't show.
  const fixture = pickKitsForFixture(liveKits, draftKits);

  return (
    <div>
      <Section
        title="Club Identity"
        right={
          mode === "bulk" ? (
            <span className="text-[11px] text-faint">Changes save as you make them</span>
          ) : (
            <div className="flex items-center gap-2">
              {dirty && <GhostButton onClick={revert}>Discard</GhostButton>}
              <GoldButton onClick={commit} disabled={!dirty} title={dirty ? undefined : "Nothing has changed yet"}>
                Save identity
              </GoldButton>
            </div>
          )
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Tabs
            tabs={[
              { id: "mine", label: "My club" },
              { id: "other", label: "Edit other clubs" },
              { id: "bulk", label: "Bulk by division" },
            ]}
            active={mode}
            onChange={switchTo}
          />
        </div>

        {mode === "other" && (
          <Card className="mb-4 p-3">
            <div className="display mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">
              Club
            </div>
            <div className="max-w-md">
              <Select
                value={editingId}
                options={clubOptions}
                ariaLabel="Club to edit"
                onChange={(v) => {
                  // Drop the draft: it was drawn for the previous club.
                  revert();
                  setOtherId(v);
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-dim">
              Badges and kits are cosmetic — nothing in the simulation reads them, so re-branding a rival
              changes no result. Clearing an edit puts a club back to the crest its own name and colours generate.
            </p>
          </Card>
        )}

        {mode === "bulk" ? (
          <>
            <Card className="mb-4 p-3">
              <div className="display mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">
                Division
              </div>
              <div className="max-w-md">
                <Select
                  value={leagueId}
                  options={leagueOptions}
                  placeholder="Choose a division…"
                  ariaLabel="Division to edit"
                  onChange={setLeagueId}
                />
              </div>
              {leagueId && (
                <p className="mt-2 text-[11px] text-dim">
                  {bulkClubs.length} clubs. Every change is saved immediately — use the full editors under
                  “Edit other clubs” when one crest deserves the colour wheel.
                </p>
              )}
            </Card>

            {leagueId ? (
              <Card className="overflow-x-auto">
                <BulkIdentityEditor
                  clubs={bulkClubs}
                  rev={rev}
                  onBadge={(id, spec) => save(id, { badge: spec }, { allowAny: true })}
                  onKits={(id, set) => save(id, { kits: set }, { allowAny: true })}
                  onReset={(id) => save(id, { badge: undefined, kits: undefined }, { allowAny: true })}
                />
              </Card>
            ) : (
              <Card className="p-6 text-center text-sm text-faint">
                Pick a division to edit every club in it at once.
              </Card>
            )}
          </>
        ) : (
          <>
            <Card className="mb-4 p-3">
              <div className="flex flex-wrap items-center gap-4">
                <ClubBadge spec={draftBadge} size={54} />
                <div className="min-w-0 flex-1">
                  <div className="display truncate text-lg font-semibold">{club.name}</div>
                  <div className="text-[11px] text-faint">
                    {club.stadium} · {dirty ? "Unsaved changes" : club.badge || club.kits ? "Saved" : "Generated"}
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  {(["home", "away", "third", "gk"] as const).map((slot) => (
                    <div key={slot} className="text-center">
                      <ClubKit spec={draftKits[slot]} size={34} badge={draftBadge} />
                      <div className="display mt-1 text-[9px] uppercase tracking-wider text-faint">
                        {slot === "gk" ? "GK" : slot}
                      </div>
                    </div>
                  ))}
                </div>
                {(club.badge || club.kits) && !dirty && (
                  <GhostButton
                    title="Discard the authored crest and kits for this club"
                    onClick={() => save(club.id, { badge: undefined, kits: undefined }, { allowAny: true })}
                  >
                    Reset to generated
                  </GhostButton>
                )}
              </div>
            </Card>

            <Tabs
              tabs={[
                { id: "badge", label: "Badge" },
                { id: "kits", label: "Kits" },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === "badge" ? (
              <BadgeCreator
                key={club.id}
                value={draftBadge}
                onChange={setBadge}
                club={{ name: club.name, short: club.short, colors: club.colors }}
              />
            ) : (
              <>
                <KitCreator
                  key={club.id}
                  value={draftKits}
                  onChange={setKits}
                  badge={draftBadge}
                  club={{ name: club.name, short: club.short, colors: club.colors }}
                />
                <Card className="mt-4 p-3">
                  <div className="display mb-2 text-[11px] font-semibold tracking-widest text-gold">
                    AT A CLUB IN YOUR OWN COLOURS
                  </div>
                  <div className="flex items-center gap-5">
                    <div className="text-center">
                      <ClubKit spec={liveKits.home} size={52} badge={liveBadge} />
                      <div className="display mt-1 text-[9px] uppercase tracking-wider text-faint">Them</div>
                    </div>
                    <div className="text-center">
                      <ClubKit spec={draftKits[fixture.awayKit]} size={52} badge={draftBadge} />
                      <div className="display mt-1 text-[9px] uppercase tracking-wider text-faint">
                        You ({fixture.awayKit})
                      </div>
                    </div>
                    <p className="flex-1 text-[11px] text-dim">
                      {fixture.forcedClash
                        ? "None of your three change kits clears a side in these colours — the third shirt is worn anyway. Give one of them a colour further from your home shirt."
                        : `Your ${fixture.awayKit === "gk" ? "keeper" : fixture.awayKit} shirt is the first that reads clearly against them. The game picks it the same way on matchday.`}
                    </p>
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
