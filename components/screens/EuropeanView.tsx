"use client";

// ── European cups (v1.51) ─────────────────────────────────────────────────
// One view serving all three competitions. The cup the USER is in is selected
// by default (they only ever play in one), but every cup is browsable — the
// continental picture is half the point of the feature.
//
// The layout mirrors the domestic cup: the knockout bracket once it exists,
// then the eight group tables. The per-matchday fixture list below them was
// deleted in v2.0 — see the note in the render.

import { createContext, useContext, useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { EuroCupState } from "@/lib/types";
import { EURO_KO_ROUND_NAMES } from "@/lib/european";
import { Card, CountryFlag, Crest, Section } from "../ui";

/** Lets a row open the team card without threading a prop through every level.
 * The Competition screen provides the real handler. */
export const OpenTeamCtx = createContext<(teamId: string) => void>(() => {});

export default function EuropeanView() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const euro = game.european;
  const userCup = useMemo(
    () => euro?.cups.find((c) => c.teamIds.includes(game.userTeamId)) ?? null,
    [euro, game.userTeamId]
  );
  const [tier, setTier] = useState<number | null>(null);
  const cup = useMemo(() => {
    if (!euro?.cups.length) return null;
    const want = tier ?? userCup?.tier ?? euro.cups[0].tier;
    return euro.cups.find((c) => c.tier === want) ?? euro.cups[0];
  }, [euro, tier, userCup]);

  if (!euro) {
    return (
      <Card className="p-6 text-center text-sm text-faint">
        European competitions are not enabled in this save. They can be switched on when starting a
        new game, and need at least eight European countries included.
      </Card>
    );
  }
  if (!euro.cups.length || !cup) {
    return (
      <Card className="p-6 text-center text-sm text-faint">
        <div className="display mb-1 text-base text-dim">No European football this season</div>
        Qualification is decided by the previous season&rsquo;s final league tables, so the
        continental competitions begin in season two.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cup switcher — each in its own competition colour. */}
      <div className="flex flex-wrap items-center gap-2">
        {euro.cups.map((c) => {
          const active = c.tier === cup.tier;
          return (
            <button
              key={c.tier}
              onClick={() => setTier(c.tier)}
              style={
                active
                  ? { backgroundColor: c.color, borderColor: c.color }
                  : { borderColor: `${c.color}80` }
              }
              className={`display rounded-md border px-3 py-1 text-[11px] font-semibold transition-colors ${
                active ? "text-white" : "text-faint hover:text-dim"
              }`}
            >
              {c.name.toUpperCase()}
              {c.teamIds.includes(game.userTeamId) && <span className="ml-1.5 opacity-80">★</span>}
            </button>
          );
        })}
      </div>

      {cup.winnerId && (
        <Card className="p-4 text-center" style={{ borderColor: cup.color }}>
          <div className="text-[11px] uppercase tracking-widest text-faint">{cup.name} Winners</div>
          <div className="display mt-1 text-2xl font-bold" style={{ color: cup.color }}>
            {game.teams[cup.winnerId]?.name ?? "—"}
          </div>
        </Card>
      )}

      {/* Once the Round of 16 has been drawn, the BRACKET is the competition
          (v2.0) — the groups are settled history at that point, and a manager
          opening this page is asking who he plays next, not what the table
          looked like in November. So the knockout leads and the groups drop
          below it under a heading that says they are over.

          They are never removed: the group tables are how the eight survivors
          got here and they stay readable all season. What IS gone is the
          fixture list that used to sit under them — it re-printed every result
          the groups and the bracket had already reported, at three times the
          length and in short codes. */}
      {cup.ties.length > 0 && <EuroBracket cup={cup} />}

      <Section title={cup.ties.length > 0 ? "Group Stage — final tables" : "Group Stage"}>
        <div className="grid gap-4 md:grid-cols-2">
          {cup.groups.map((_, gi) => (
            <EuroGroupCard key={gi} cup={cup} groupIndex={gi} />
          ))}
        </div>
      </Section>
    </div>
  );
}

/** One group's mini-table. The top two qualify, so they carry a colour marker. */
function EuroGroupCard({ cup, groupIndex }: { cup: EuroCupState; groupIndex: number }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeamCtx);
  const rows = cup.groupRows
    .filter((r) => r.groupIndex === groupIndex)
    .sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf);
  // Before a ball is kicked there are no rows yet — show the drawn line-up so the
  // group reads as a real draw rather than an empty card.
  const display = rows.length
    ? rows
    : cup.groups[groupIndex].map((teamId) => ({
        teamId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        points: 0,
        groupIndex,
      }));

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-3 py-1.5 text-[11px] uppercase tracking-widest text-faint">
        Group {String.fromCharCode(65 + groupIndex)}
      </div>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col className="w-6" />
          <col />
          <col className="w-8" />
          <col className="w-10" />
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-faint">
            <th />
            <th className="py-1 text-left font-normal">Club</th>
            <th className="py-1 text-center font-normal">P</th>
            <th className="py-1 text-center font-normal">GD</th>
            <th className="py-1 pr-3 text-right font-normal">Pts</th>
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => {
            const t = game.teams[r.teamId];
            if (!t) return null;
            const mine = r.teamId === game.userTeamId;
            const through = i < 2;
            return (
              <tr
                key={r.teamId}
                onClick={() => openTeam(r.teamId)}
                className={`cursor-pointer border-t border-line/40 hover:bg-hover ${mine ? "bg-hover" : ""}`}
                title={`View ${t.name}`}
              >
                <td className="py-1 pl-2">
                  {/* The qualification line, in the competition's own colour. */}
                  <span
                    className="inline-block h-3 w-[3px] rounded-sm"
                    style={{ backgroundColor: through ? cup.color : "transparent" }}
                  />
                </td>
                <td className="min-w-0 py-1">
                  <span className={`flex min-w-0 items-center gap-1.5 ${mine ? "font-semibold" : ""}`}>
                    <Crest team={t} size={16} />
                    <CountryFlag country={game.leagues[t.leagueId]?.country ?? ""} size={10} />
                    <span className="truncate">{t.name}</span>
                  </span>
                </td>
                <td className="py-1 text-center tnum text-dim">{r.played}</td>
                <td className="py-1 text-center tnum text-dim">
                  {r.gf - r.ga > 0 ? "+" : ""}
                  {r.gf - r.ga}
                </td>
                <td className={`py-1 pr-3 text-right tnum font-semibold ${mine ? "gold-text" : ""}`}>
                  {r.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * The knockout bracket: one column per round, with aggregate scores.
 *
 * Reworked v2.0 to read as a real bracket rather than four lists side by side.
 * Two things do that work, and both come from the fact that a bracket is a
 * TREE: each round holds half as many ties as the one before it, so every
 * column is CENTRED vertically against its neighbour — which is what makes the
 * eye follow a club from the Round of 16 to the final without a connector line
 * being drawn. And a later round gets more room per tie, so the final is the
 * biggest card on the page rather than the same 180px chip as a first-round
 * fixture.
 *
 * The user's own tie carries a gold edge in every round it survives, since "how
 * far am I still in" is the one question this view is opened for.
 */
function EuroBracket({ cup }: { cup: EuroCupState }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeamCtx);
  const rounds = EURO_KO_ROUND_NAMES.map((name, r) => ({
    name,
    ties: cup.ties.filter((t) => t.round === r),
  })).filter((r) => r.ties.length);
  if (!rounds.length) return null;

  return (
    <Section title="Knockout Stage">
      {/* A bracket is intrinsically wide: it scrolls inside its own container so
          the page body never scrolls sideways. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: rounds.length * 210 }}>
          {rounds.map((round, ri) => {
            const isFinal = ri === rounds.length - 1 && round.ties.length === 1;
            return (
              // `justify-center` is the whole bracket effect: a column of two
              // ties sits level with the middle of the column of four beside it.
              <div key={round.name} className="flex min-w-[200px] flex-1 flex-col">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">{round.name}</div>
                <div className="flex flex-1 flex-col justify-center gap-3">
                  {round.ties.map((tie) => {
                    const a = game.teams[tie.teamAId];
                    const b = game.teams[tie.teamBId];
                    if (!a || !b) return null;
                    const settled = !!tie.winnerId;
                    const mine = tie.teamAId === game.userTeamId || tie.teamBId === game.userTeamId;
                    const side = (
                      teamId: string,
                      team: typeof a,
                      agg: number | undefined,
                      isWinner: boolean
                    ) => (
                      <button
                        onClick={() => openTeam(teamId)}
                        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-hover ${
                          isFinal ? "text-[13px]" : "text-[12px]"
                        } ${teamId === game.userTeamId ? "font-semibold" : ""} ${
                          settled && !isWinner ? "text-faint" : settled ? "text-ink" : ""
                        }`}
                        title={`View ${team.name}`}
                      >
                        <Crest team={team} size={isFinal ? 18 : 14} />
                        {/* The full name, not the three-letter code (v2.0). A
                            200px column has the room, and a bracket read in
                            short codes is a puzzle rather than a picture. */}
                        <span className="min-w-0 flex-1 truncate">{team.name}</span>
                        <span className={`shrink-0 tnum ${isWinner ? "gold-text font-bold" : ""}`}>
                          {agg ?? "–"}
                        </span>
                      </button>
                    );
                    return (
                      <Card
                        key={tie.id}
                        className={`overflow-hidden ${mine ? "border-gold-lo" : ""} ${
                          isFinal ? "border-gold-lo/70" : ""
                        }`}
                      >
                        {side(tie.teamAId, a, tie.aggA, tie.winnerId === tie.teamAId)}
                        <div className="border-t border-line/40" />
                        {side(tie.teamBId, b, tie.aggB, tie.winnerId === tie.teamBId)}
                        {tie.shootoutWinnerId && (
                          <div className="border-t border-line/40 px-2 py-0.5 text-[10px] text-faint">
                            {game.teams[tie.shootoutWinnerId]?.name} win on penalties
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

