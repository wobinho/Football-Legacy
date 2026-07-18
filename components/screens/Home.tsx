"use client";

// Home (§15.1): inbox, news ticker, next fixture, mini table — the spine.

import { useGame } from "@/store/gameStore";
import { formatDay, formatDayShort } from "@/lib/calendar";
import { computeTable } from "@/lib/season";
import { Card, Crest, Section, GhostButton } from "../ui";
import Calendar from "../Calendar";

export default function HomeScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const markRead = useGame((s) => s.markRead);
  const setScreen = useGame((s) => s.setScreen);

  const team = game.teams[game.userTeamId];
  const next = game.fixtures
    .filter((f) => !f.played && (f.homeId === game.userTeamId || f.awayId === game.userTeamId))
    .sort((a, b) => a.day - b.day)[0];

  const league = game.leagues[team.leagueId];
  const table = computeTable(game.fixtures, league.id, league.teamIds);
  const myPos = table.findIndex((r) => r.teamId === game.userTeamId);
  const slice = table.slice(Math.max(0, Math.min(myPos - 2, table.length - 5)), Math.max(5, Math.min(myPos + 3, table.length)));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section title="Inbox">
          <div className="space-y-2">
            {game.inbox.length === 0 && <div className="text-sm text-faint">Nothing yet. Hit Continue to start the season.</div>}
            {game.inbox.slice(0, 30).map((item) => (
              <Card key={item.id} className={`p-3 ${item.read ? "opacity-60" : ""}`}>
                <button className="w-full text-left" onClick={() => markRead(item.id)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`text-sm font-semibold ${!item.read ? "text-ink" : "text-dim"}`}>
                      {item.type === "offer" && <span className="gold-text mr-1.5">◈</span>}
                      {item.title}
                    </span>
                    <span className="shrink-0 text-[11px] tnum text-faint">{formatDayShort(item.day)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-dim">{item.body}</p>
                </button>
                {item.offerId && game.offers.find((o) => o.id === item.offerId)?.status === "pending" && (
                  <div className="mt-2">
                    <GhostButton onClick={() => setScreen("transfers")} className="!py-1 text-xs">
                      Respond in Transfers →
                    </GhostButton>
                  </div>
                )}
              </Card>
            ))}
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

        <Section title={league.name}>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {slice.map((row) => {
                  const t = game.teams[row.teamId];
                  const pos = table.indexOf(row) + 1;
                  const mine = row.teamId === game.userTeamId;
                  return (
                    <tr key={row.teamId} className={`border-b border-line last:border-0 ${mine ? "bg-hover" : ""}`}>
                      <td className="w-8 py-1.5 pl-3 tnum text-faint">{pos}</td>
                      <td className="py-1.5">
                        <span className={`flex items-center gap-2 ${mine ? "font-semibold" : ""}`}>
                          <Crest colors={t.colors} short={t.short} size={18} />
                          <span className="truncate">{t.short}</span>
                        </span>
                      </td>
                      <td className="w-10 py-1.5 text-center tnum text-dim">{row.played}</td>
                      <td className={`w-12 py-1.5 pr-3 text-right tnum font-semibold ${mine ? "gold-text" : ""}`}>{row.points}</td>
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
