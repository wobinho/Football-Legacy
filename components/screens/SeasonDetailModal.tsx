"use client";

// Season detail (§13, v21) — the museum's exhibit view.
//
// Every season summary already stores its full final tables, per-division top
// scorers, award winners and record transfers; until now the History tab showed
// only a four-line précis of each. This opens one season up properly: the table
// as it finished, who won what, and the money that moved.
//
// Everything rendered here comes from the stored `SeasonSummary`, never from
// live state — a table from season 3 must read as it did in season 3, not as
// re-derived from clubs that have since been promoted, relegated or renamed.
// The one exception is club crests/colours, which are cosmetic and looked up
// live so a season's table still looks like the rest of the game.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { AwardWinner, GameState, SeasonSummary } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { ACCOLADE_META } from "@/lib/accolades";
import { Card, Crest, Flag, Modal, PosBadge } from "../ui";

/** A club badge looked up live by id (cosmetic — see the file header), or null
 * when the id is unknown/absent (free agency, released, a pruned club). */
function TeamCrest({ game, teamId, size = 16 }: { game: GameState; teamId?: string; size?: number }) {
  const t = teamId ? game.teams[teamId] : undefined;
  if (!t) return null;
  return <Crest colors={t.colors} short={t.short} size={size} />;
}

/** One club's move — badge plus name, under whichever division heading it
 * belongs to. */
function MoveRow({ game, name, id, arrow, tone }: { game: GameState; name: string; id?: string; arrow: string; tone: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[13px] ${tone}`}>
      <span aria-hidden className="shrink-0">
        {arrow}
      </span>
      <TeamCrest game={game} teamId={id} size={16} />
      <span className="truncate">{name}</span>
    </div>
  );
}

/**
 * A promotion/relegation list, GROUPED BY DIVISION (v1.5). With a two- or
 * three-tier pyramid a single flat list can't say which division a club climbed
 * out of or dropped into, which is the whole story of a lower-tier season — so
 * each group is headed by the league the clubs came FROM ("Championship ▲"),
 * with the destination named alongside.
 *
 * Grouping needs the summary's `from`/`to` league ids; summaries written before
 * v1.5 (and pre-v1.44 ones with no club ids at all) don't carry them, so both
 * older shapes fall back to the ungrouped rendering they always had.
 */
function MoveList({
  game,
  names,
  ids,
  from,
  to,
  arrow,
  tone,
}: {
  game: GameState;
  names: string[];
  ids?: string[];
  from?: string[];
  to?: string[];
  arrow: string;
  tone: string;
}) {
  if (!ids?.length) {
    return (
      <div className={`mt-0.5 text-[13px] ${tone}`}>
        {arrow} {names.join(", ")}
      </div>
    );
  }

  // Pre-v1.5 summary, or a ladder shallow enough that every move shares one
  // division — a heading would just repeat itself, so render the plain list.
  const grouped = from?.length === names.length;
  const distinctFrom = grouped ? new Set(from) : new Set<string>();
  if (!grouped || distinctFrom.size <= 1) {
    return (
      <div className="mt-1 space-y-1">
        {names.map((name, i) => (
          <MoveRow key={`${name}-${i}`} game={game} name={name} id={ids[i]} arrow={arrow} tone={tone} />
        ))}
      </div>
    );
  }

  // Group in first-seen order — applyPromotionRelegation walks the ladder
  // top-first, so the divisions come out in pyramid order for free.
  const groups: { leagueId: string; toId?: string; rows: number[] }[] = [];
  names.forEach((_, i) => {
    const leagueId = from![i];
    const g = groups.find((x) => x.leagueId === leagueId);
    if (g) g.rows.push(i);
    else groups.push({ leagueId, toId: to?.[i], rows: [i] });
  });

  const leagueName = (id?: string) => (id ? game.leagues[id]?.name : undefined);

  return (
    <div className="mt-1.5 space-y-2.5">
      {groups.map((g) => {
        const dest = leagueName(g.toId);
        return (
          <div key={g.leagueId}>
            <div className="mb-0.5 flex items-baseline gap-1.5 text-[10px] uppercase tracking-widest text-faint">
              <span className="truncate">{leagueName(g.leagueId) ?? "—"}</span>
              {dest && (
                <span className="truncate normal-case tracking-normal text-[10px] opacity-70">
                  → {dest}
                </span>
              )}
            </div>
            <div className="space-y-1">
              {g.rows.map((i) => (
                <MoveRow key={`${names[i]}-${i}`} game={game} name={names[i]} id={ids[i]} arrow={arrow} tone={tone} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SeasonDetailModal({ summary, onClose }: { summary: SeasonSummary; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);

  // Divisions this season actually recorded a table for, in ladder order so the
  // top flight leads. A save whose ladder changed still renders correctly
  // because the summary's own keys drive the list.
  const divisionIds = (game.divisionIds ?? []).filter((id) => summary.finalTables[id]?.length);
  const extraIds = Object.keys(summary.finalTables).filter(
    (id) => !divisionIds.includes(id) && summary.finalTables[id]?.length
  );
  const allIds = [...divisionIds, ...extraIds];

  const [activeId, setActiveId] = useState(allIds[0] ?? "");
  const table = summary.finalTables[activeId] ?? [];
  const topScorer = summary.topScorers[activeId];
  const champion = summary.championsByLeague[activeId];
  // Full honours for the season (v24). Absent on summaries built before the
  // feature — the modal degrades to the two legacy award cards it always had.
  const accolades = summary.accolades;
  const leagueAwards = accolades?.byLeague[activeId];

  // The user's own club is the thread through the whole exhibit — it's their
  // museum, so their row is always the one that stands out.
  const userTeamId = summary.userTeamId;

  // Closing before opening a profile keeps a single overlay on screen at a time.
  const openProfile = (playerId: string) => {
    onClose();
    viewPlayer(playerId);
  };

  return (
    <Modal title={`${summary.yearLabel} — Season Review`} onClose={onClose} size="lg">
      {/* Headline: where the user finished, and the two trophies. */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Card className="border-gold bg-gradient-to-br from-gold-lo/[0.12] to-transparent px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-widest text-faint">Your season</div>
          <div className="display mt-0.5 text-sm font-bold gold-text">{summary.userFinish}</div>
        </Card>
        <Card className="px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-widest text-faint">Champions</div>
          <div className="display mt-0.5 truncate text-sm font-semibold">
            🏆 {summary.championsByLeague[allIds[0]]?.teamName ?? "—"}
          </div>
        </Card>
        <Card className="px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-widest text-faint">Cup winners</div>
          <div className="display mt-0.5 truncate text-sm font-semibold">🏅 {summary.cupWinner?.teamName ?? "—"}</div>
        </Card>
      </div>

      {/* Save-wide honours (v24) — Legacy Player of the Year and the Legacy Team
          of the Year span every league, so they lead the exhibit. Falls back to
          the two legacy Player/Young Player fields on old summaries. Clickable
          through to the profile — a name in the record book should always lead
          somewhere, including for players long retired. */}
      {accolades?.legacyPlayerOfSeason ? (
        <div className="mb-4 space-y-2">
          <AwardCard
            label={`${ACCOLADE_META.legacyPlayerOfSeason.emoji} Legacy Player of the Year`}
            name={accolades.legacyPlayerOfSeason.name}
            club={accolades.legacyPlayerOfSeason.teamName}
            stat={fmtRating(accolades.legacyPlayerOfSeason.stat)}
            nationality={accolades.legacyPlayerOfSeason.nationality}
            teamId={accolades.legacyPlayerOfSeason.teamId}
            game={game}
            onClick={() => openProfile(accolades.legacyPlayerOfSeason!.playerId)}
          />
          {accolades.legacyTeamOfSeason?.length ? (
            <TeamOfSeason
              label={`${ACCOLADE_META.legacyTeamOfSeason.emoji} Legacy Team of the Year`}
              xi={accolades.legacyTeamOfSeason}
              game={game}
              onView={openProfile}
            />
          ) : null}
        </div>
      ) : (
        (summary.playerOfSeason || summary.youngPlayerOfSeason) && (
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {summary.playerOfSeason && (
              <AwardCard
                label="Player of the Season"
                name={summary.playerOfSeason.name}
                club={summary.playerOfSeason.teamName}
                game={game}
                onClick={() => openProfile(summary.playerOfSeason!.playerId)}
              />
            )}
            {summary.youngPlayerOfSeason && (
              <AwardCard
                label="Young Player of the Season"
                name={summary.youngPlayerOfSeason.name}
                club={summary.youngPlayerOfSeason.teamName}
                game={game}
                onClick={() => openProfile(summary.youngPlayerOfSeason!.playerId)}
              />
            )}
          </div>
        )
      )}

      {/* Division picker — only when the save actually has more than one. */}
      {allIds.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {allIds.map((id) => (
            <button
              key={id}
              onClick={() => setActiveId(id)}
              className={`display rounded px-2.5 py-1 text-[11px] font-semibold ${
                activeId === id ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
              }`}
            >
              {game.leagues[id]?.name ?? id}
            </button>
          ))}
        </div>
      )}

      {/* Final table, exactly as it finished. */}
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-widest text-faint">Final table</span>
        {champion && <span className="text-[11px] text-gold">🏆 {champion.teamName}</span>}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-faint">
            <tr className="border-b border-line">
              <th className="py-2 pl-3 text-left">#</th>
              <th className="py-2 text-left">Club</th>
              <th className="py-2 text-center">P</th>
              <th className="py-2 text-center">W</th>
              <th className="py-2 text-center">D</th>
              <th className="py-2 text-center">L</th>
              <th className="py-2 text-center">GD</th>
              <th className="py-2 pr-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => {
              const t = game.teams[row.teamId];
              const mine = row.teamId === userTeamId;
              return (
                <tr
                  key={row.teamId}
                  className={`border-b border-line/50 last:border-0 ${mine ? "bg-hover" : ""}`}
                >
                  <td className={`py-1.5 pl-3 tnum ${i === 0 ? "gold-text font-bold" : "text-faint"}`}>{i + 1}</td>
                  <td className="min-w-0 py-1.5">
                    <span className={`flex min-w-0 items-center gap-2 ${mine ? "font-semibold" : ""}`}>
                      {t && <Crest colors={t.colors} short={t.short} size={18} />}
                      <span className="truncate">{t?.name ?? row.teamId}</span>
                    </span>
                  </td>
                  <td className="py-1.5 text-center tnum text-dim">{row.played}</td>
                  <td className="py-1.5 text-center tnum text-dim">{row.won}</td>
                  <td className="py-1.5 text-center tnum text-dim">{row.drawn}</td>
                  <td className="py-1.5 text-center tnum text-dim">{row.lost}</td>
                  <td className="py-1.5 text-center tnum text-dim">
                    {row.gf - row.ga > 0 ? "+" : ""}
                    {row.gf - row.ga}
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum font-semibold">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Per-league honours for the division on show (v24). The full slate —
          Player / Young Player of the Season, Golden Boot / Playmaker / Glove —
          each clickable through to the profile, then the XI of the season. */}
      {leagueAwards ? (
        <div className="mt-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-faint">
            {game.leagues[activeId]?.name ?? activeId} — Honours
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LeagueAward type="playerOfSeason" w={leagueAwards.playerOfSeason} kind="rating" game={game} onView={openProfile} />
            <LeagueAward type="youngPlayerOfSeason" w={leagueAwards.youngPlayerOfSeason} kind="rating" game={game} onView={openProfile} />
            <LeagueAward type="goldenBoot" w={leagueAwards.goldenBoot} kind="goals" game={game} onView={openProfile} />
            <LeagueAward type="goldenPlaymaker" w={leagueAwards.goldenPlaymaker} kind="assists" game={game} onView={openProfile} />
            <LeagueAward type="goldenGlove" w={leagueAwards.goldenGlove} kind="rating" game={game} onView={openProfile} />
          </div>
          {leagueAwards.teamOfSeason?.length ? (
            <TeamOfSeason
              label={`${ACCOLADE_META.teamOfSeason.emoji} Team of the Season`}
              xi={leagueAwards.teamOfSeason}
              game={game}
              onView={openProfile}
            />
          ) : null}
        </div>
      ) : (
        // Golden-boot-only fallback for summaries built before v24 accolades.
        topScorer && (
          <button
            onClick={() => openProfile(topScorer.playerId)}
            className="mt-3 flex w-full items-center justify-between rounded-md border border-line bg-raised px-3 py-2 text-left text-sm hover:bg-hover"
          >
            <span>
              <span className="mr-2">⚽</span>
              <span className="display font-semibold">{topScorer.name}</span>
              <span className="ml-2 text-[11px] text-faint">{topScorer.teamName}</span>
            </span>
            <span className="display tnum font-bold gold-text">
              {topScorer.goals} <span className="text-[10px] font-normal text-faint">goals</span>
            </span>
          </button>
        )
      )}

      {/* Promotion / relegation, the season's other structural story. Each club
          is listed with its badge; old summaries with no ids fall back to a
          plain comma-joined line. */}
      {(summary.promoted.length > 0 || summary.relegated.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {summary.promoted.length > 0 && (
            <div className="rounded-md border border-win/40 bg-win/[0.06] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-faint">Promoted</div>
              <MoveList
                game={game}
                names={summary.promoted}
                ids={summary.promotedIds}
                from={summary.promotedFrom}
                to={summary.promotedTo}
                arrow="▲"
                tone="text-win"
              />
            </div>
          )}
          {summary.relegated.length > 0 && (
            <div className="rounded-md border border-loss/40 bg-loss/[0.06] px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-faint">Relegated</div>
              <MoveList
                game={game}
                names={summary.relegated}
                ids={summary.relegatedIds}
                from={summary.relegatedFrom}
                to={summary.relegatedTo}
                arrow="▼"
                tone="text-loss"
              />
            </div>
          )}
        </div>
      )}

      {/* The transfer market's headlines. */}
      {summary.notableTransfers.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Record deals</div>
          <Card className="divide-y divide-line/50">
            {summary.notableTransfers.map((t, i) => (
              <div key={`${t.playerName}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  {t.nationality && <Flag nat={t.nationality} size={13} />}
                  <span className="display font-semibold">{t.playerName}</span>
                  <span className="ml-1 flex items-center gap-1.5 text-[11px] text-faint">
                    <TeamCrest game={game} teamId={t.fromId} size={15} />
                    <span className="truncate">{t.from}</span>
                    <span aria-hidden>→</span>
                    <TeamCrest game={game} teamId={t.toId} size={15} />
                    <span className="truncate">{t.to}</span>
                  </span>
                </span>
                <span className="display tnum font-semibold text-win">{formatMoney(t.fee)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </Modal>
  );
}

function AwardCard({
  label,
  name,
  club,
  stat,
  nationality,
  teamId,
  game,
  onClick,
}: {
  label: string;
  name: string;
  club: string;
  stat?: string;
  nationality?: string;
  teamId?: string;
  game: GameState;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md border border-line bg-raised px-3 py-2 text-left hover:bg-hover"
    >
      <span className="flex min-w-0 items-center gap-2">
        {nationality && <Flag nat={nationality} size={14} />}
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-widest text-faint">{label}</span>
          <span className="display truncate text-sm font-semibold">{name}</span>
        </span>
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-2 text-right">
        <span>
          <span className="block text-[11px] text-faint">{club}</span>
          {stat && <span className="display block text-[11px] font-semibold gold-text">{stat}</span>}
        </span>
        <TeamCrest game={game} teamId={teamId} size={20} />
      </span>
    </button>
  );
}

/** One per-league honour card, or a "not awarded" placeholder when the season
 * had no eligible winner (e.g. a league with no qualifying goalkeeper). */
function LeagueAward({
  type,
  w,
  kind,
  game,
  onView,
}: {
  type: keyof typeof ACCOLADE_META;
  w?: AwardWinner;
  kind: "rating" | "goals" | "assists";
  game: GameState;
  onView: (id: string) => void;
}) {
  const meta = ACCOLADE_META[type];
  if (!w) {
    return (
      <div className="rounded-md border border-line/60 bg-raised/50 px-3 py-2">
        <span className="block text-[10px] uppercase tracking-widest text-faint">
          {meta.emoji} {meta.title}
        </span>
        <span className="text-sm text-faint">Not awarded</span>
      </div>
    );
  }
  const stat =
    kind === "rating"
      ? fmtRating(w.stat)
      : w.stat !== undefined
      ? `${w.stat} ${kind === "goals" ? "goals" : "assists"}`
      : undefined;
  return (
    <AwardCard
      label={`${meta.emoji} ${meta.title}`}
      name={w.name}
      club={w.teamName}
      stat={stat}
      nationality={w.nationality}
      teamId={w.teamId}
      game={game}
      onClick={() => onView(w.playerId)}
    />
  );
}

/** The XI of the season, grouped GK → DEF → MID → ATT, each pick clickable.
 * Each pick shows the player's nationality flag and their club's badge. */
function TeamOfSeason({
  label,
  xi,
  game,
  onView,
}: {
  label: string;
  xi: AwardWinner[];
  game: GameState;
  onView: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">{label}</div>
      <Card className="grid grid-cols-2 gap-x-3 gap-y-0.5 p-2 sm:grid-cols-3">
        {xi.map((w) => (
          <button
            key={w.playerId}
            onClick={() => onView(w.playerId)}
            className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-hover"
          >
            {w.pos && <PosBadge pos={w.pos} />}
            {w.nationality && <Flag nat={w.nationality} size={11} />}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{w.name}</span>
              <span className="ml-1 text-[10px] text-faint">{w.teamName}</span>
            </span>
            <TeamCrest game={game} teamId={w.teamId} size={16} />
            {w.stat !== undefined && <span className="display shrink-0 tnum text-[11px] gold-text">{fmtRating(w.stat)}</span>}
          </button>
        ))}
      </Card>
    </div>
  );
}

/** Format an average-rating stat to two decimals, or undefined if absent. */
function fmtRating(stat?: number): string | undefined {
  return stat === undefined ? undefined : stat.toFixed(2);
}
