"use client";

// Home (§15.1): inbox, news ticker, next fixture, mini table — the spine.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { formatDay, formatDayShort } from "@/lib/calendar";
import { computeTable } from "@/lib/season";
import type { Fixture } from "@/lib/types";
import { Card, Crest, Section, GhostButton } from "../ui";
import Calendar from "../Calendar";

export default function HomeScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const markRead = useGame((s) => s.markRead);
  const markAllRead = useGame((s) => s.markAllRead);
  const setScreen = useGame((s) => s.setScreen);
  // One item open at a time — the inbox is a list of headlines you drill into.
  const [expanded, setExpanded] = useState<string | null>(null);

  const team = game.teams[game.userTeamId];
  const mine = game.fixtures.filter((f) => f.homeId === game.userTeamId || f.awayId === game.userTeamId);
  const next = mine.filter((f) => !f.played).sort((a, b) => a.day - b.day)[0];
  const lastFive = mine
    .filter((f) => f.played)
    .sort((a, b) => b.day - a.day)
    .slice(0, 5)
    .reverse();
  const unread = game.inbox.filter((i) => !i.read).length;

  const league = game.leagues[team.leagueId];
  const table = computeTable(game.fixtures, league.id, league.teamIds);
  const myPos = table.findIndex((r) => r.teamId === game.userTeamId);
  const slice = table.slice(Math.max(0, Math.min(myPos - 2, table.length - 5)), Math.max(5, Math.min(myPos + 3, table.length)));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title="Inbox"
          right={
            unread > 1 ? (
              <button onClick={markAllRead} className="text-xs text-faint transition-colors hover:text-dim">
                Mark all read ({unread})
              </button>
            ) : undefined
          }
        >
          <div className="space-y-2">
            {game.inbox.length === 0 && (
              <Card className="border-dashed p-6 text-center text-sm text-faint">
                Nothing yet — club news, offers and reports land here.
                <div className="mt-1">Hit <span className="display text-gold">CONTINUE ▸</span> to start the season.</div>
              </Card>
            )}
            {game.inbox.slice(0, 30).map((item) => {
              // Collapsed by default: the list reads as headlines, and opening
              // one is the act that marks it read.
              const open = expanded === item.id;
              return (
                <Card key={item.id} className={`p-3 ${item.read && !open ? "opacity-60" : ""}`}>
                  <button
                    className="w-full text-left"
                    onClick={() => {
                      setExpanded(open ? null : item.id);
                      if (!open && !item.read) markRead(item.id);
                    }}
                    aria-expanded={open}
                    title={open ? "Collapse" : "Read"}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`flex min-w-0 items-baseline gap-1.5 text-sm font-semibold ${!item.read ? "text-ink" : "text-dim"}`}>
                        {!item.read && <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-gold" aria-label="Unread" />}
                        {item.type === "offer" && <span className="gold-text">◈</span>}
                        <span className="min-w-0">{item.title}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <span className="text-[11px] tnum text-faint">{formatDayShort(item.day)}</span>
                        <span className={`text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
                          ▸
                        </span>
                      </span>
                    </div>
                  </button>
                  {open && (
                    <>
                      <p className="mt-2 border-t border-line/60 pt-2 text-[13px] leading-relaxed text-dim">{item.body}</p>
                      {item.offerId && game.offers.find((o) => o.id === item.offerId)?.status === "pending" && (
                        <div className="mt-2">
                          <GhostButton onClick={() => setScreen("transfers")} className="!py-1 text-xs">
                            Respond in Transfers →
                          </GhostButton>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      </div>

      <div className="space-y-6">
        <Section title="Calendar">
          <Calendar />
        </Section>

        <Section title="Next Fixture">
          {next ? (
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-widest text-faint">
                {next.competition === "CUP" ? `Cup · ${game.cup.roundNames[next.round - 1]}` : `${game.leagues[next.competition]?.name} · Round ${next.round}`}
              </div>
              <div className="flex items-center justify-between gap-2 py-2">
                {[game.teams[next.homeId], game.teams[next.awayId]].map((t, i) => (
                  <div key={i} className={`flex flex-1 items-center gap-2 ${i === 1 ? "flex-row-reverse text-right" : ""}`}>
                    <Crest colors={t.colors} short={t.short} size={34} />
                    <div className={`display text-sm font-bold leading-tight ${t.id === game.userTeamId ? "gold-text" : ""}`}>
                      {t.name}
                    </div>
                  </div>
                ))}
              </div>
              <div className="display text-center text-xs text-faint">{formatDay(next.day)}</div>
            </Card>
          ) : (
            <div className="text-sm text-faint">Season complete. Continue to roll over.</div>
          )}
        </Section>

        <Section
          title={league.name}
          right={lastFive.length > 0 ? <FormGuide fixtures={lastFive} userTeamId={game.userTeamId} /> : undefined}
        >
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {slice.map((row) => {
                  const t = game.teams[row.teamId];
                  const pos = table.indexOf(row) + 1;
                  const mineRow = row.teamId === game.userTeamId;
                  return (
                    <tr key={row.teamId} className={`border-b border-line last:border-0 ${mineRow ? "bg-hover" : ""}`}>
                      <td className="w-8 py-1.5 pl-3 tnum text-faint">{pos}</td>
                      <td className="py-1.5">
                        <span className={`flex items-center gap-2 ${mineRow ? "font-semibold" : ""}`}>
                          <Crest colors={t.colors} short={t.short} size={18} />
                          <span className="truncate">{t.short}</span>
                        </span>
                      </td>
                      <td className="w-10 py-1.5 text-center tnum text-dim">{row.played}</td>
                      <td className={`w-12 py-1.5 pr-3 text-right tnum font-semibold ${mineRow ? "gold-text" : ""}`}>{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <button onClick={() => setScreen("competition")} className="mt-2 text-xs text-faint hover:text-dim">
            Full table →
          </button>
        </Section>

        <Section title="Around the League">
          <ul className="space-y-1.5">
            {game.news.slice(0, 8).map((n, i) => (
              <li key={i} className="text-[13px] leading-snug text-dim">
                <span className="gold-text mr-1.5">·</span>
                {n}
              </li>
            ))}
            {game.news.length === 0 && <li className="text-sm text-faint">No headlines yet.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

/** Last five results as W/D/L chips, oldest → newest. */
function FormGuide({ fixtures, userTeamId }: { fixtures: Fixture[]; userTeamId: string }) {
  const game = useGame((s) => s.game)!;
  return (
    <span className="flex items-center gap-1" title="Form, last 5 (oldest → newest)">
      {fixtures.map((f) => {
        const isHome = f.homeId === userTeamId;
        const gf = isHome ? f.homeGoals! : f.awayGoals!;
        const ga = isHome ? f.awayGoals! : f.homeGoals!;
        const opp = game.teams[isHome ? f.awayId : f.homeId];
        const letter = gf > ga ? "W" : gf < ga ? "L" : "D";
        const cls =
          letter === "W" ? "bg-win/15 text-win" : letter === "L" ? "bg-loss/15 text-loss" : "bg-line/40 text-dim";
        return (
          <span
            key={f.id}
            className={`display flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${cls}`}
            title={`${gf}–${ga} ${isHome ? "vs" : "at"} ${opp?.short ?? "?"}`}
          >
            {letter}
          </span>
        );
      })}
    </span>
  );
}
