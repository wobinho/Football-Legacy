"use client";

// The app shell: sidebar navigation, top bar (date · budget · continue),
// and the active screen. The Continue button is the spine of the loop.
// On phones the sidebar collapses into a slide-in drawer behind a hamburger.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { ScreenId } from "@/lib/types";
import { formatDay, seasonYearLabel, transferWindowState } from "@/lib/calendar";
import { isSeasonComplete } from "@/lib/gameloop";
import { CountryFlag, Crest, GoldButton, Money } from "./ui";
import HomeScreen from "./screens/Home";
import SquadScreen from "./screens/Squad";
import TacticsScreen from "./screens/Tactics";
import MatchDayScreen from "./screens/MatchDay";
import CompetitionScreen from "./screens/Competition";
import TransfersScreen from "./screens/Transfers";
import ClubScreen from "./screens/Club";
import AchievementsScreen from "./screens/Achievements";
import DevelopmentScreen from "./screens/Development";
import AcademyScreen from "./screens/Academy";
import PlayerProfileModal from "./screens/PlayerProfile";
import SeasonDetailModal from "./screens/SeasonDetailModal";

const NAV: { id: ScreenId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "squad", label: "Squad" },
  { id: "tactics", label: "Tactics" },
  { id: "matchday", label: "Match Day" },
  { id: "competition", label: "Competition" },
  { id: "transfers", label: "Transfers" },
  { id: "academy", label: "Academy" },
  { id: "development", label: "Development" },
  { id: "club", label: "Club" },
  { id: "achievements", label: "Achievements" },
];

export default function Shell() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev); // re-render on every game mutation
  const screen = useGame((s) => s.screen);
  const setScreen = useGame((s) => s.setScreen);
  const continueGame = useGame((s) => s.continueGame);
  const advanceDayOnce = useGame((s) => s.advanceDayOnce);
  const endSeason = useGame((s) => s.endSeason);
  const seasonReview = useGame((s) => s.seasonReview);
  const closeSeasonReview = useGame((s) => s.closeSeasonReview);
  const quitToMenu = useGame((s) => s.quitToMenu);
  const logout = useGame((s) => s.logout);
  const [navOpen, setNavOpen] = useState(false);

  const team = game.teams[game.userTeamId];
  const unread = game.inbox.filter((i) => !i.read).length;
  const pendingOffers = game.offers.filter((o) => o.status === "pending" && o.direction === "incoming").length;
  const prospectReports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay).length;
  const window = transferWindowState(game.currentDay, game.schedule);
  const onMatchday = game.pendingMatchFixtureId !== null;
  // Season's last day reached: the calendar can't advance further until the
  // player takes the rollover, so Continue becomes END SEASON.
  const seasonOver = isSeasonComplete(game);

  const go = (id: ScreenId) => {
    setScreen(id);
    setNavOpen(false); // close the drawer after navigating on mobile
  };

  return (
    <div className="flex h-[100dvh]">
      {/* Backdrop for the mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}

      {/* sidebar — fixed drawer on mobile (slides in), static column on md+ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 max-w-[80%] flex-col border-r border-line bg-surface transition-transform md:static md:z-auto md:w-48 md:max-w-none md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 p-4">
          <Crest colors={team.colors} short={team.short} size={34} />
          <div className="min-w-0 flex-1">
            <div className="display truncate text-sm font-bold leading-tight">{team.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-faint">
              <CountryFlag country={game.leagues[team.leagueId].country} size={11} />
              <span className="truncate">{game.leagues[team.leagueId].name}</span>
            </div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="px-1 text-faint hover:text-ink md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div className="gold-thread mx-4" />
        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          {NAV.map((n) => {
            const active = screen === n.id;
            const badge = n.id === "home" ? unread : n.id === "transfers" ? pendingOffers : n.id === "academy" ? prospectReports : 0;
            const pulse = n.id === "matchday" && onMatchday;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`display relative flex w-full items-center justify-between rounded px-3 py-2.5 text-left text-sm font-semibold tracking-wide transition-colors md:py-2 ${
                  active ? "bg-hover text-ink" : "text-faint hover:bg-raised hover:text-dim"
                }`}
              >
                {active && <span className="gold-grad absolute inset-y-1.5 left-0 w-0.5 rounded-full" />}
                <span>{n.label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-gold px-1.5 text-[10px] font-bold text-black">{badge}</span>
                )}
                {pulse && <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />}
              </button>
            );
          })}
        </nav>
        <div className="p-4 text-[11px] leading-relaxed text-faint">
          {/* budget is hidden from the compact mobile header, so surface it here */}
          <div className="mb-2 md:hidden">
            <span className="uppercase tracking-widest">Budget</span>
            <Money value={team.budget} className="display ml-2 text-sm font-semibold text-ink" />
          </div>
          <div>{game.managerName}</div>
          <div>
            Season {game.season} · {seasonYearLabel(game.season)}
          </div>
          {/* Leave the current game: back to the save picker, or sign out fully. */}
          <div className="mt-3 flex items-center gap-2 border-t border-line/50 pt-3">
            <button
              onClick={quitToMenu}
              title="Back to your saves (this game is saved)"
              className="display rounded border border-line px-2 py-1 text-[11px] font-semibold tracking-wide text-dim hover:border-faint hover:text-ink"
            >
              ← SAVES
            </button>
            <button
              onClick={logout}
              title="Sign out and switch game key"
              className="display rounded border border-line px-2 py-1 text-[11px] font-semibold tracking-wide text-dim hover:border-loss/50 hover:text-loss"
            >
              LOG OUT
            </button>
          </div>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:gap-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {/* hamburger — mobile only */}
            <button
              onClick={() => setNavOpen(true)}
              className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-ink md:hidden"
              aria-label="Open menu"
            >
              <span className="text-xl leading-none">☰</span>
            </button>
            <div className="flex min-w-0 items-baseline gap-2 sm:gap-4">
              <span className="display shrink-0 text-sm font-semibold tnum sm:text-base">{formatDay(game.currentDay)}</span>
              <span className="hidden truncate text-xs text-faint sm:inline">
                {window.open ? `${window.label} · ${window.daysLeft}d left` : window.daysLeft ? `${window.label} in ${window.daysLeft}d` : window.label}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-5">
            <div className="hidden text-right sm:block">
              <div className="text-[10px] uppercase tracking-widest text-faint">Budget</div>
              <Money value={team.budget} className="display text-base font-semibold" />
            </div>
            {onMatchday ? (
              <GoldButton onClick={() => setScreen("matchday")} className="!px-3 !py-1.5 text-xs sm:!px-5 sm:!py-2 sm:text-sm">
                MATCH DAY
              </GoldButton>
            ) : seasonOver ? (
              <GoldButton onClick={endSeason} className="!px-3 !py-1.5 text-xs sm:!px-5 sm:!py-2 sm:text-sm">
                END SEASON ▸
              </GoldButton>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Advance one day at a time so nothing important — a window
                    opening, a transfer, an intake — is fast-forwarded past. */}
                <button
                  onClick={advanceDayOnce}
                  title="Advance the calendar a single day"
                  className="display rounded-md border border-gold-lo/50 px-2.5 py-1.5 text-xs font-bold tracking-wider text-gold transition-colors hover:bg-hover active:scale-[0.98] sm:px-4 sm:py-2 sm:text-sm"
                >
                  <span className="sm:hidden">+1 DAY</span>
                  <span className="hidden sm:inline">ADVANCE 1 DAY</span>
                </button>
                <GoldButton onClick={continueGame} className="!px-3 !py-1.5 text-xs sm:!px-5 sm:!py-2 sm:text-sm">
                  <span className="sm:hidden">GO ▸</span>
                  <span className="hidden sm:inline">CONTINUE ▸</span>
                </GoldButton>
              </div>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {screen === "home" && <HomeScreen />}
          {screen === "squad" && <SquadScreen />}
          {screen === "tactics" && <TacticsScreen />}
          {screen === "matchday" && <MatchDayScreen />}
          {screen === "competition" && <CompetitionScreen />}
          {screen === "transfers" && <TransfersScreen />}
          {screen === "academy" && <AcademyScreen />}
          {screen === "development" && <DevelopmentScreen />}
          {screen === "club" && <ClubScreen />}
          {screen === "achievements" && <AchievementsScreen />}
        </main>
      </div>

      {/* Player profile floats over whatever screen you're on */}
      <PlayerProfileModal />

      {/* End-of-season review — shown the moment the rollover is taken. */}
      {seasonReview && <SeasonDetailModal summary={seasonReview} onClose={closeSeasonReview} />}
    </div>
  );
}
