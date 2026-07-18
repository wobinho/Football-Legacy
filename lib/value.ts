// Market value + wage curves (§8, §10). Value is a stored PlayerBio field,
// recomputed after aging and big performance swings.

import type { PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";

/** Age multiplier: peaks in early prime, collapses toward retirement. */
function ageCurve(age: number): number {
  if (age <= 21) return 1.15;
  if (age <= 24) return 1.25;
  if (age <= 28) return 1.0;
  if (age <= 30) return 0.75;
  if (age <= 32) return 0.5;
  if (age <= 34) return 0.28;
  return 0.12;
}

export function playerValue(p: Pick<PlayerBio, "overall" | "age" | "potential">, cfg: TuningConfig): number {
  const base = cfg.valueCurve.base * Math.exp(cfg.valueCurve.exponent * p.overall);
  const headroom = Math.max(0, p.potential - p.overall);
  const potMult = 1 + (cfg.youthPotentialValueBoost - 1) * Math.min(1, headroom / 15) * (p.age <= 23 ? 1 : 0.3);
  const raw = base * ageCurve(p.age) * potMult;
  // round to something readable: 3 significant-ish figures
  const mag = Math.pow(10, Math.max(3, Math.floor(Math.log10(raw)) - 2));
  return Math.max(50_000, Math.round(raw / mag) * mag);
}

/** Weekly wage the ability curve implies — the fallback when a player has no
 * individual contract yet (AI world, migrated saves before the first rollover). */
export function playerWage(overall: number, cfg: TuningConfig): number {
  return Math.round((cfg.wagePerOverallCurve.base * Math.exp(cfg.wagePerOverallCurve.exponent * overall)) / 100) * 100;
}

/** Squad wage bill (§10, v5): the sum of real contract wages. A player without a
 * contract (not yet negotiated) falls back to the ability-curve wage so the
 * bill never under-counts. */
export function squadWageBill(players: Pick<PlayerBio, "overall" | "contract">[], cfg: TuningConfig): number {
  return players.reduce((sum, p) => sum + (p.contract?.wage ?? playerWage(p.overall, cfg)), 0);
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}£${(abs / 1_000_000_000).toFixed(2)}bn`;
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}£${abs}`;
}

/** A large amount rendered as grouped digits ("54,000,000") — for editable
 * money inputs where the raw figure must stay legible but exact. */
export function groupDigits(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Parse a money figure a user typed into a plain number. Accepts grouped
 * digits ("54,000,000"), plain digits, and shorthand suffixes: k/K (thousand),
 * m/M (million), bn/B (billion). Returns null when nothing usable was typed. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/[£,\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(-?\d*\.?\d+)\s*(bn|b|m|k)?$/i);
  if (!m) return null;
  const mult = { bn: 1e9, b: 1e9, m: 1e6, k: 1e3 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  const val = parseFloat(m[1]) * mult;
  return Number.isFinite(val) ? Math.round(val) : null;
}
