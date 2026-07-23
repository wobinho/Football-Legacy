// Calendar math (§3). Days are integers since the epoch Jul 1 2025 (day 0 =
// start of season 1). Pure helpers — no game state here.

import type { SeasonSchedule } from "./types";

export const EPOCH_UTC = Date.UTC(2025, 6, 1); // Jul 1 2025
const MS_PER_DAY = 86_400_000;

export function dayToDate(day: number): Date {
  return new Date(EPOCH_UTC + day * MS_PER_DAY);
}

export function dateToDay(y: number, m0: number, d: number): number {
  return Math.round((Date.UTC(y, m0, d) - EPOCH_UTC) / MS_PER_DAY);
}

export function formatDay(day: number): string {
  const d = dayToDate(day);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDayShort(day: number): string {
  const d = dayToDate(day);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function seasonYearLabel(season: number): string {
  const startYear = 2025 + (season - 1);
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function isMonday(day: number): boolean {
  return dayToDate(day).getUTCDay() === 1;
}

/** {year, month0} of a given day-index. */
export function dayMonth(day: number): { year: number; month0: number } {
  const d = dayToDate(day);
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth() };
}

export function monthLabel(year: number, month0: number): string {
  return new Date(Date.UTC(year, month0, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A 6×7 calendar grid (Mon-first) for the given month. Each cell is either a
 * day-index or null (leading/trailing pad). Days map to the same integer epoch
 * used everywhere else so fixtures line up directly.
 */
export function monthGrid(year: number, month0: number): (number | null)[] {
  const firstDay = dateToDay(year, month0, 1);
  const firstWeekday = dayToDate(firstDay).getUTCDay(); // 0=Sun..6=Sat
  const lead = (firstWeekday + 6) % 7; // Mon-first offset
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 0; d < daysInMonth; d++) cells.push(firstDay + d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function dayOfMonth(day: number): number {
  return dayToDate(day).getUTCDate();
}

/** First day >= `day` that falls on the given UTC weekday (0=Sun..6=Sat). */
function nextWeekday(day: number, weekday: number): number {
  const d = dayToDate(day).getUTCDay();
  return day + ((weekday - d + 7) % 7);
}

/**
 * Build the fixed anchors of a season (§3, §4):
 * - 38 league Saturdays from mid-August
 * - 6 cup rounds on midweek Wednesdays
 * - windows: summer Jul 1–Sep 1, winter Jan 1–Feb 1
 * - sim-league resolution just before each window's shopping period
 */
export function buildSeasonSchedule(season: number): SeasonSchedule {
  const startYear = 2025 + (season - 1);
  const seasonStartDay = dateToDay(startYear, 6, 1); // Jul 1

  const firstRound = nextWeekday(dateToDay(startYear, 7, 14), 6); // Sat on/after Aug 14
  const leagueRoundDays = Array.from({ length: 38 }, (_, i) => firstRound + i * 7);

  // Cup Wednesdays: R1 mid-Sep, R2 mid-Oct, R3 mid-Nov, QF mid-Feb, SF mid-Mar,
  // Final the Saturday two weeks after the last league round.
  const cupRoundDays = [
    nextWeekday(dateToDay(startYear, 8, 15), 3),
    nextWeekday(dateToDay(startYear, 9, 27), 3),
    nextWeekday(dateToDay(startYear, 10, 24), 3),
    nextWeekday(dateToDay(startYear + 1, 1, 10), 3),
    nextWeekday(dateToDay(startYear + 1, 2, 17), 3),
    leagueRoundDays[37] + 14,
  ];

  const winterOpenDay = dateToDay(startYear + 1, 0, 1);

  // ── European matchdays (v1.51) ──────────────────────────────────────────
  // 13 midweek dates shared by all three cups: 6 group matchdays from mid-
  // September to early December, then two legs each of R16/QF/SF through
  // February–April, and a single-match final in late May.
  //
  // Every date is a Tuesday, which keeps them clear of the domestic cup's
  // Wednesdays automatically — no European tie can ever collide with a cup
  // round, and neither collides with the league's Saturdays.
  const tue = (y: number, m0: number, d: number) => nextWeekday(dateToDay(y, m0, d), 2);
  const euroRoundDays = [
    // Group stage — six matchdays, roughly a fortnight apart.
    tue(startYear, 8, 16), // mid-Sep
    tue(startYear, 8, 30), // end Sep
    tue(startYear, 9, 20), // late Oct
    tue(startYear, 10, 3), // early Nov
    tue(startYear, 10, 24), // late Nov
    tue(startYear + 0, 11, 8), // early Dec
    // Round of 16 (two legs)
    tue(startYear + 1, 1, 10), // mid-Feb
    tue(startYear + 1, 1, 24), // late Feb
    // Quarter-finals (two legs)
    tue(startYear + 1, 2, 10), // mid-Mar
    tue(startYear + 1, 2, 24), // late Mar
    // Semi-finals (two legs)
    tue(startYear + 1, 3, 20), // late Apr
    tue(startYear + 1, 4, 4), // early May
  ];
  // Final — a single match, on the Tuesday at least a week after the second leg
  // of the semi-finals. Derived from the semi rather than pinned to a date so it
  // can never be scheduled before the tie that decides who plays in it (which a
  // fixed early-May date did whenever the season ran late).
  euroRoundDays.push(nextWeekday(euroRoundDays[11] + 7, 2));

  return {
    seasonStartDay,
    leagueRoundDays,
    cupRoundDays,
    summerCloseDay: dateToDay(startYear, 8, 1),
    winterOpenDay,
    winterCloseDay: dateToDay(startYear + 1, 1, 1),
    // Sim (non-playable) leagues are resolved when each transfer window opens, so
    // the player always has current form to shop against. The summer window opens
    // with the season itself (handled at season start in worldgen/rollover); the
    // winter resolution fires the day the winter window opens. The final pass (v23)
    // fires three days after the last league round — while the season is still on
    // screen — so the completed sim tables are browsable in-season rather than only
    // at the very end. It also writes realistic minutes so sim players age like
    // their peers. Kept clear of the cup final (two weeks later) and season end.
    simResolveDay1: winterOpenDay,
    simResolveDay2: leagueRoundDays[37] + 3,
    // The day after the cup final — the last fixture in the world — starts the
    // dead week. With no games left to play, the season's individual honours are
    // handed out here (v1.44), a week before the rollover formally closes it.
    accoladesDay: cupRoundDays[5] + 1,
    // The day after the honours (v1.51): with the season settled and the awards
    // handed out, the club's own expiring contracts are put to the manager. Sits
    // inside the same dead week so it's a beat in the wind-down, not an extra
    // interruption — and comfortably before END SEASON closes the campaign.
    contractResolveDay: cupRoundDays[5] + 2,
    seasonEndDay: cupRoundDays[5] + 7, // season review, then jump to next Jul 1
    intakeDay: nextWeekday(dateToDay(startYear + 1, 2, 10), 3), // Wed mid-March (§18)
    euroRoundDays,
  };
}

export type WindowState = { open: boolean; label: string; daysLeft: number };

export function transferWindowState(day: number, sched: SeasonSchedule): WindowState {
  if (day >= sched.seasonStartDay && day < sched.summerCloseDay) {
    return { open: true, label: "Summer window", daysLeft: sched.summerCloseDay - day };
  }
  if (day >= sched.winterOpenDay && day < sched.winterCloseDay) {
    return { open: true, label: "Winter window", daysLeft: sched.winterCloseDay - day };
  }
  const next = day < sched.winterOpenDay ? sched.winterOpenDay : Infinity;
  return {
    open: false,
    label: next === Infinity ? "Windows closed until summer" : "Winter window opens",
    daysLeft: next === Infinity ? 0 : next - day,
  };
}
