// ── Single tuning config (GAME_DESIGN.md §14) ─────────────────────────────
// Every balance number lives here. Tuning never means editing engine code.
// Adjust only via the calibration harness (npm run calibrate).

import type { Mentality, ProspectTier, Style } from "../types";

/** How far a club went in a European cup — the axis the continental prize table
 * is keyed on. Every qualifier banks at least the `groupStage` figure. */
export type EuropeanCupStage =
  | "champion"
  | "runnerUp"
  | "semiFinal"
  | "quarterFinal"
  | "roundOf16"
  | "groupStage";

export interface TuningConfig {
  schemaVersion: number;

  // Match engine
  segmentsPerMatch: number;
  minutesPerSegment: number;
  /** Expected chances per segment for BOTH sides combined at equal midfields. */
  baseChancesPerSegment: number;
  goalProbFloor: number;
  goalProbCeil: number;
  /** Steepness of the ATTACK vs DEFENSE squash into goal probability. */
  chanceQualitySlope: number;
  /** Exponent on midfield strengths when computing chance share (>1 = quality tells more). */
  midfieldSharpness: number;
  /** ATTACK/(ATTACK+DEFENSE) value of two equal teams — centers the squash. */
  chanceQualityCenter: number;
  homeAdvantage: number; // +5% effective rating
  synergyCap: number; // ±20% (archetype/tactic synergy band)
  formMin: number;
  formMax: number;
  fitnessFloorMult: number; // ×0.85 exhausted
  outOfPositionFloor: number; // ×0.6 severe misplacement
  adjacentPositionMult: number;
  mentalityChanceMult: { Defensive: number; Balanced: number; Attacking: number };
  /** Defensive mentality also tightens the defense phase slightly. */
  mentalityDefenseMult: { Defensive: number; Balanced: number; Attacking: number };

  // ── Extended tactic instructions (§6, expanded) ──
  /** Tempo: chance volume for BOTH sides (like mentality) × a fitness-drain cost. */
  tempoChanceMult: { Slow: number; Standard: number; High: number };
  tempoFitnessDrainMult: { Slow: number; Standard: number; High: number };
  /** Width: shifts phase contribution between wide (LB/RB/LW/RW) and central roles. */
  widthWideMult: { Narrow: number; Standard: number; Wide: number };
  widthCentralMult: { Narrow: number; Standard: number; Wide: number };
  /** Press: own midfield share bonus, at a fitness-drain and chances-conceded cost. */
  pressMidfieldMult: { Low: number; Medium: number; High: number };
  pressFitnessDrainMult: { Low: number; Medium: number; High: number };
  pressOppChanceMult: { Low: number; Medium: number; High: number };
  /** Defensive line height: trades defense solidity for chance suppression vs exposure. */
  lineDefenseMult: { Deep: number; Standard: number; High: number };
  lineOppChanceMult: { Deep: number; Standard: number; High: number };
  /** Attacking focus biases scorer/assist weighting toward a flank or the centre.
   * "Wide" (v19) applies this same bias to BOTH flanks at once. */
  focusFlankBias: number; // extra scorer weight applied to the emphasised side (0..1)

  // ── Style shapes (v19) ──
  /** Each playing style carries an intrinsic shape beyond its per-archetype
   * synergy: how much of the ball it wins, how exposed it leaves the back line,
   * and what it costs in legs. This is what makes Gegenpress feel like pressing
   * and Park the Bus feel like a shell, without the engine ever naming a style.
   *
   * Applied multiplicatively alongside the existing instruction multipliers:
   *   midfield      → own midfield share (chance volume)
   *   defense       → own defensive solidity
   *   oppChance     → chances the OPPONENT generates (exposure)
   *   fitnessDrain  → own fitness cost
   *   wideBias      → extra scorer/assist weight for wide roles (flank routing) */
  styleShape: Record<
    Style,
    { midfield: number; defense: number; oppChance: number; fitnessDrain: number; wideBias: number }
  >;

  // ── Set pieces (v6, EA-FC-style assignments) ──
  penaltyChance: number; // chance a given chance is a penalty
  freeKickChance: number; // chance it's a direct free-kick
  cornerChance: number; // chance it's a corner
  penaltyConversion: number; // fixed goal probability for a penalty
  setPieceTakerBias: number; // scorer/assist weight multiplier for the designated taker

  /**
   * How often a goal is credited to a provider (v1.66). Real football assists
   * roughly three goals in four; the engine used to hand out an assist on only
   * 65% of open-play goals, so creative midfielders never built the season
   * numbers their archetype implied. A penalty is unassisted by definition, so
   * it is excluded in the engine rather than given its own rate here.
   */
  assistChance: number;
  /** Corners and free kicks are worked balls — nearly all of them are assisted. */
  assistChanceSetPiece: number;

  /**
   * Hidden style×mentality counter matrix (§6 strong/weak-against). Looked up as
   * counterMatrix[ownStyle][oppStyle] and a parallel mentality table; the product
   * multiplies own ATTACK at kickoff. Values sit inside a tight band so a good
   * matchup is an edge, never a guarantee — and the UI never reveals it.
   */
  styleCounter: Record<Style, Record<Style, number>>;
  mentalityCounter: Record<Mentality, Record<Mentality, number>>;

  subMinutes: number[]; // auto-sub check points
  maxSubs: number; // [OPEN §11] default 5
  /** A starter whose in-match fitness has fallen to/below this is a rotation
   * candidate — fresh legs come on if a bench option projects better. Set high
   * enough that normal late-match tiredness triggers rotation, not just
   * exhaustion (players rarely drop below ~78 over 90'). */
  subFitnessThreshold: number;
  /** Fraction (×) of the tired starter's current effectiveness a fresh bench
   * option must reach to come on. Below 1: late-match rotation accepts a small
   * quality dip for fresher legs and to spread minutes, since the XI is by
   * definition the best 11 and the bench is a notch weaker. Too low would field
   * scrubs; ~0.94 rotates squad-quality players without hollowing out the team. */
  subUpgradeMargin: number;
  clutchMinute: number; // Clutch trait activates from here

  // ── Dynamic substitutions (v1.66) ─────────────────────────────────────────
  // The old auto-sub pass only ever swapped a tired starter for a better bench
  // option, so a side that stayed fresh made zero changes and the bench never
  // played. An AI manager now has three separate reasons to make a change, each
  // with its own trigger, and a floor on how many it makes at all.
  /** Fewest changes a manager tries to make in a match, fitness permitting. The
   * engine works down its reason list until it has made this many. */
  minSubsPerMatch: number;
  /** Fitness at/below which a starter is pulled off on fatigue grounds alone —
   * no quality test, fresh legs win. Below `subFitnessThreshold`, which gates the
   * older "only if the bench is nearly as good" rotation. */
  fatigueSubFitness: number;
  /** Goal margin at/after `garbageTimeMinute` that makes the game safe enough to
   * empty the bench for minutes rather than results. */
  garbageTimeLead: number;
  garbageTimeMinute: number;
  /** In garbage time the quality bar drops to this fraction of the starter's
   * effectiveness — the point is to give squad players and prospects minutes. */
  garbageTimeUpgradeMargin: number;
  /** Age at/below which a bench player counts as a prospect and is favoured for
   * garbage-time minutes. */
  garbageTimeProspectAge: number;
  /** Match rating at/below which a starter is hooked for performance. Checked at
   * the halftime and early-second-half windows only. */
  performanceSubRating: number;
  /** Latest minute a performance sub is made — after this a manager rides it out. */
  performanceSubLastMinute: number;

  // ── Pre-match rotation (v1.66) ────────────────────────────────────────────
  // Selection now looks at fitness and fixture density before it picks, so a
  // congested week or a low-priority cup tie rotates rather than grinding the
  // same XI into the ground.
  /** Fitness below which a starter is rested if a credible deputy exists. */
  rotationFitnessThreshold: number;
  /** Days between matches at/below which the fixture list counts as congested,
   * lowering the rotation bar further. */
  congestedFixtureDays: number;
  /** Extra fitness points added to the rotation threshold in a congested week. */
  congestedRotationBonus: number;
  /** How much worse a deputy may be (fraction of the starter's selection score)
   * and still be rotated in. Separate values for league and low-priority cup. */
  rotationQualityFloor: number;
  cupRotationQualityFloor: number;
  /** Squad-role targets (v1.66). A player's share of available league minutes
   * the AI manager aims at, by role. Drives the rotation nudge that favours
   * whoever is furthest below their target. */
  roleMinutesTargetStarter: number;
  roleMinutesTargetRotation: number;
  roleMinutesTargetImpactSub: number;
  /** How strongly a minutes deficit against the role target biases selection,
   * as a fraction of selection score per unit of deficit. */
  roleMinutesSelectionWeight: number;

  // Fitness
  fitnessDrainPerMatch: number; // full 90 at age 27
  fitnessDrainAgeFactor: number; // extra drain per year over 30
  fitnessRecoveryPerDay: number;
  fitnessCoachRecoveryPerStar: number;
  physioRecoveryPerStar: number; // Head Physio adds to daily recovery (v5)
  minFitnessToStart: number; // AI won't start players below this

  // Staff match-day effect
  headCoachMatchdayPerStar: number; // effective-rating bonus per head-coach star

  // Form
  formNudgePerRatingPoint: number; // form drift after each match

  // Age realism (§5, v15 balance). A young player's *current* ability is his
  // eventual ability scaled by a smooth MATURITY curve, replacing the old
  // bracketed soft cap. The curve is continuous and monotonic in age, so a
  // 14-year-old is reliably weaker than a 16-year-old who is weaker than an
  // 18-year-old — the bracketed cap treated whole age bands as identical and
  // then jumped at the bracket edge.
  maturityStartAge: number; // youngest age the curve is defined from
  maturityFullAge: number; // age at which a player is physically finished (maturity = 1)
  maturityFloor: number; // maturity at maturityStartAge (0..1)
  maturityCurve: number; // >1 = most catching-up happens in the late teens
  maturitySpread: number; // sd of per-player noise around the curve
  youthProdigyChance: number; // per-young-player chance of an early-maturing prodigy
  youthProdigyKeepMin: number; // prodigy closes at least this fraction of the maturity gap
  youthProdigyKeepMax: number; // …up to this fraction

  // Height (v15). Rolled from the archetype's band; the youngest prospects are
  // still short of their adult frame. Display-only — the engine never reads it.
  heightFullAge: number; // age at which a player has reached adult height
  heightPerYoungYear: number; // fraction of adult height missing per year below it

  // Youth potential band (balance): growing players are given a hidden ceiling
  // in a high, well-spread band so almost every prospect is worth developing but
  // ceilings still vary meaningfully. Only applies to players young enough to
  // still grow (age <= growthEndAge); prime/veteran headroom is untouched.
  youthPotentialFloor: number; // growing players' potential is pulled up to at least this
  youthPotentialBandTop: number; // …and spread up toward this (capped by potentialAbsoluteCap)

  // Elite squad generation (superstars): the plain reputation curve tops the very
  // best clubs out around the mid-80s, so a fresh world holds no genuine 90-rated
  // stars. These lift a handful of the top clubs' first-choice players into
  // world-class territory, so the marquee names exist to chase and sign.
  eliteClubRepThreshold: number; // clubs at/above this reputation seed superstars
  eliteStarterBoostMax: number; // overall added to a top club's best starters, tapering by rep
  eliteStarterCount: number; // how many of a club's first-choice slots get the boost
  eliteHardCap: number; // no generated senior may exceed this overall (headroom for stars)

  // Player quality floor (balance): no generated player is ever weaker than this
  // overall. Keeps the world free of hopeless 38-rated bodies — every player is at
  // least a rough professional, and every prospect is worth developing.
  minOverall: number;

  // Development (§5)
  growthEndAge: number; // 24
  primeEndAge: number; // 34 — nominal end of the prime band (declineOnsetAge is what the engine reads)
  declineOnsetAge: number; // 32-33 base
  declineOnsetLongevitySwing: number; // ± years from longevity
  declineOnsetPaceReliancePenalty: number; // years earlier for pace archetypes
  growthPerSeasonMax: number;
  declinePerSeasonBase: number;
  // Fast-track band: players still under this overall grow faster (they're raw
  // and have the most room), so a low-50s prospect climbs briskly instead of
  // languishing. Growth is multiplied by up to `growthCatchupMult` at the floor,
  // fading to 1× as overall approaches `growthCatchupBelow`.
  growthCatchupBelow: number; // overall below which the catch-up boost applies
  growthCatchupMult: number; // max growth multiplier at the quality floor
  // Elite resistance (v1.66) — the mirror of the catch-up band at the TOP end.
  // Every other growth lever (minutes, coach, facility, training plan, academy
  // loan/U21/focus) is a multiplier that ignores how good the player already is,
  // so a stacked development environment moved an 88-rated player exactly as fast
  // as a 60-rated one. Headroom was the only brake, and `youthPotentialFloor`
  // guaranteed a ceiling near the cap to almost every youngster — which is how a
  // 19-year-old reached 90+ and a 75 became a 93 in two seasons.
  //
  // Growth is now multiplied by a factor that decays from 1 to
  // `growthEliteMultFloor` as overall climbs from `growthEliteAbove` to
  // `growthEliteCeiling`, so the last stretch to 90+ takes several seasons of
  // genuine excellence rather than one good campaign. The decay is exponential
  // (`growthEliteCurve` > 1 biases the damping toward the very top), so a 78 is
  // barely touched while an 88 crawls.
  growthEliteAbove: number; // overall at/below which there is no damping (1×)
  growthEliteCeiling: number; // overall at which damping reaches its floor
  growthEliteMultFloor: number; // the smallest multiplier the damping applies
  growthEliteCurve: number; // >1 pushes the damping toward the top of the band
  // Age → growth-rate curve (v17). Growth used to scale linearly with how far a
  // player sat below growthEndAge, which made the YOUNGEST player the fastest
  // developer — a 12-year-old projected +19 in a season. That is backwards:
  // a pre-teen is physically nowhere near able to add a dozen overall in a year.
  // The curve now PEAKS in the late teens (growthPeakAge) and falls away on both
  // sides, so 16–19 is the breakout window and the very young improve slowly.
  growthPeakAge: number; // age at which the growth multiplier is at its max
  growthPeakMult: number; // multiplier at the peak age
  growthYoungFalloffPerYear: number; // multiplier lost per year BELOW the peak
  growthOldFalloffPerYear: number; // multiplier lost per year ABOVE the peak
  growthAgeMultFloor: number; // the curve never drops below this
  // Prime-phase growth (§5, v1.44). Players past growthEndAge but not yet in
  // decline used to only drift a fraction of a point a season, so a late-20s pro
  // having a standout campaign barely improved. A strong prime season now earns
  // real overall — scaled by performance and minutes, capped per season, and
  // still bounded by the player's (dynamic) potential ceiling.
  primeGrowthPerSeasonMax: number; // max overall a prime player gains on a peak season
  primeGrowthPerfPivot: number; // avg rating at which prime growth kicks in (below → drift/decay)
  /** Share of a full season's prime growth that can be earned DURING the season
   * (v1.51). Prime players were excluded from the weekly progression tick
   * entirely, so a 25+ player's rating could not move until the summer — and,
   * because the potential ceiling had usually collapsed onto his overall by
   * then, often not even then. Prime players now drift up in-season on the same
   * weekly tick youngsters use, at this share of their seasonal allowance. */
  primeInSeasonShare: number;
  /** How far below `primeGrowthPerfPivot` (in normalised perf units, the same
   * -1..1 scale developPlayer uses) a prime season may fall before it costs the
   * player anything (v1.52). Inside this band an ordinary campaign simply holds
   * his level — he is not old yet, so nothing should erode automatically. */
  primeDeclineTolerance: number;
  /** Most overall a prime player can lose in one genuinely poor season (v1.52).
   * Scaled by how far past the tolerance he fell and by minutes played, so a
   * benchwarmer's bad numbers barely register. */
  primeBadSeasonMaxLoss: number;
  /** Headroom a prime player is granted above his current overall (v1.51), so a
   * player whose dynamic potential has converged onto his rating can still
   * improve on a strong campaign. Without this, `recalcPotential`'s
   * `max(overall, …)` floor leaves zero headroom and the prime branch is a
   * no-op — the "nobody over 24 ever grows" bug. Bounded by
   * `primeHeadroomCapOverall` so it never manufactures superstars. */
  primeHeadroomFloor: number;
  /** Overall above which the prime headroom floor tapers to nothing. A 70-rated
   * pro has room to become good; a 92-rated one is already at the ceiling. */
  primeHeadroomCapOverall: number;
  /** Overall at or below which a prime player carries the FULL headroom floor.
   * Above it the floor tapers linearly to zero at `primeHeadroomCapOverall`. */
  primeHeadroomFullBelow: number;
  retirementAgeMin: number;
  retirementAgeMax: number;

  // Dynamic potential (§5) — recalculated each summer from performance. Skews
  // upward: strong seasons unlock a higher ceiling (late bloomers); only chronic
  // underperformance trims it, and never below the player's current overall.
  potentialRecalcAgeMax: number; // potential only moves for players at/under this age
  potentialUpMax: number; // max upward nudge per season on a great campaign
  potentialDownMax: number; // max downward trim (rare — needs a poor season)
  potentialPerfPivot: number; // avg rating at which perf is "neutral"
  potentialMinutesFloor: number; // performance barely counts below this minutes share
  potentialAbsoluteCap: number; // no potential can exceed this
  // Training facility (Player Development) — growth-speed bonus per level.
  trainingFacilityGrowthPerLevel: number; // ×(1 + level*this) on youth growth
  medicalFacilityRecoveryPerLevel: number; // +fitness/day per level
  medicalFacilityAgeDrainReductionPerLevel: number; // softens over-30 drain (0..)

  // Economy (§8) — money in £
  /** Weekly central (TV) income by tier. Index = tier-1; MUST cover every tier
   * the pyramid can run (MAX_DIVISION_DEPTH), because a short array silently
   * pays a lower division at the rate of the last entry — which is how the
   * third and fourth tiers ended up on second-tier money. */
  weeklyIncomeByTier: number[];
  /** 1st-place weekly bonus by tier, scaling linearly to 0 for last. */
  positionBonusMaxByTier: number[];
  /** Weekly gate money per point of club reputation, by tier. */
  gateIncomePerReputationByTier: number[];
  wagePerOverallCurve: { base: number; exponent: number }; // weekly wage ≈ base * exp(exponent*overall)
  seasonPrizeByTier: number[]; // end-of-season prize for champion, scales down
  /** Per-position decay of the champion's prize: each place below 1st receives
   * `top × (1 − seasonPrizeDecayPerPosition)^(position−1)`. Applies to every
   * league regardless of size; relegated clubs are paid before the shuffle. */
  seasonPrizeDecayPerPosition: number;
  promotionBonus: number;
  cupWinBonus: number;

  // ── Season awards: team success weighting (v1.67) ──────────────────────────
  // An individual honour is decided on average match rating LIFTED by what the
  // player's club achieved (see lib/accolades.ts): a title, a cup run and a
  // European campaign all strengthen his case, as they do in the real awards.
  // Each weight is the maximum lift that component can add, so the three sum to
  // the biggest possible bonus a perfect season can carry.
  /** Max lift from finishing first in the league (decays linearly to 0 for last). */
  awardLeagueWeight: number;
  /** Max lift from winning the domestic cup (scaled by how far the club went). */
  awardCupWeight: number;
  /** Max lift from a European campaign (scaled by stage AND competition tier). */
  awardEuroWeight: number;
  /** How much of the European lift each exit stage earns, 0–1. */
  awardEuroStageScore: Record<import("../types").EuroStage, number>;
  /** Scale on the European lift by cup tier (index 0 = Champions League), so the
   * third-tier competition is worth a fraction of the first. */
  awardEuroTierScale: number[];

  // ── European Cup payouts (locked spec; consumed once the feature ships) ─────
  // Prize by how far a club goes in each of the three continental cups. Keyed by
  // cup tier (1 = Champions League, 2 = Europa, 3 = Conference) then by the stage
  // the club bows out at. "champion" = won the final; "runnerUp" = lost the final;
  // "semiFinal" = a beaten semi-finalist; "quarterFinal" = a beaten quarter-
  // finalist; "roundOf16" = knocked out in the R16; "groupStage" = eliminated in
  // the groups. Every club that qualifies banks at least its groupStage figure.
  // See the european-cups-design spec: 32 teams, 8 groups of 4, top 2 into a
  // two-leg R16/QF/SF and a single-match final.
  europeanCupPrizeByTier: Record<
    EuropeanCupStage,
    number
  >[];

  // Club income upgrades (§ club income, v43) — one-time cost per level, each
  // level replacing (not adding to) the previous level's payout. `cost[i]` is
  // the price of level i+1; `payout[i]` is what level i+1 pays. The two arrays
  // of a track are always the same length, and that length is its max level, so
  // there is no separate cap constant to keep in sync.
  //
  // Three flat weekly-income tracks, priced as brackets rather than as distinct
  // businesses: a small club climbs the low tier long before the high tier is
  // affordable, and a big one can hold all three.
  lowTierIncomeUpgradeCost: number[];
  lowTierIncomePayout: number[]; // weekly £ at each level
  midTierIncomeUpgradeCost: number[];
  midTierIncomePayout: number[];
  highTierIncomeUpgradeCost: number[];
  highTierIncomePayout: number[];
  // Squad-driven weekly income: pays `playerBonusPayout` per senior player whose
  // overall is at or above `playerBonusThreshold`, at the same level index. The
  // threshold rises with the payout, so a level is only worth buying once the
  // squad has grown into it.
  playerBonusUpgradeCost: number[];
  playerBonusPayout: number[]; // weekly £ per qualifying player
  playerBonusThreshold: number[]; // minimum overall to qualify, per level
  // Wage discount: the fraction of the weekly squad wage bill written off.
  contractAccountingUpgradeCost: number[];
  contractAccountingDiscount: number[]; // 0.02 = 2% off the wage bill
  // Match-driven lump sums, banked when the fixture is played rather than on the
  // weekly tick — see `applyMatchIncome` in lib/economy.ts.
  stadiumBonusUpgradeCost: number[];
  stadiumBonusPayout: number[]; // £ per home fixture
  performanceBonusUpgradeCost: number[];
  performanceBonusWin: number[]; // £ banked per result, by level
  performanceBonusDraw: number[];
  performanceBonusLoss: number[];

  // Staff market (v6) — dismiss-to-refresh cadence.
  staffRefreshDays: number; // days until a dismissed slot's new crop arrives
  /** Full turnover of the staff & scout for-hire pools every N days (v20), on
   * top of dismiss-to-refresh, so the shortlists never go stale. */
  marketRefreshDays: number;

  // Sponsors / investments (v6, Club → Income). Weekly income from season-long
  // deals; quality scales with club reputation, division, and Club
  // Marketability — a 0–100 score built from what the club has actually done.
  sponsorBaseWeeklyByReputation: number; // weekly £ per reputation point, shirt-scaled
  sponsorSlotShare: Record<string, number>; // per-slot fraction of the shirt baseline
  sponsorTierMults: number[]; // offer tier multipliers (Regional/National/Global)

  /** ── Club Marketability, the 0–100 score (v44) ──
   *
   * Replaces the v20 model, which read a handful of `marketabilityBonus` traits
   * off the squad. That made the whole commercial game hinge on whether the RNG
   * had handed you a player with one specific trait — a club could win the
   * league and see no change at all. Marketability is now built from four things
   * the manager actually controls, each capped at its own weight and summing to
   * 100. Every number below is a band table read by `lib/marketability.ts`; the
   * engine holds no thresholds of its own.
   */

  /** A. League & Division Status (35 pts max). Points by league tier, index 0 =
   * tier 1. A club in a tier past the end of the table takes the last entry. */
  marketabilityTierPoints: number[];
  /** Added on top of the tier points when the club is in a continental cup —
   * the qualification bonus. Still capped by `marketabilityWeightLeague`. */
  marketabilityEuropeanBonus: number;
  /** The cap (and stated weight) of factor A. */
  marketabilityWeightLeague: number;

  /** B. Squad Star Power (25 pts max). Bands on the mean overall of the club's
   * top `marketabilityStarPowerTopN` senior players: `[minAverage, points]`,
   * read low to high — the last band whose `minAverage` is met wins. */
  marketabilityStarPowerBands: [number, number][];
  /** How many of the highest-rated senior players the average is taken over. */
  marketabilityStarPowerTopN: number;
  /** The cap (and stated weight) of factor B. */
  marketabilityWeightStarPower: number;

  /** C. Recent Team Form (25 pts max). Points are earned over the club's last
   * `marketabilityFormMatches` completed matches — a win is worth `…FormWin`, a
   * draw `…FormDraw`, a defeat nothing — then scaled from that raw maximum onto
   * the weight. An unbeaten run of `…FormUnbeatenGames` or more adds a flat
   * bonus on top, before the cap. */
  marketabilityFormMatches: number;
  marketabilityFormWin: number;
  marketabilityFormDraw: number;
  marketabilityFormUnbeatenGames: number;
  marketabilityFormUnbeatenBonus: number;
  /** The cap (and stated weight) of factor C. */
  marketabilityWeightForm: number;

  /** D. Club Facilities & Infrastructure (15 pts max). Bands on the club's mean
   * income-upgrade level across `FACILITY_KEYS`: `[minAverageLevel, points]`,
   * read low to high. */
  marketabilityFacilityBands: [number, number][];
  /** The cap (and stated weight) of factor D. */
  marketabilityWeightFacilities: number;

  /** ── What the score buys ──
   *
   * One row per star band, low to high. `maxPoints` is the top of the band on
   * the 0–100 scale; `offers` is how many offers may sit on the table at once;
   * `valueMult` multiplies every offer's money; `flavour` names the calibre of
   * brand that comes calling. Five rows = five stars. */
  marketabilityTiers: { maxPoints: number; offers: number; valueMult: number; flavour: string }[];
  /** How much more often a high-marketability club is shown National/Global
   * brands rather than Regional ones, per star above the first. */
  marketabilityTierPull: number;
  /** Fraction a slot's post-lapse cooldown shortens per star above the first, so
   * suitors return quicker to a club brands actually want. Clamped at 80%. */
  marketabilityCooldownPerStar: number;
  sponsorLengthMin: number; // shortest deal offered (seasons)
  sponsorLengthMax: number; // longest deal offered
  sponsorOfferExpiryDays: number; // an unsigned offer expires after this many days
  sponsorRefreshDays: number; // days after slot empties before a new offer lands
  // Major (lump-sum) vs minor (weekly) investments (v7). Majors pay a one-time
  // upfront ≈ (equivalent weekly × ~52 weeks × season length × incentive mult);
  // minors run at most one season and pay weekly.
  sponsorMajorSlots: string[]; // which slots are lump-sum majors
  sponsorMajorUpfrontMult: number; // incentive multiplier on the equivalent-weekly lump
  /** Multiplier on a minor (weekly) deal's income (v1.43): the weekly partnerships
   * pay this fraction of their raw offer amount. */
  sponsorMinorWeeklyMult: number;
  sponsorMajorLengthMin: number; // shortest major deal (seasons)
  sponsorMajorLengthMax: number; // longest major deal (seasons)
  // Investment deadlines & slot discipline (v11). An offer is a real decision:
  // it sits on the table for a short, visible window and is gone if not signed,
  // after which the slot goes quiet for a cooldown before a new suitor appears.
  sponsorDeadlineDaysMajor: number; // days a major offer stays on the table
  sponsorDeadlineDaysMinor: number; // days a minor offer stays on the table
  sponsorCooldownDaysMin: number; // shortest quiet spell after a lapsed/passed offer
  sponsorCooldownDaysMax: number; // longest quiet spell
  /** Minimum length for a major deal, in seasons. Enforced at offer generation
   * so a lump sum is always a multi-season commitment rather than a yearly
   * re-signable windfall. */
  sponsorMajorMinSeasons: number;
  /** Per-slot concurrent-deal capacity (v19). Replaces the old global
   * `sponsorMaxActiveMajors` cap: scarcity now lives in the slot table, where it
   * makes football sense. A club has exactly one front-of-shirt sponsor and one
   * kit manufacturer, but can carry several regional partners at once. Keyed by
   * SponsorSlot; a slot absent here defaults to 1. */
  sponsorSlotCapacity: Record<string, number>;

  /** ── Performance-bonus offers (v44) ──
   *
   * A sponsor may present its offer two ways: the whole sum guaranteed now, or
   * less now plus a bonus if the club hits a target. The bonus variant is the
   * gamble, so it is only ever *offered* — the guaranteed figure is always
   * available alongside it.
   */
  /** Chance a given offer carries a performance-bonus alternative at all. */
  sponsorBonusOfferChance: number;
  /** Fraction of the guaranteed money paid up front on the bonus variant. */
  sponsorBonusUpfrontShare: number;
  /** The bonus itself, as a multiple of the money given up by taking option B.
   * Above 1.0 the gamble pays out more than it costs, which is what makes it a
   * decision rather than a tax on optimism. */
  sponsorBonusPayoutMult: number;
  /** League position the club must finish at or above to trigger the bonus. */
  sponsorBonusFinishPosition: number;

  /** ── Early buyout (v44) ──
   *
   * A multi-season major signed in the third division is a millstone once you
   * are promoted. It can be bought out early for a penalty, freeing the slot for
   * a deal worth several times as much.
   */
  /** Penalty as a fraction of the deal's remaining value. */
  sponsorBuyoutPenaltyRate: number;
  /** Seasons a deal must have run before it can be bought out at all, so a deal
   * cannot be signed and immediately flipped. */
  sponsorBuyoutMinSeasonsHeld: number;

  // AI club commercial income (v19). AI clubs don't run the offer machinery;
  // each carries one derived weekly figure standing in for its whole portfolio.
  /** Weekly £ per reputation point of abstract AI commercial income. */
  aiCommercialPerReputation: number;
  /** Multiplier on AI commercial income by division tier (index = tier-1). */
  aiCommercialTierMult: number[];
  /** Seeded ± variance band on an AI club's commercial income, so equally-sized
   * clubs don't all bank identical money. */
  aiCommercialVariance: number;
  /** An AI club's seasonal lump-sum investment windfall, as a multiple of its
   * weekly commercial income. Fallback only (v1.5): a club that actually holds
   * major deals banks those instead, and this covers a club whose majors have
   * all lapsed so a barren season isn't a total commercial blackout. */
  aiInvestmentWindfallWeeks: number;

  // AI sponsor portfolios (v1.5). AI clubs now hold real SponsorDeal objects in
  // the same shape the user signs, resolved automatically at the rollover: the
  // majors pay their lump sum into the budget, the minors set the weekly
  // commercial income. What the AI can't do is *decline* — it takes what the
  // market offers, which is what "passive" means here.
  /** Chance an AI club fills an open major slot in a given season. Below 1 so
   * portfolios differ: not every club has a naming-rights partner. */
  aiSponsorMajorFillChance: number;
  /** Chance an AI club fills each open minor slot place in a given season. */
  aiSponsorMinorFillChance: number;
  /** Multiplier on the offer value an AI club is quoted, against the same
   * reputation/tier maths the user's offers use. Slightly under 1: the user
   * negotiates their book, the AI simply accepts what lands. */
  aiSponsorValueMult: number;

  // Training facilities (Player Development). One-time upgrade cost per level;
  // no weekly income — they speed development / recovery instead. Costs are a
  // major-infrastructure decision (v15): a training centre competes with a
  // marquee signing, not with a squad-player fee.
  trainingFacilityMaxLevel: number;
  trainingUpgradeCost: number[];
  medicalUpgradeCost: number[];
  /** Gymnasium (v20): a core facility lifting development speed for the whole
   * squad, every age — a pure multiplier read by the development pass. */
  gymnasiumUpgradeCost: number[];
  gymnasiumGrowthPerLevel: number; // ×(1 + level*this) on every player's growth

  // ── Specialist training facilities (v15) ──
  // Beyond the general Training Centre, a club can invest in facilities that
  // sharpen a specific part of development. Each is the same one-time-purchase
  // pattern; all are pure multipliers read by the development pass, so the
  // engine never special-cases a facility by name.
  /** Position-focused centres: growth bonus for players whose primary position
   * sits in the named group. Keyed by the same groups the training plans use. */
  positionFacilityMaxLevel: number;
  positionFacilityGrowthPerLevel: number;
  gkCentreUpgradeCost: number[];
  defenceCentreUpgradeCost: number[];
  midfieldCentreUpgradeCost: number[];
  attackCentreUpgradeCost: number[];
  /** Plan-focused facilities: amplify the effect of a training plan, so a squad
   * training a focus with the matching facility develops that focus faster. */
  planFacilityMaxLevel: number;
  planFacilityBoostPerLevel: number; // added to a matching plan's growthMult −1
  sportsScienceUpgradeCost: number[]; // physical/pace plans
  techCentreUpgradeCost: number[]; // technical plans (playmaking, ball control)
  finishingCentreUpgradeCost: number[]; // finishing plans
  /** Youth-specific: lifts growth for players still in the academy age range. */
  youthDevCentreUpgradeCost: number[];
  youthDevCentreGrowthPerLevel: number;

  // Contracts (§10, v5 — individual wages + length + expiry)
  /** Weekly wage ≈ base * exp(exponent*overall). Same curve as the old
   * aggregate bill so squad economics don't lurch, now per-player. */
  contractWageCurve: { base: number; exponent: number };
  contractLengthMin: number; // shortest deal a player will sign (seasons)
  contractLengthMax: number; // longest deal offered
  /** Wage a player demands on a new deal ≈ their curve wage × this, nudged by
   * age (youth cheaper, primed stars dearer). */
  contractDemandMult: number;
  contractRenewYearsDefault: number; // default renewal length the UI proposes
  /** A player accepts an offer whose wage ≥ demand × this. Below it they
   * counter with their demand; well below, they reject. */
  contractAcceptRatio: number;
  contractRejectRatio: number;
  /** Age at/above which players prefer shorter deals (won't sign long). */
  contractVeteranAge: number;

  // ── Wage market scale (v1.65) ────────────────────────────────────────────
  // The wage curve alone priced every player by ability, so a 70-overall player
  // cost the same in a fourth-tier side as in the Premier League — which made
  // the lower divisions and the smaller nations unaffordable by construction.
  // Wages are now multiplied by the market a player is actually paid in: the
  // division's tier, and the standing of the country's league system. Both are
  // pure data; nothing in the engine names a country.
  /** Wage multiplier by division tier, index = tier−1. A club below the last
   * entry keeps the last one. Tier 1 is the reference (1.0). */
  wageTierMult: number[];
  /** Wage multiplier by country league-system band. `wageCountryBands` lists
   * the country codes in each band; the multiplier is the matching entry of
   * `wageCountryBandMult`. A country in no band takes `wageCountryBandDefault`. */
  wageCountryBands: string[][];
  wageCountryBandMult: number[];
  wageCountryBandDefault: number;
  /** Floor on the combined multiplier, so no market can drive wages to nothing. */
  wageMarketMultMin: number;

  // ── Release clauses (v21) ────────────────────────────────────────────────
  /** The lowest clause a player will entertain, as a multiple of his market
   * value. Anything under this is an insult — he rejects the term outright. */
  releaseClauseMinMult: number;
  /** At/above this multiple of value the clause is so remote he stops caring,
   * and it buys no wage discount at all. */
  releaseClauseMaxMult: number;
  /** The biggest wage discount a clause can buy, applied at the minimum
   * multiple and tapering linearly to zero at the maximum. */
  releaseClauseMaxWageDiscount: number;
  /** The multiple of value the UI proposes when a clause is switched on. */
  releaseClauseSuggestedMult: number;

  // Scouting network facility (v5): raises concurrent scout assignments. Bought
  // from the Scouting Department Upgrades panel (Academy → Scouting).
  scoutNetworkMaxLevel: number; // capacity = scoutNetworkBase + level
  scoutNetworkBase: number; // assignments available at level 0 (with a scout hired)
  scoutNetworkUpgradeCost: number[]; // one-time cost to reach each level

  // Academy squad-size facility (v7): raises how many prospects the academy can
  // hold at once. Bought from the Academy Upgrades tab. Cap =
  // academySquadSizeBase + level*academySquadSizePerLevel.
  academySquadSizeBase: number; // prospects the academy holds at level 0
  academySquadSizePerLevel: number; // + per upgrade level
  academySquadMaxLevel: number;
  academySquadUpgradeCost: number[]; // one-time cost to reach each level

  // Focus-slots facility (v8): raises how many prospects can be flagged as focus
  // at once. Bought from the Academy Upgrades tab. Slots = u21FocusBase + level,
  // never exceeding u21FocusMax (the absolute cap).
  focusSlotMaxLevel: number; // levels available; each level is +1 focus slot
  focusSlotUpgradeCost: number[]; // one-time cost to reach each level

  // Scout Speed facility (v1.68): logistics, retainers and a travel budget that
  // shorten the gap between a scout's reports. Bought from the Academy Upgrades
  // tab. The cadence is scaled by (1 − level*scoutSpeedPerLevel), so each level
  // takes 5% off the wait and a fully-built department reports in half the time —
  // a 14-day cycle becomes 7.
  scoutSpeedMaxLevel: number;
  scoutSpeedPerLevel: number; // fraction of the wait removed per level (0.05 = 5% faster)
  scoutSpeedUpgradeCost: number[];

  // Scout Network facility (v1.68): a ONE-TIME purchase that unlocks the brief
  // auto-filter — until it is bought, a scout files whatever they find and the
  // filter controls are locked. Level is 0 or 1; there is nothing to scale.
  scoutFilterMaxLevel: number;
  scoutFilterUpgradeCost: number[];

  // Youth PR facility (v1.65): media and commercial work around the academy that
  // raises what the market thinks your prospects are worth. Bought from the
  // Academy Upgrades tab. Value multiplier = 1 + level*youthPrValuePerLevel,
  // applied to academy prospects only.
  youthPrMaxLevel: number;
  youthPrValuePerLevel: number; // +fraction of value per level (0.03 = +3%)
  youthPrUpgradeCost: number[]; // one-time cost to reach each level

  // Transfers (§10 — interim rules pending design session)
  valueCurve: { base: number; exponent: number }; // value ≈ base * exp(exponent*overall)
  youthPotentialValueBoost: number; // multiplier at max headroom
  aiAcceptThreshold: number; // accept if bid >= value * threshold (fringe)
  aiKeyPlayerPremium: number; // starters demand more
  aiBidChancePerWeek: number; // chance an AI club bids on a user player
  /** Most incoming offers that can land on the user in a single week (v1.51).
   * The tick used to stop at the first one, so the user saw at most one approach
   * a week however many clubs wanted their players. */
  aiMaxOffersPerWeek: number;
  /** Most clubs that can have a live bid in for the SAME player at once (v1.51)
   * — a bidding war the user can play off against itself. */
  aiMaxBiddersPerPlayer: number;
  /** Chance each additional rival joins the bidding once one club has moved. */
  aiRivalBidChance: number;
  freeAgentSigningFee: number;
  // ── Ask-price compression (v1.43+) ──
  // The selling-club signals (stance, key-player, youth) still order who costs a
  // little more, but the whole ask spread is squashed toward the player's market
  // value and clamped, so a listed player always asks *near* his value.
  askValueCompression: number; // 0 = every ask is exactly 1.0× value; 1 = uncompressed
  askValueMinMult: number; // lowest an ask can fall relative to value
  askValueMaxMult: number; // highest an ask can rise relative to value
  // Incoming-offer negotiation (EA-FC-style). A buyer opens below its ceiling and
  // the user can counter with any number; the AI accepts at/under the ceiling,
  // counters back toward the midpoint, or walks if pushed too far / too long.
  negotiationBuyerCeilingMult: number; // ceiling ≈ value * this (over the opening offer)
  negotiationMaxRounds: number; // legacy round cap (still the fallback bound)
  negotiationWalkAwayOver: number; // instant walk if a counter exceeds ceiling * this
  // ── Negotiation patience (v19) ──
  // Patience replaces the flat round counter with a per-deal budget the user can
  // actually see. Every counter spends patience; a reasonable ask costs little,
  // a greedy one costs a lot. At zero the buyer walks. Rolled per offer, so each
  // negotiation genuinely has its own temperament.
  negotiationPatienceMin: number; // lowest starting patience a buyer can roll
  negotiationPatienceMax: number; // highest starting patience a buyer can roll
  /** Patience spent by simply making a counter, before greed is priced in. */
  negotiationPatienceCostBase: number;
  /** Extra patience burned per 1.0× of ceiling the ask overshoots by. Asking
   * just over the ceiling is cheap; asking double is ruinous. */
  negotiationPatienceCostPerOvershoot: number;
  /** A buyer who still has patience but can't meet the ask counters back. This
   * is how far it moves from its current offer toward the ask (0..1). */
  negotiationCounterStep: number;
  /** When the user's ask is beyond reach, the buyer proposes what it CAN do —
   * its counter lands at this fraction of its own hidden ceiling, so the reply
   * is a genuine best-and-final rather than a token nudge. */
  negotiationBestAndFinalShare: number;

  // ── Player transfer consent (§10, v1.66) ─────────────────────────────────
  // A move is no longer decided by the buying club alone: the player has to be
  // willing to go. Two things gate it — the standard of football he'd be
  // dropping to (division + club reputation), and the wage, which is floored by
  // what he is rather than by what the buyer can afford. Both loosen over time
  // for a player who isn't playing, which is the "desperation curve" that lets a
  // fallen star eventually drop down without letting him do it instantly.

  /** Overall at/above which a player is a "top-tier" name and applies the hard
   * division gate below. Under this he'll go wherever the football is. */
  consentEliteOverall: number;
  /** Divisions below his current one an elite player will drop, at full standing.
   * 1 = he'll go one tier down and no further. */
  consentMaxTierDrop: number;
  /** Club-reputation gap (his club's rep minus the buyer's) an elite player
   * tolerates. Beyond it he refuses even inside the tier limit — this is what
   * stops a Premier League star joining a newly-promoted top-flight minnow. */
  consentMaxRepDrop: number;
  /** Reputation a club needs before an elite player treats it as a peer
   * regardless of tier — a big foreign club in a lesser division. */
  consentPeerReputation: number;

  // ── Wage floors (v1.66) ──
  // The v1.65 market scaling quotes a player his league's going rate, which gave
  // lower-division buyers an automatic discount on exactly the players they
  // shouldn't be able to afford. A player now carries a personal floor from his
  // ability and standing, and the buyer either meets it or fails canAfford.
  /** Fraction of his CURRENT market-rate wage a player will never sign below,
   * whatever division the buyer is in. */
  wageFloorShareOfCurrent: number;
  /** Ability-anchored floor: the share of his own top-market (tier-1) wage he
   * demands regardless of where he's going. Anchors free agents and players
   * whose current deal is out of step with their ability. */
  wageFloorShareOfAbility: number;
  /** Extra floor per point of overall above `consentEliteOverall` — a star
   * prices himself further out of a small club's reach than a squad player. */
  wageFloorEliteStep: number;

  // ── Expectation decay / desperation curve (v1.66) ──
  // A player who isn't playing, or who has no club at all, gradually accepts
  // less. Decay is measured in in-game days of inactivity, tracked on the player.
  /** Days of inactivity before the curve starts to bite at all. */
  desperationGraceDays: number;
  /** Days from the end of grace to full desperation (the caps below). */
  desperationFullDays: number;
  /** At full desperation: extra tiers he'll drop, and the fraction of his wage
   * floor he'll accept. Both interpolate from 0 / 1.0 across the curve. */
  desperationMaxExtraTierDrop: number;
  desperationMinWageFloorShare: number;
  /** Share of a season's available minutes below which a squad player counts as
   * "not playing" and starts accruing inactivity. */
  desperationMinutesShare: number;
  /** A free agent decays faster — no club at all is worse than a bad one. */
  desperationFreeAgentMult: number;

  // ── Club AI strategy (§10) ──
  // A club's stance is re-evaluated when each window opens; these are the
  // thresholds that classify it. Per-stance behaviour lives in the
  // STANCE_PROFILE table in lib/ai/strategy.ts.
  aiTitleContenderRatio: number; // league position ratio (0=top) to consider a title push
  aiUnderperformBand: number; // how far below expectation before stance turns negative
  aiStanceTolerance: number; // slack allowed against expectation before it counts
  aiStrugglingRatio: number; // position ratio at/below which a club is failing outright
  aiAgeingSquadAge: number; // mean squad age at/above which a squad reads as old
  aiHealthyBudgetRatio: number; // budget < squad value * this = financially squeezed
  // Squad-need scoring: what makes a position urgent and a target worth signing.
  aiDepthUrgencyWeight: number; // urgency added per missing body at a position
  aiNeedScoreWeight: number; // how much positional urgency amplifies a target's score
  aiMinUpgradeGain: number; // a signing must beat the incumbent by at least this
  aiAgeBandFalloff: number; // interest multiplier per year outside the stance age band
  aiMaxBudgetSharePerDeal: number; // most of its budget a club commits to one player
  // Market volume.
  aiDealsPerWeek: number; // base AI↔AI deals attempted each week a window is open
  aiFreeAgentSignChance: number; // chance an acting club with no target signs a free agent
  aiRenewChance: number; // chance per window an AI club renews a final-year first-teamer
  aiWindowDealsPerLeague: number; // AI↔AI deals each playable division attempts when a window opens (v1.51)
  freeAgentPoolFloor: number; // free agents the AI leaves unsigned, so the user's tab is never empty (v1.51)
  aiSimDealsPerLeaguePerWindow: number; // intra-league AI↔AI deals each sim league does per window (v1.44)
  aiSimCrossLeagueDealsPerWindow: number; // cross-league AI↔AI deals across the whole sim world per window (v1.44)

  // ── Peer-club priority (v1.66) ──
  // When a high-reputation player comes available, his own level of club gets
  // first refusal. A lower-tier club can still sign him, but only once the peers
  // have had their window and passed.
  /** Player reputation (overall) at/above which the priority window applies. */
  peerPriorityOverall: number;
  /** Days from a player becoming available during which only peer clubs may bid.
   * Measured from `availableSince` on the player. */
  peerPriorityDays: number;
  /** A club counts as a peer if it is within this many tiers of the player's own
   * division, or over `consentPeerReputation`. */
  peerPriorityTierBand: number;

  // ── AI financial discipline (v19) ──
  // AI clubs must live within their means: a fee has to clear the budget with
  // room left to run the club, and a seller banks the money it takes in.
  /** Fraction of its budget an AI club must still hold AFTER a purchase — it
   * never spends itself to zero on a signing. */
  aiBudgetReserveRatio: number;
  /** Weeks of wage bill an AI club keeps in reserve before it will buy at all.
   * A club that can't cover its own wages doesn't go shopping. */
  aiWageReserveWeeks: number;
  /** A club under its wage reserve becomes a forced seller: it will accept this
   * fraction of the normal asking price to raise cash quickly. */
  aiDistressSellDiscount: number;
  /** Most a club will let its wage bill grow, as a multiple of its weekly
   * income — signings that blow this are refused regardless of the fee. */
  aiMaxWageToIncomeRatio: number;

  // ── Squad-quality income scaling (v1.51) ───────────────────────────────────
  // Wages grow exponentially with overall, but tier income is a flat constant.
  // With a database rated above the built-in one, whole divisions ended up
  // permanently over `aiMaxWageToIncomeRatio`, so `canAfford` refused every deal
  // and the transfer market went silent. `weeklyIncomeEstimate` therefore scales
  // a club's income by its squad's standard, using the SAME exponent as the wage
  // curve so the two move together and the ratio is database-independent.
  /** Squad average overall at which the quality multiplier is exactly 1.0. */
  wageIncomeBaselineOverall: number;
  /** Clamps on that multiplier, so a modded outlier can't run income away. */
  wageIncomeQualityMultMin: number;
  wageIncomeQualityMultMax: number;

  /** AI squad size ceiling. The user's first team is uncapped (v14) — the wage
   * bill is what limits hoarding — so this only bounds AI roster building. */
  squadCap: number;
  matchdaySquad: number;

  // Sim leagues (§4)
  simTableNoise: number; // sd of strength noise in synthetic tables

  // ── Youth Academy (§18) ──
  academyMaxAge: number; // last age a player may spend in the academy (age-out at +1)
  academyPromoteMinAge: number; // youngest age a prospect may be promoted to the senior team
  academyMaxLevel: number;
  academyUpgradeCost: number[]; // one-time cost to reach each level
  academyUpkeepPerLevel: number; // weekly cost per academy level
  // Academy player wages (v25). Prospects are on youth terms — a small weekly
  // scholarship rather than a full professional contract — so each one draws a
  // wage inside this band, scaled by his current ability between the two ends.
  academyWageMin: number; // weekly wage of the rawest prospect
  academyWageMax: number; // weekly wage of a senior-ready prospect
  academyWageOverallLo: number; // overall mapped to academyWageMin
  academyWageOverallHi: number; // overall mapped to academyWageMax

  // Intake day (mid-March, once per season)
  intakeClassBase: number; // class size at level 0
  intakeClassPerLevel: number; // + per academy level (rounded)
  intakeAgeMin: number;
  intakeAgeMax: number;
  // Intake quality (v15) now runs through the shared PROSPECT_TIERS bands — the
  // academy's level, youth coach and reputation bias which tier a kid lands in,
  // exactly as a scout's judgement does. The old per-age overall band is gone;
  // the maturity curve handles age scaling instead.
  intakeOverallBase: number; // raw ability center of a new class (legacy, scouted path)
  intakeOverallSpread: number;
  intakePotentialBase: number; // potential distribution center at level 0
  intakePotentialPerLevel: number; // + per academy level
  intakePotentialPerCoachStar: number; // + per youth-coach star
  intakePotentialRepFactor: number; // + per point of club reputation
  intakePotentialSpread: number; // sd of the potential roll
  goldenGenChance: number; // seeded chance a class is a golden generation
  goldenGenExtra: number; // extra class members in a golden generation
  goldenGenPotentialMin: number; // elite rolls granted to 1-2 golden kids
  goldenGenPotentialMax: number;

  // Potential fog-of-war (star ranges for players under growthEndAge)
  fogBaseWidth: number; // potential-point width of the range at zero information
  fogBaseError: number; // max seeded offset of the estimate from truth
  fogMinWidth: number; // the range never gets tighter than this
  fogCoachStarReduction: number; // fraction of fog removed per youth-coach star (own players)
  fogScoutStarReduction: number; // fraction removed per scout star (everyone else's)
  starScaleMin: number; // bottom of the 1★ band (potential below this still reads 1★)
  starScaleMax: number; // bottom of the 5★ band — a full five stars means "this or better"
  starScalePerHalf: number; // potential points per half-star step

  // U21 league (12 teams, double round-robin, statistical)
  u21MinutesWeight: number; // youth minute worth vs a senior minute (development)
  u21FocusBase: number; // focus slots at focusSlotLevel 0
  u21FocusMax: number; // absolute cap on focus slots (fully upgraded)
  u21FocusGrowthBonus: number; // extra growth multiplier for focus prospects
  u21SquadGrowthBonus: number; // extra growth multiplier for players tagged into the U21 squad
  u21GoalsPerMatch: number; // youth football is looser than the senior game
  u21OppStrengthBase: number; // opponent strength = base + rep * perRep (+noise)
  u21OppStrengthPerRep: number;
  u21CoachStrengthPerStar: number; // youth-coach bonus to user U21 strength

  // U21 competitions (v18): two runnings a season, each a 22-round double
  // round-robin, each opened by a registration window the user must meet.
  u21CompetitionsPerSeason: number;
  u21RoundsPerCompetition: number;
  u21FirstKickoffDays: number; // days after the senior season starts that competition 1 begins
  u21RegistrationLeadDays: number; // registration opens this many days before kickoff
  u21RoundIntervalDays: number; // days between U21 rounds
  u21RegistrationSize: number; // players a club registers per competition

  // Rival prospect trading (v18). Each U21 side rolls a stance on selling the
  // seven it registered; the stance sets the multiplier on the asking price.
  u21SellStanceWeights: { willing: number; premium: number; unwilling: number };
  u21SellPricePremiumMult: number; // "sell it high" asking-price multiplier
  u21SellPriceWillingMult: number; // an ordinary, fair-value ask
  /** Extra multiplier applied on top of the stance, per prospect tier — a club
   * does not let its obsidian or legacy kid go at the going rate. A tier absent
   * from the table asks no premium (multiplier 1). */
  u21SellTierMult: Partial<Record<ProspectTier, number>>;
  /** Chance a "willing"/"premium" club refuses outright anyway, rolled per
   * approach — even a seller has kids it will not part with. */
  u21SellRefusalChance: number;

  // Youth scouting (set a focus, reports arrive)
  scoutReportDaysBase: number; // days between reports at 1 star
  scoutReportDaysPerStar: number; // days shaved per star
  scoutReportExpiryDays: number;
  scoutFeeMult: number; // asking fee = market value × this
  scoutProspectAgeMin: number;
  scoutProspectAgeMax: number;
  scoutPotentialBase: number; // scouted prospects skew above intake fodder
  scoutPotentialPerStar: number;
  scoutPotentialSpread: number;

  // ── Scout experience & judgement (v14) ──
  // A scout is two independent 1–5★ ratings. EXPERIENCE decides how many
  // prospects a report brings back (1–6); JUDGEMENT decides how good they are
  // (which ProspectTier each find lands in). Both are pure distribution tables
  // indexed by star rating, so the engine only ever samples — it never
  // special-cases a rating.
  /** Per experience star (index 1–5), the probability weights over report sizes
   * 1…N, where N is the row's own length. Row index 0 is unused (no scout, no
   * report). Each row is normalised at sample time, so the numbers read as
   * relative likelihoods whether or not they already sum to 100. */
  scoutReportSizeByExperience: number[][];
  /** Per judgement star (index 1–5), the probability weights over the prospect
   * tiers in `prospectTierOrder`. Row 0 unused. */
  scoutTierByJudgement: number[][];
  /** Tier order the weight rows above are indexed against. */
  prospectTierOrder: ProspectTier[];
  /** Per-tier quality bands. `overall` is the ability a find comes back with and
   * `potential` the ceiling it is given — a Diamond prospect is the wonderkid.
   * Both are inclusive [min, max] ranges, clamped to potentialAbsoluteCap. */
  prospectTierBands: Record<ProspectTier, { overall: [number, number]; potential: [number, number] }>;
  /** Fraction of potential fog a judgement star removes on that scout's own
   * reports — a sharp judge of a player also reads the ceiling more tightly. */
  fogJudgementStarReduction: number;
  /** Scout wages/fees scale on the two ratings combined (v14). */
  scoutWageBase: number;
  scoutWagePerStar: number;
  scoutFeePerStar: number;
  /** Days between reports at 1★ experience, and days shaved per experience star.
   * An experienced scout files more often as well as more fully. */
  scoutMaxHireable: number; // absolute ceiling on employed scouts (base + Max Scouts levels)

  // Loans (out only)
  loanMaxAge: number;
  loanWeeklyChance: number; // chance per open-window week a listed player is taken
  loanMinutesPerWeek: number; // statistical minutes credited per week on loan
  loanMinutesWeightTop: number; // minute weight by destination: tier 1 / tier 2 / sim
  loanMinutesWeightSecond: number;
  loanMinutesWeightSim: number;
  // Direct academy loans (v1.44): how suitor clubs are picked when a prospect is
  // sent out. A prospect is loaned to play, so the ideal home sits repMargin
  // above nothing — targetRep = overall + repMargin — clubs beyond repCeiling
  // over his level are dropped, and one within starterBand plays him regularly.
  academyLoanRepMargin: number;
  academyLoanRepCeiling: number;
  academyLoanStarterBand: number;
  academyLoanJitter: number;
  // Loan development (v1.52). A loan is the substitute route to growth when
  // first-team minutes aren't there: the point is that a well-chosen loan gives
  // a young player a season of RELIABLE football, which is what the development
  // curve actually rewards. `loanStarterMinutesMult` is what a loanee gets at a
  // club that will play him every week (role "Regular starter"); a rotation move
  // gets the rest. `loanGrowthBonus` is the extra growth multiplier a season on
  // loan carries at the rollover, on top of the minutes themselves — coaching
  // and competitive football at a level that suits him.
  loanStarterMinutesMult: number;
  loanRotationMinutesMult: number;
  loanGrowthBonus: number;
  // Direct sales (v1.52). The chooser only means something if the clubs on it
  // offer genuinely different money, so a suitor's bid is market value moved by
  // how badly it wants the player (keennessPremium, at full keenness) and a
  // per-club appetite roll between the two bounds.
  saleKeennessPremium: number;
  saleAppetiteMin: number;
  saleAppetiteMax: number;
  /** A stretched club bids what it can raise, but drops out entirely below this
   * share of the player's value — a derisory offer isn't a choice worth showing. */
  saleMinOfferShare: number;
  /** Age above which a loan stops being developmental — a veteran on loan is
   * playing, not growing, so he gets the minutes but not the bonus. */
  loanGrowthMaxAge: number;

  // ── Academy development boosts (v1.55) ──
  // Extra seasonal growth multipliers layered on top of a prospect's minutes,
  // per the development sources the youth setup actually offers. All are additive
  // fractions (0.10 = +10%) combined multiplicatively at the rollover.
  /** A season out on loan develops a prospect faster than a season in the
   * academy — regular competitive football at a level that suits him. */
  academyLoanGrowthBonus: number;
  /** …and each appearance he actually makes on that loan adds this much again,
   * so a loan where he plays every week is worth far more than a benchwarming one. */
  academyLoanGrowthPerApp: number;
  /** Cap on the per-appearance loan bonus, so a full season of games doesn't run
   * the multiplier away. */
  academyLoanGrowthPerAppCap: number;
  /** Playing in the U21 league is a development boost in its own right. */
  academyU21GrowthBonus: number;
  /** …lifted when the user's U21 side finishes well — extra growth scaled by how
   * high up the table they placed (1st = full bonus, mid-table = none). */
  academyU21TeamPerfBonus: number;
  /** …and lifted again for a prospect who personally starred: scaled by how far
   * his average U21 rating cleared this pivot. */
  academyU21RatingPivot: number;
  academyU21RatingBonus: number;

  // ── Player regen (v1.55) ──
  // When a genuinely good player retires, a fresh teenager is generated to carry
  // his profile forward — a free agent with the same position, nationality,
  // archetype and frame, the retiree's peak potential, but a raw teenage overall.
  /** Peak overall a retiring player must have reached to spawn a regen. */
  regenMinPeakOverall: number;
  regenAgeMin: number;
  regenAgeMax: number;
  /** The raw overall band a regen debuts at — a mediocre teenager with the
   * ceiling to grow into his predecessor's shoes. */
  regenOverallMin: number;
  regenOverallMax: number;

  // ── Global Club Network (v34, GCN) ──
  // The end-game ownership layer. The manager funds an unlock threshold, then
  // runs a network of AI-run clubs with its own treasury.
  /** Cash the manager must deposit into GCN Funds to unlock the network. */
  gcnUnlockFundsTarget: number;
  /** Buy price = sum(playerValue over the club's squad) × this, plus the two
   * reputation premiums below. */
  gcnBuyValueMultiplier: number;
  /** Multiplied by a league-reputation score (0–100, from its tier + the mean
   * club reputation) and added to a bought club's price. */
  gcnBuyLeagueRepPremium: number;
  /** Multiplied by the club's own reputation (1–100) and added to its price. */
  gcnBuyClubRepPremium: number;
  /** One-off cost, from the treasury, to found a fresh club in a league's
   * lowest division. */
  gcnFoundClubCost: number;
  /** Average overall the founded club's generated squad targets — deliberately
   * low; the club climbs from the bottom. */
  gcnFoundSquadAvgOverall: number;
  // Operations upgrade tracks (v1.62) — each a one-time cost per level (indexed
  // by the level being bought), a max level, and a per-level effect magnitude.
  /** Owned clubs the network can hold at level 0 — the base cap before any
   * Group Clubs upgrade. */
  gcnGroupClubsBase: number;
  /** Extra owned-club slots each Group Clubs level grants. */
  gcnGroupClubsPerLevel: number;
  gcnGroupClubsUpgradeCost: number[];
  gcnGroupClubsMaxLevel: number;
  /** Brand Deals (v1.63) — weekly cash into the GCN treasury. Level 1 pays the
   * base; every level after adds the step, up to the max level. */
  gcnBrandDealsBase: number;
  gcnBrandDealsPerLevel: number;
  gcnBrandDealsUpgradeCost: number[];
  gcnBrandDealsMaxLevel: number;
  /** GCN Deals (v1.63) — weekly cash paid straight into *each* owned club's own
   * budget (not the treasury). Same base/step shape as Brand Deals. */
  gcnDealsBase: number;
  gcnDealsPerLevel: number;
  gcnDealsUpgradeCost: number[];
  gcnDealsMaxLevel: number;
  /** Selling an owned club back out of the network returns this fraction of what
   * it would cost to buy today — the resale haircut. */
  gcnSellClubPriceFactor: number;
  /** Selling a player out of an owned club banks this fraction of his market
   * value — the sell-on haircut. */
  gcnSellPlayerPriceFactor: number;
  /** An owned club may not be sold down below this squad size. */
  gcnSellMinSquadSize: number;
  /** Seasons a club must stay in the network after it is bought or founded
   * before it may be sold (v1.64) — the network can't flip clubs for a quick
   * treasury profit. */
  gcnMinHoldSeasons: number;
  /** Buying a club in the manager's OWN country is allowed (v1.64) but such a
   * club is "ring-fenced": it takes no network money, moves no players with the
   * rest of the network, and can't be used as a feeder. This is the flag that
   * turns that behaviour on at all — off makes home-country clubs unbuyable. */
  gcnAllowHomeCountryClubs: boolean;

  // ── AI club solvency (v1.64) ──
  // AI clubs were running multi-million weekly wage bills against tier income
  // that could never cover them. Two subsidies keep the world's clubs solvent.
  /** Paid into every non-GCN club's budget at the start of each season. */
  aiSeasonSubsidy: number;
  /** Extra weekly income every non-GCN club books, on top of its normal lines. */
  aiWeeklySubsidy: number;

  // ── AI running costs (v1.67) ──────────────────────────────────────────────
  // Wages and transfer fees were an AI club's ONLY outgoings, so every club in
  // the world banked its whole surplus forever and budgets compounded season on
  // season with nothing able to spend them down. A real club also pays for the
  // ground, the staff below the first team, travel, insurance and everything else
  // that never appears on a squad list. That is what these two lines model, and
  // they are what stops a third-division side from quietly accumulating £400M.
  /** Weekly operating cost per point of club reputation, by tier. A bigger club
   * in a bigger division runs a bigger operation. */
  aiOperatingCostPerReputationByTier: number[];
  /** Share of a club's cash pile written off each season as reinvestment the sim
   * doesn't model explicitly (ground works, infrastructure, youth setup). This is
   * the backstop that makes the balance sheet mean-reverting rather than
   * monotonically rising: 0 disables it. */
  aiSurplusReinvestRate: number;
  /** Cash a club is never drained below by the reinvestment write-off, as a
   * multiple of its own annual wage bill — so the pass can never leave a club
   * unable to pay its players or trade at all. */
  aiSurplusFloorWageYears: number;

  // Calibration targets (for the harness printout)
  targetGoalsPerMatch: number;
  targetHomeWinPct: number;
}

export const TUNING: TuningConfig = {
  schemaVersion: 1,

  segmentsPerMatch: 6,
  minutesPerSegment: 15,
  // Re-calibrated for the 35-attribute model (v41). Importing real per-attribute
  // data raised measured squad strength a little (the old six were a rounded
  // aggregate of it), which pushed scoring to ~2.94 goals/match at the previous
  // 1.87. Trimming the chance rate restores the ~2.7 target without touching the
  // engine. Re-check with `npm run calibrate` after any attribute-model change.
  baseChancesPerSegment: 1.74,
  goalProbFloor: 0.08,
  goalProbCeil: 0.4,
  chanceQualitySlope: 11.0,
  midfieldSharpness: 2.2,
  chanceQualityCenter: 0.385,
  homeAdvantage: 1.07,
  synergyCap: 0.2,
  formMin: 0.94,
  formMax: 1.06,
  fitnessFloorMult: 0.85,
  outOfPositionFloor: 0.6,
  adjacentPositionMult: 0.85,
  mentalityChanceMult: { Defensive: 0.85, Balanced: 1.0, Attacking: 1.15 },
  mentalityDefenseMult: { Defensive: 1.05, Balanced: 1.0, Attacking: 0.96 },

  tempoChanceMult: { Slow: 0.92, Standard: 1.0, High: 1.1 },
  tempoFitnessDrainMult: { Slow: 0.94, Standard: 1.0, High: 1.12 },
  widthWideMult: { Narrow: 0.8, Standard: 1.0, Wide: 1.18 },
  widthCentralMult: { Narrow: 1.15, Standard: 1.0, Wide: 0.88 },
  pressMidfieldMult: { Low: 0.95, Medium: 1.0, High: 1.08 },
  pressFitnessDrainMult: { Low: 0.92, Medium: 1.0, High: 1.15 },
  pressOppChanceMult: { Low: 1.0, Medium: 1.0, High: 1.06 },
  lineDefenseMult: { Deep: 1.06, Standard: 1.0, High: 0.95 },
  lineOppChanceMult: { Deep: 0.95, Standard: 1.0, High: 1.08 },
  focusFlankBias: 0.5,

  penaltyChance: 0.022,
  freeKickChance: 0.06,
  cornerChance: 0.1,
  penaltyConversion: 0.76,
  setPieceTakerBias: 6,
  assistChance: 0.82,
  assistChanceSetPiece: 0.93,

  // Rock-paper-scissors, hidden. Counter beats Possession, Possession beats
  // Direct, Direct beats Counter. Diagonal (mirror) is neutral 1.0. Off-diagonal
  // edges sit at ±6% on ATTACK so a good read tilts a match without deciding it.
  //
  // v19 extends the matrix to six styles. The three hybrids inherit the logic of
  // the pure style they descend from, with their own twists:
  //   Gegenpress — smothers Possession harder than Counter does, but the space it
  //                leaves is exactly what a Counter side wants.
  //   ParkTheBus — frustrates Possession and Wing Play (bodies in the box), and
  //                is prised open by patient Direct balls over the top.
  //   WingPlay   — beats a narrow low block, struggles against Gegenpress, whose
  //                press traps the ball on the touchline.
  styleCounter: {
    Possession: { Possession: 1.0, Counter: 0.94, Direct: 1.06, Gegenpress: 0.92, ParkTheBus: 0.95, WingPlay: 1.03 },
    Counter: { Possession: 1.06, Counter: 1.0, Direct: 0.94, Gegenpress: 1.08, ParkTheBus: 0.93, WingPlay: 1.02 },
    Direct: { Possession: 0.94, Counter: 1.06, Direct: 1.0, Gegenpress: 1.02, ParkTheBus: 1.07, WingPlay: 0.98 },
    Gegenpress: { Possession: 1.08, Counter: 0.92, Direct: 0.98, Gegenpress: 1.0, ParkTheBus: 0.96, WingPlay: 1.06 },
    ParkTheBus: { Possession: 1.05, Counter: 1.02, Direct: 0.93, Gegenpress: 1.04, ParkTheBus: 1.0, WingPlay: 1.06 },
    WingPlay: { Possession: 0.97, Counter: 0.98, Direct: 1.02, Gegenpress: 0.94, ParkTheBus: 0.94, WingPlay: 1.0 },
  },
  // Intrinsic shape of each style (v19). The pure three are near-neutral — their
  // identity lives in archetype synergy — while the hybrids trade hard along
  // their defining axis. Gegenpress buys the midfield with legs and exposure;
  // Park the Bus concedes the ball for a wall; Wing Play routes goals to the
  // flanks at a small cost through the middle.
  styleShape: {
    Possession: { midfield: 1.04, defense: 1.0, oppChance: 0.97, fitnessDrain: 0.98, wideBias: 0 },
    Counter: { midfield: 0.94, defense: 1.03, oppChance: 1.0, fitnessDrain: 0.97, wideBias: 0 },
    Direct: { midfield: 0.98, defense: 1.0, oppChance: 1.02, fitnessDrain: 1.0, wideBias: 0 },
    Gegenpress: { midfield: 1.12, defense: 0.95, oppChance: 1.1, fitnessDrain: 1.18, wideBias: 0 },
    ParkTheBus: { midfield: 0.82, defense: 1.16, oppChance: 0.84, fitnessDrain: 0.9, wideBias: 0 },
    WingPlay: { midfield: 1.0, defense: 0.99, oppChance: 1.01, fitnessDrain: 1.04, wideBias: 0.45 },
  },
  // Attacking overloads a Defensive block but is caught out by a compact Balanced
  // shape; Defensive frustrates Attacking. Kept gentle (±4%).
  mentalityCounter: {
    Defensive: { Defensive: 1.0, Balanced: 0.98, Attacking: 1.04 },
    Balanced: { Defensive: 1.02, Balanced: 1.0, Attacking: 1.02 },
    Attacking: { Defensive: 0.96, Balanced: 0.98, Attacking: 1.0 },
  },

  // Four windows rather than two (v1.66): the break (performance changes only),
  // the classic hour mark, and two late ones. Segment boundaries sit at 0/15/30/
  // 45/60/75, and a window is only checked when it lands on one — so these four
  // are the real decision points a manager gets.
  subMinutes: [45, 60, 75],
  maxSubs: 5,
  subFitnessThreshold: 86,
  subUpgradeMargin: 0.94,
  clutchMinute: 75,

  // Dynamic substitutions (v1.66). Three changes is the floor a manager aims for
  // — that alone turns the bench from decoration into ~250 minutes a match spread
  // across squad players. Fatigue pulls below 74 unconditionally; the quality
  // test above (subFitnessThreshold/subUpgradeMargin) still governs the rest.
  minSubsPerMatch: 3,
  fatigueSubFitness: 74,
  // Two goals up with 20 to play is safe enough to think about next week.
  garbageTimeLead: 2,
  garbageTimeMinute: 70,
  garbageTimeUpgradeMargin: 0.72, // a real drop in quality — the point is minutes
  garbageTimeProspectAge: 21,
  performanceSubRating: 5.9,
  performanceSubLastMinute: 60,

  // Pre-match rotation (v1.66). 82 is the line below which a starter is carrying
  // real fatigue into a match; a congested week lifts it to 88, which in practice
  // rotates most of the XI across a midweek-plus-weekend pair.
  rotationFitnessThreshold: 82,
  congestedFixtureDays: 4,
  congestedRotationBonus: 6,
  // A league deputy must be within 12% of the starter; a low-priority cup tie
  // accepts a 25% drop, which is what actually empties the fringe of the squad.
  rotationQualityFloor: 0.88,
  cupRotationQualityFloor: 0.75,
  roleMinutesTargetStarter: 0.75,
  roleMinutesTargetRotation: 0.4,
  roleMinutesTargetImpactSub: 0.18,
  roleMinutesSelectionWeight: 0.12,

  fitnessDrainPerMatch: 22,
  fitnessDrainAgeFactor: 0.8,
  fitnessRecoveryPerDay: 3.5,
  fitnessCoachRecoveryPerStar: 0.35,
  physioRecoveryPerStar: 0.25,
  minFitnessToStart: 55,

  headCoachMatchdayPerStar: 0.01,

  formNudgePerRatingPoint: 0.012,

  // Maturity curve: 14yo ≈ 0.42 of eventual ability, 16 ≈ 0.62, 18 ≈ 0.81,
  // 20 ≈ 0.96, finished at 21. Because it's a continuous curve rather than a
  // bracketed cap, each extra year of age is worth something — a 16yo is
  // meaningfully ahead of a 14yo of identical promise, which is the thing the
  // old age-locked model got wrong. ~3% roll "prodigy" and mature early, which
  // is where the genuine 80-rated 17-year-old comes from.
  //
  // 14 is the game-wide minimum player age (no player of any origin is younger),
  // so the curve starts exactly there.
  maturityStartAge: 14,
  maturityFullAge: 21,
  maturityFloor: 0.42,
  maturityCurve: 1.35,
  maturitySpread: 2.5,
  youthProdigyChance: 0.03,
  youthProdigyKeepMin: 0.55,
  youthProdigyKeepMax: 0.9,
  // v1.66: 88/96 → 72/92. The old band handed EVERY still-growing player in the
  // world a hidden ceiling of 88–96, which meant headroom — the one brake on the
  // growth formula — effectively never bound, and the world filled with players
  // whose ceiling was world-class. A ceiling that everybody has is not a ceiling.
  // The floor now sits at "solid professional" and the band spreads wide enough
  // that a genuine 90+ ceiling is a minority roll (the top ~quarter of the band),
  // restoring the scarcity that makes a wonderkid worth finding. Players whose
  // generated overall + headroom already exceeds this keep the higher number —
  // the band is a floor, not a clamp.
  youthPotentialFloor: 72,
  youthPotentialBandTop: 92,

  // Elite generation (superstars). A rep-90 giant lifts its top ~4 starters by up
  // to +6, so its best players land in the high 80s / low 90s (the world-class
  // core a title side is built around); the boost tapers to nothing by rep 78, so
  // only genuine giants produce stars. The hard cap sits at 94 so a boosted star
  // plus attribute spread can reach the low 90s without any single senior breaking
  // 94 on generation — the 95+ ceiling is reserved for players who earn it in-game.
  eliteClubRepThreshold: 78,
  eliteStarterBoostMax: 8,
  eliteStarterCount: 4,
  eliteHardCap: 94,

  heightFullAge: 19,
  heightPerYoungYear: 0.012,

  minOverall: 50,

  // v1.51: 24 → 26. The youth curve's own age falloff already tapers growth
  // toward the top of the band, so extending it two years smooths the hard cliff
  // a player used to fall off on his 25th birthday — the most visible half of the
  // "nobody over 24 develops" complaint. Players past this age still develop, on
  // the prime curve. This lifts squad quality world-wide, so
  // `baseChancesPerSegment` is re-calibrated alongside it to hold ~2.7 goals.
  growthEndAge: 26,
  primeEndAge: 34,
  // v1.52 — automatic decline starts at 35, not the early thirties.
  //
  // The old base of 32, swung by ±2 for longevity and pulled a further 1.5 years
  // earlier for a pace-reliant archetype, put the EARLIEST onset at 28.6 and the
  // typical one at ~31.2. A 30-year-old therefore lost overall every summer no
  // matter how he played, which is the "players decline at 30" complaint.
  //
  // The base moves to 35 and the two modifiers shrink, so the band is now
  // 34.1 → 36.5: nobody declines before 34, the average pro turns at ~35, and a
  // durable, low-pace archetype holds on past 36. Between the end of the youth
  // curve and this age a player is in his PRIME — he moves on merit, up on a
  // strong campaign and only gently down on a poor one (see developPlayer).
  declineOnsetAge: 35,
  declineOnsetLongevitySwing: 1,
  declineOnsetPaceReliancePenalty: 0.9,
  // v1.66: 6 → 4.5. The headline growth budget was set when the multiplier stack
  // was thinner; with coach (×1.4), facility (×1.6), plan (×1.1) and the academy
  // bonuses all compounding on top, 6 produced ~8-overall seasons for a fully
  // invested youngster. The elite-resistance curve below handles the top end;
  // this trims the whole band so even a mid-rated prospect climbs in 3–5 point
  // steps rather than 8.
  growthPerSeasonMax: 4.5,
  declinePerSeasonBase: 1.6,
  // v1.66: 1.8 → 1.35. The catch-up band compounds with coach, facility, plan and
  // the academy bonuses, so at full investment it was producing +12 seasons for a
  // raw teenager — the fast lane into the elite band that the resistance curve
  // then had to fight. Raw players still climb briskly out of the 50s, just not
  // in a single summer.
  growthCatchupBelow: 60,
  growthCatchupMult: 1.35,
  // Elite resistance (v1.66). No damping at or below 70; by 80 growth runs at
  // roughly half rate, by 88 at ~18%, and it bottoms out at 12% by 94. Combined
  // with the lower potential floor, this is what stops the 19-year-old 90.
  growthEliteAbove: 62,
  growthEliteCeiling: 92,
  growthEliteMultFloor: 0.08,
  growthEliteCurve: 1.25,
  // Peaked age curve (v17). 17 is the breakout year at full strength; each year
  // below that costs 0.16 (so a 14-year-old sits at 1.0 − 0.48 → 0.52 of a
  // 17-year-old's rate) and each year above costs 0.09,
  // easing growth out toward growthEndAge instead of cutting it off.
  growthPeakAge: 17,
  growthPeakMult: 1.35,
  growthYoungFalloffPerYear: 0.16,
  growthOldFalloffPerYear: 0.09,
  growthAgeMultFloor: 0.35,
  // v1.51: prime growth loosened so players over 24 visibly develop. The pivot
  // drops to 6.7 (a solid regular now improves, not only a standout), the per-
  // season ceiling rises, and prime players join the weekly in-season tick.
  primeGrowthPerSeasonMax: 3.0,
  // 6.55 sits just under the median regular's rating (~6.65), so an ordinary
  // first-teamer having a normal season edges forward while a squad player who
  // rates below the median still stagnates. At the old 6.9 only ~12% of players
  // cleared the bar at all, which is why nobody over 24 appeared to develop.
  primeGrowthPerfPivot: 6.55,
  primeInSeasonShare: 0.45,
  // 0.25 in perf units ≈ 0.3 of a rating point below the 6.55 pivot, so anything
  // from ~6.25 up is treated as an ordinary season and costs nothing. Below that
  // he sheds at most 1.5 in a season — noticeable, recoverable next year.
  primeDeclineTolerance: 0.25,
  primeBadSeasonMaxLoss: 1.5,
  // A 6-point floor tapering out at 92 keeps a mid-70s pro improving for several
  // seasons on good form, while a 90-rated star has almost nothing left — the
  // last few points of a great career have to come from the youth curve.
  primeHeadroomFloor: 6,
  primeHeadroomCapOverall: 92,
  primeHeadroomFullBelow: 78,
  // v1.52: pushed back two years alongside the decline onset. At 34–37 a player
  // could retire at the very age decline was starting, so the veteran phase was
  // over before it began; 36–39 leaves a real two-to-four-season tail in which
  // an ageing pro visibly fades before hanging them up.
  retirementAgeMin: 36,
  retirementAgeMax: 39,

  // v1.52: 29 → 33. The prime now runs to ~35, and freezing the ceiling at 29
  // meant a 30-year-old's potential could never respond to how he was actually
  // playing — his growth was capped by a number set years earlier. It still
  // stops before decline onset, so a genuinely ageing player doesn't sprout a
  // new ceiling on the way down.
  potentialRecalcAgeMax: 33,
  potentialUpMax: 3,
  potentialDownMax: 2,
  potentialPerfPivot: 6.9,
  potentialMinutesFloor: 0.25,
  potentialAbsoluteCap: 97,
  trainingFacilityGrowthPerLevel: 0.12,
  medicalFacilityRecoveryPerLevel: 0.5,
  medicalFacilityAgeDrainReductionPerLevel: 0.12,

  // ── Club income by tier (rebalanced v1.67) ────────────────────────────────
  // Every income line now has an entry for all four tiers the pyramid can run,
  // and the whole ladder is scaled to sit alongside the WAGE ladder
  // (`wageTierMult` below: 1.0 / 0.55 / 0.32 / 0.2).
  //
  // What was wrong: this array had only two entries and the lookup falls back to
  // index 1 for anything past it, so a THIRD- and FOURTH-tier club drew the same
  // £320k/week as a second-tier one — while paying tier-3 wages, which are a
  // fifth of tier 2's. Combined with a season prize of £75M for tier 3 decaying
  // at only 3% a place, a mid-table third-division club banked about £87M a
  // season it had nothing to spend on. Three seasons in, the division was full of
  // clubs sitting on £200–400M. Gate money and the position bonus had the same
  // shape of bug: both were single flat figures applied at every tier.
  weeklyIncomeByTier: [950_000, 260_000, 70_000, 25_000],
  positionBonusMaxByTier: [300_000, 90_000, 30_000, 12_000],
  gateIncomePerReputationByTier: [9_000, 3_000, 1_200, 600],
  wagePerOverallCurve: { base: 160, exponent: 0.082 },
  // Champion's prize by tier, with a steeper 6%-per-place decay (was 3%). The old
  // figures were top-flight money handed to every division: £75M to a third-tier
  // champion is more than that club's entire wage bill for a decade. Now the
  // prize is scaled to the tier it's paid in — a tier-3 champion banks £12M and
  // 10th place £6.9M, against a ~£6M wage bill.
  seasonPrizeByTier: [120_000_000, 40_000_000, 12_000_000, 5_000_000],
  seasonPrizeDecayPerPosition: 0.06,
  // Continental prize by cup tier (index 0 = Champions League) and finish stage.
  // Tier 3 pays a flat figure below the quarter-finals — the spec draws no line
  // between the R16 and the group stage there, so both sit at £15M.
  europeanCupPrizeByTier: [
    { champion: 150_000_000, runnerUp: 130_000_000, semiFinal: 110_000_000, quarterFinal: 100_000_000, roundOf16: 80_000_000, groupStage: 50_000_000 },
    { champion: 90_000_000, runnerUp: 75_000_000, semiFinal: 60_000_000, quarterFinal: 50_000_000, roundOf16: 40_000_000, groupStage: 30_000_000 },
    { champion: 55_000_000, runnerUp: 45_000_000, semiFinal: 35_000_000, quarterFinal: 25_000_000, roundOf16: 15_000_000, groupStage: 15_000_000 },
  ],
  promotionBonus: 30_000_000,
  cupWinBonus: 10_000_000,

  // Award weighting (v1.67). A perfect season — champions, cup winners, European
  // champions — carries a 0.06 + 0.03 + 0.05 = 0.14 lift, worth about a full
  // rating point on a 7.0 average. That is enough to settle a close race in
  // favour of the player who actually won things, and not enough to hand the
  // trophy to a squad player at the champions.
  awardLeagueWeight: 0.06,
  awardCupWeight: 0.03,
  awardEuroWeight: 0.05,
  awardEuroStageScore: {
    champion: 1,
    runnerUp: 0.8,
    semiFinal: 0.6,
    quarterFinal: 0.45,
    roundOf16: 0.3,
    groupStage: 0.15,
  },
  awardEuroTierScale: [1, 0.6, 0.35],

  // ── Club income upgrades (v43) ──
  // Payouts are absolute at each level, not increments: buying low-tier level 2
  // takes the club from +£30k/wk to +£60k/wk, it does not stack to £90k.
  lowTierIncomeUpgradeCost: [
    1_500_000, 2_500_000, 5_000_000, 9_000_000, 15_000_000,
    25_000_000, 40_000_000, 65_000_000, 90_000_000, 120_000_000,
  ],
  lowTierIncomePayout: [
    30_000, 60_000, 90_000, 120_000, 150_000, 180_000, 210_000, 240_000, 270_000, 300_000,
  ],
  midTierIncomeUpgradeCost: [
    3_500_000, 8_000_000, 15_500_000, 27_500_000, 50_000_000,
    72_500_000, 95_500_000, 110_000_000, 135_000_000, 150_000_000,
  ],
  midTierIncomePayout: [
    50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000, 500_000,
  ],
  highTierIncomeUpgradeCost: [
    10_000_000, 30_000_000, 65_000_000, 100_000_000, 150_000_000,
    225_000_000, 300_000_000, 380_000_000, 500_000_000, 800_000_000,
  ],
  highTierIncomePayout: [
    100_000, 200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000, 1_000_000,
  ],
  playerBonusUpgradeCost: [3_000_000, 10_000_000, 25_000_000, 50_000_000, 120_000_000],
  playerBonusPayout: [5_000, 10_000, 20_000, 40_000, 100_000],
  playerBonusThreshold: [70, 75, 80, 85, 90],
  contractAccountingUpgradeCost: [
    10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000,
    60_000_000, 70_000_000, 80_000_000, 90_000_000, 100_000_000,
  ],
  contractAccountingDiscount: [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
  stadiumBonusUpgradeCost: [
    10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000,
    60_000_000, 70_000_000, 80_000_000, 90_000_000, 100_000_000,
  ],
  stadiumBonusPayout: [
    100_000, 200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000, 1_000_000,
  ],
  performanceBonusUpgradeCost: [
    5_000_000, 10_000_000, 15_000_000, 20_000_000, 25_000_000,
    30_000_000, 35_000_000, 40_000_000, 45_000_000, 50_000_000,
  ],
  performanceBonusWin: [
    50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000, 500_000,
  ],
  performanceBonusDraw: [
    30_000, 60_000, 90_000, 120_000, 150_000, 180_000, 210_000, 240_000, 270_000, 300_000,
  ],
  performanceBonusLoss: [
    10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
  ],

  staffRefreshDays: 2,
  marketRefreshDays: 10,

  // v44: rebased from 5,200. The old star model topped out at a ~1.88× money
  // multiplier; the new tier ladder tops out at 6.0×. Left alone, every elite
  // sponsorship would have tripled overnight — a rep-85 top-flight shirt deal
  // went from ~£200M to ~£647M in testing. 5,200 × 1.88 / 6.0 ≈ 1,630 puts the
  // TOP of the new ladder exactly where the top of the old one sat, so the
  // ladder became the spec's without the commercial economy moving.
  sponsorBaseWeeklyByReputation: 1_630,
  // Per-slot share of the front-of-shirt baseline. The majors sit at the top;
  // the minor partnerships are deliberately small individually — their appeal is
  // that you can hold several at once (v19).
  sponsorSlotShare: {
    shirt: 1.0,
    apparel: 0.68,
    stadium: 0.75,
    backOfShirt: 0.42,
    sleeve: 0.35,
    shorts: 0.22,
    trainingKit: 0.26,
    boot: 0.3,
    regional: 0.18,
    beverage: 0.24,
    automotive: 0.28,
  },
  sponsorTierMults: [0.7, 1.0, 1.4], // Regional / National / Global

  // ── Club Marketability (v44) ──
  // A. League & Division Status — 35 pts. Tier 1 → 50 raw, but the factor is
  // capped at 35, so a top-flight club is maxed on this factor and continental
  // qualification is what a tier-2 club climbs with.
  marketabilityTierPoints: [50, 35, 20, 10],
  marketabilityEuropeanBonus: 10,
  marketabilityWeightLeague: 35,
  // B. Squad Star Power — 25 pts, on the mean of the three best senior players.
  marketabilityStarPowerBands: [
    [0, 5],
    [70, 10],
    [75, 15],
    [80, 20],
    [85, 25],
  ],
  marketabilityStarPowerTopN: 3,
  marketabilityWeightStarPower: 25,
  // C. Recent Team Form — 25 pts. Ten matches at 3 for a win is 30 raw, scaled
  // onto 25; five unbeaten adds 5 before the cap, so a good run can max the
  // factor without needing ten straight wins.
  marketabilityFormMatches: 10,
  marketabilityFormWin: 3,
  marketabilityFormDraw: 1,
  marketabilityFormUnbeatenGames: 5,
  marketabilityFormUnbeatenBonus: 5,
  marketabilityWeightForm: 25,
  // D. Club Facilities & Infrastructure — 15 pts, on the mean income-upgrade
  // level across the seven tracks (each capped at level 10).
  marketabilityFacilityBands: [
    [0, 0],
    [1, 5],
    [4, 10],
    [8, 15],
  ],
  marketabilityWeightFacilities: 15,
  // What the score buys. Five bands over 0–100; `valueMult` is the headline
  // "offer multiplier" the Investments page shows as a percentage.
  marketabilityTiers: [
    { maxPoints: 20, offers: 2, valueMult: 1.0, flavour: "Local Businesses" },
    { maxPoints: 40, offers: 3, valueMult: 1.5, flavour: "Regional Brands" },
    { maxPoints: 60, offers: 4, valueMult: 2.5, flavour: "National Corporations" },
    { maxPoints: 80, offers: 5, valueMult: 4.0, flavour: "Global Brands" },
    { maxPoints: 100, offers: 6, valueMult: 6.0, flavour: "Elite Mega Sponsors" },
  ],
  marketabilityTierPull: 0.13,
  marketabilityCooldownPerStar: 0.12,
  sponsorLengthMin: 1,
  sponsorLengthMax: 4,
  sponsorOfferExpiryDays: 21,
  sponsorRefreshDays: 5,
  sponsorMajorSlots: ["shirt", "apparel", "stadium", "backOfShirt"],
  // v1.43: major (lump-sum) offers trimmed 15% — the old 1.15 incentive multiplier
  // × 0.85 lands at ~0.98, so a major now pays a touch under its equivalent-weekly
  // term rather than a touch over.
  sponsorMajorUpfrontMult: 0.9775,
  sponsorMinorWeeklyMult: 0.85, // v1.43: minor weekly partnerships pay 15% less
  sponsorMajorLengthMin: 2,
  sponsorMajorLengthMax: 4,
  // A major is a 12-day decision; minors linger a little longer since they're
  // lower stakes. Cooldowns are short enough that a passed slot isn't dead for
  // a season, long enough that passing costs you something.
  sponsorDeadlineDaysMajor: 12,
  sponsorDeadlineDaysMinor: 18,
  sponsorCooldownDaysMin: 14,
  sponsorCooldownDaysMax: 30,
  sponsorMajorMinSeasons: 2,
  // Slot capacity (v19). The landmark assets are genuinely exclusive — one front
  // of shirt, one kit maker, one stadium name — while the smaller partnerships
  // scale: three regional partners is normal for a real club, as is a pair of
  // beverage or automotive deals. This is where scarcity lives now, so there is
  // no longer a blanket "one major at a time" rule; the constraint is that the
  // big slots are each singular and the money in them is worth waiting for.
  sponsorSlotCapacity: {
    shirt: 1,
    apparel: 1,
    stadium: 1,
    backOfShirt: 1,
    sleeve: 1,
    shorts: 1,
    trainingKit: 2,
    boot: 2,
    regional: 3,
    beverage: 2,
    automotive: 2,
  },
  // Performance-bonus offers (v44). Take 70% now and you need a top-4 finish to
  // collect; the bonus pays 1.4× the 30% given up, so the gamble is worth about
  // +12% on the whole deal if it lands and −30% if it doesn't.
  sponsorBonusOfferChance: 0.4,
  sponsorBonusUpfrontShare: 0.7,
  sponsorBonusPayoutMult: 1.4,
  sponsorBonusFinishPosition: 4,
  // Early buyout (v44). A quarter of what's left, and only after a full season,
  // so promotion genuinely opens the door but signing-and-flipping doesn't.
  sponsorBuyoutPenaltyRate: 0.25,
  sponsorBuyoutMinSeasonsHeld: 1,

  aiCommercialPerReputation: 3_100,
  // v1.67: extended to all four tiers. With only two entries, a third- or
  // fourth-division club took the SECOND tier's 1.0× multiplier — the same bug
  // shape as weeklyIncomeByTier, and worth ~£97k/week to a tier-3 club, about as
  // much as its entire wage bill. Commercial appeal falls away sharply below the
  // top two divisions, so the ladder does too.
  aiCommercialTierMult: [1.6, 1.0, 0.45, 0.2],
  aiCommercialVariance: 0.18,
  aiInvestmentWindfallWeeks: 26,
  // Most big clubs carry a shirt sponsor and a kit maker; naming rights and
  // back-of-shirt are commoner at the top than the bottom (reputation feeds the
  // roll itself), so a flat chance here still produces varied books.
  aiSponsorMajorFillChance: 0.55,
  aiSponsorMinorFillChance: 0.45,
  // Calibrated (v1.5) so the AI world's TOTAL commercial income lands on the
  // old abstract model's, not several times over it. A club now holds ~9 real
  // deals where it used to hold one notional figure, so each is quoted a
  // fraction of a user-facing offer — otherwise every AI club's wage headroom
  // and transfer affordability would silently inflate.
  aiSponsorValueMult: 0.34,

  // 10× the old costs (v15). Training infrastructure is now a genuine
  // long-horizon investment weighed against the transfer market, not a cheap
  // early-game formality bought in the first season.
  trainingFacilityMaxLevel: 5,
  trainingUpgradeCost: [35_000_000, 80_000_000, 160_000_000, 280_000_000, 480_000_000],
  medicalUpgradeCost: [25_000_000, 60_000_000, 120_000_000, 220_000_000, 380_000_000],
  // Gymnasium: broad, whole-squad conditioning. Deliberately a touch weaker
  // per level than the Training Centre (which only helps youth), but it lifts
  // everyone — priced alongside the other core facilities.
  gymnasiumUpgradeCost: [28_000_000, 68_000_000, 140_000_000, 250_000_000, 430_000_000],
  gymnasiumGrowthPerLevel: 0.05,

  // Specialist facilities. Position centres are the cheapest (each helps only a
  // quarter of the squad); plan centres cost more (they compound with the plans
  // the user is already setting); the youth centre sits between the two.
  positionFacilityMaxLevel: 3,
  positionFacilityGrowthPerLevel: 0.09,
  gkCentreUpgradeCost: [12_000_000, 30_000_000, 65_000_000],
  defenceCentreUpgradeCost: [18_000_000, 42_000_000, 90_000_000],
  midfieldCentreUpgradeCost: [18_000_000, 42_000_000, 90_000_000],
  attackCentreUpgradeCost: [20_000_000, 48_000_000, 100_000_000],
  planFacilityMaxLevel: 3,
  planFacilityBoostPerLevel: 0.04,
  sportsScienceUpgradeCost: [26_000_000, 60_000_000, 125_000_000],
  techCentreUpgradeCost: [28_000_000, 65_000_000, 135_000_000],
  finishingCentreUpgradeCost: [24_000_000, 56_000_000, 118_000_000],
  youthDevCentreUpgradeCost: [22_000_000, 52_000_000, 110_000_000],
  youthDevCentreGrowthPerLevel: 0.11,

  contractWageCurve: { base: 160, exponent: 0.082 },
  contractLengthMin: 1,
  contractLengthMax: 5,
  contractDemandMult: 1.0,
  contractRenewYearsDefault: 3,
  contractAcceptRatio: 0.98,
  contractRejectRatio: 0.8,
  contractVeteranAge: 32,

  // Wage market scale (v1.65). A tier-2 club pays ~55% of top-flight wages for
  // the same player, tier 3 ~32%, tier 4 ~20%, tier 5+ ~13% — the shape of the
  // real drop-off between a top division and the semi-professional game, and
  // enough that a lower-league budget can actually carry a squad.
  wageTierMult: [1.0, 0.55, 0.32, 0.2, 0.13],
  // Country bands, strongest first. The big five pay the headline rate; the
  // next band (the strong mid-size systems) roughly two-thirds of it; everyone
  // else lands on the default. Codes only — the engine never reads a name.
  wageCountryBands: [
    ["ENG", "GER", "ESP", "ITA", "FRA"],
    ["POR", "NED", "TUR", "BEL", "SCO", "RUS", "UKR", "AUT", "SUI", "GRE"],
    ["DEN", "SWE", "NOR", "CZE", "POL", "CRO", "SRB", "ROU", "HUN", "BUL", "ISR", "CYP"],
  ],
  wageCountryBandMult: [1.0, 0.62, 0.4],
  wageCountryBandDefault: 0.3,
  wageMarketMultMin: 0.08,
  // A clause at 1.5× value is a real escape hatch and earns the full 12% off the
  // wage; by 4× it's priced out of reach and buys nothing.
  releaseClauseMinMult: 1.5,
  releaseClauseMaxMult: 4.0,
  releaseClauseMaxWageDiscount: 0.12,
  releaseClauseSuggestedMult: 2.5,

  // v1.68: base 3 + 7 levels → up to 10 scouts employed.
  scoutNetworkMaxLevel: 7,
  scoutNetworkBase: 3,
  // v1.44: Academy Upgrade costs raised 8× across all three upgrades.
  scoutNetworkUpgradeCost: [
    28_000_000, 56_000_000, 96_000_000, 144_000_000, 200_000_000, 260_000_000, 330_000_000,
  ],

  // v1.68: base 15 + 10 levels × 3 → up to 45 prospects.
  academySquadSizeBase: 15,
  academySquadSizePerLevel: 3,
  academySquadMaxLevel: 10,
  // flat 15M steps, starting at 20M.
  academySquadUpgradeCost: [
    20_000_000, 35_000_000, 50_000_000, 65_000_000, 80_000_000,
    95_000_000, 110_000_000, 125_000_000, 140_000_000, 155_000_000,
  ],

  // v1.68: base 5 + 10 levels → up to 15 focus slots.
  focusSlotMaxLevel: 10,
  // flat 10M steps, starting at 10M.
  focusSlotUpgradeCost: [
    10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000,
    60_000_000, 70_000_000, 80_000_000, 90_000_000, 100_000_000,
  ],

  // v1.68: 10 levels × 5% → reports arrive 50% sooner at max.
  scoutSpeedMaxLevel: 10,
  scoutSpeedPerLevel: 0.05,
  scoutSpeedUpgradeCost: [
    12_000_000, 24_000_000, 36_000_000, 48_000_000, 60_000_000,
    72_000_000, 84_000_000, 96_000_000, 108_000_000, 120_000_000,
  ],

  // v1.68: one £100M purchase unlocks the brief auto-filter for good.
  scoutFilterMaxLevel: 1,
  scoutFilterUpgradeCost: [100_000_000],

  youthPrMaxLevel: 10, // 10 levels × 3% → +30% prospect value at max
  youthPrValuePerLevel: 0.03,
  // £25M for the first level, +£15M for each one after it.
  youthPrUpgradeCost: [
    25_000_000, 40_000_000, 55_000_000, 70_000_000, 85_000_000,
    100_000_000, 115_000_000, 130_000_000, 145_000_000, 160_000_000,
  ],

  valueCurve: { base: 9_600, exponent: 0.104 }, // v1.42: −20% across the board to unstick the transfer market
  youthPotentialValueBoost: 1.8,
  aiAcceptThreshold: 1.05, // v1.43: asks land nearer market value
  aiKeyPlayerPremium: 1.2, // v1.43: softened from 1.35 (and no longer stacked twice)
  aiBidChancePerWeek: 0.14,
  aiMaxOffersPerWeek: 4,
  aiMaxBiddersPerPlayer: 3,
  aiRivalBidChance: 0.45,
  freeAgentSigningFee: 0,
  // Ask sits right on market value. With 0.25 compression the raw ~1.9× a title
  // club's star used to reach collapses to ~1.22×, and the ±band then caps it at
  // 1.15× — so a 137M player asks ~150M at most, a fringe player right around
  // value, and nobody is ever priced several multiples over what they're worth.
  askValueCompression: 0.25,
  askValueMinMult: 0.9,
  askValueMaxMult: 1.15,
  negotiationBuyerCeilingMult: 1.6,
  negotiationMaxRounds: 6, // hard backstop; patience normally binds first
  negotiationWalkAwayOver: 1.6,
  // A patient buyer rolls ~100 and can absorb four or five sensible counters; an
  // impatient one rolls ~55 and gives you two. Base cost 18 per counter, plus 90
  // per full 1.0× of ceiling overshoot — so asking 20% over the ceiling costs
  // ~36 patience, while asking double costs ~108 and ends most negotiations on
  // the spot. That is the intended lesson: push, but read the room.
  negotiationPatienceMin: 55,
  negotiationPatienceMax: 110,
  negotiationPatienceCostBase: 18,
  negotiationPatienceCostPerOvershoot: 90,
  negotiationCounterStep: 0.55,
  negotiationBestAndFinalShare: 0.94,

  // ── Player transfer consent (v1.66) ──
  // 76 is a first-choice top-flight footballer: comfortably above a mid-table
  // squad player (~68-72) and below a genuine star (~82+). One tier is the whole
  // allowance — a Premier League regular will drop to the Championship for
  // football and no further, which is exactly the immersion break being fixed.
  consentEliteOverall: 76,
  consentMaxTierDrop: 1,
  // Reputation runs 1-100. A 30-point gap is roughly "European regular to
  // mid-table", which is about as far as a good player will fall in one move.
  consentMaxRepDrop: 30,
  // A club this well-regarded is a peer wherever it plays.
  consentPeerReputation: 72,

  // Wage floors. 0.85 of his current wage means a move is allowed to cost him a
  // little (a step up in football is worth something) but never the 60-80% cut a
  // fourth-tier quote used to represent. The ability anchor is the real gate on
  // lower-league buyers: 0.5 of his top-market rate is still far beyond what a
  // League One wage budget clears in canAfford.
  wageFloorShareOfCurrent: 0.85,
  wageFloorShareOfAbility: 0.5,
  wageFloorEliteStep: 0.02, // +2% of the anchor per overall point above elite

  // Desperation curve. A month of not playing before anything moves, then a
  // season and a half to bottom out — slow enough that a benched star doesn't
  // drop two divisions inside one window, fast enough that a genuinely finished
  // player eventually finds his level.
  desperationGraceDays: 30,
  desperationFullDays: 420,
  desperationMaxExtraTierDrop: 2, // at full decay an elite player will fall 3 tiers
  desperationMinWageFloorShare: 0.55, // …and take 55% of his floor
  desperationMinutesShare: 0.25,
  desperationFreeAgentMult: 2.0,

  // Club AI strategy. Top ~25% of a league with no financial trouble reads as a
  // title push; a club two-tenths of a table below its reputation is
  // underperforming. A squad averaging 28+ is ageing.
  aiTitleContenderRatio: 0.25,
  aiUnderperformBand: 0.2,
  aiStanceTolerance: 0.1,
  aiStrugglingRatio: 0.8,
  aiAgeingSquadAge: 27,
  // Budgets run ~4-12% of squad value in this economy; below ~6.5% (the bottom
  // quartile) a club genuinely has no room to buy.
  aiHealthyBudgetRatio: 0.065,
  aiDepthUrgencyWeight: 4,
  aiNeedScoreWeight: 0.08,
  // v1.43+: the market ran too quiet — the upgrade bar and age-band falloff were
  // strict enough that most clubs found no target worth signing. Loosening the
  // gain floor and softening the age falloff lets clubs act on marginal upgrades
  // and shop a little outside their ideal age band, so windows are visibly busier.
  // v25: transfers between clubs made more aggressive. A club acts on a slimmer
  // upgrade (0.5 vs 0.8 overall), shops further outside its ideal age band, and
  // will commit more of its budget to one deal — so squads reshape faster and
  // the market visibly churns each window.
  aiMinUpgradeGain: 0.5,
  aiAgeBandFalloff: 0.9,
  aiMaxBudgetSharePerDeal: 0.65,
  aiDealsPerWeek: 11,
  // Chance an acting AI club, having found no club-to-club target, signs a free
  // agent for a needy position instead. Free agents cost only wages, so this keeps
  // the market moving even for clubs that can't fund a fee.
  aiFreeAgentSignChance: 0.6,
  // v1.51: the user's own division rivals now get a burst of business the moment
  // a window opens, not just the Monday ticks — before this, foreign leagues
  // visibly reshaped their squads every window while the clubs the user actually
  // plays against barely moved a player. Multiplied by the ladder depth, so a
  // three-tier pyramid churns proportionally more than a single division.
  aiWindowDealsPerLeague: 10,
  // The AI stops raiding the free-agent pool once it's down to this many. With
  // both the weekly tick and the window burst shopping it, the pool could
  // otherwise be cleared out and the user's Free Agents tab would stay empty.
  freeAgentPoolFloor: 12,
  // Sim leagues each churn a handful of players between their own clubs per
  // window (v1.44) so browsing a foreign league across seasons shows real squad
  // movement, not a frozen roster. Runs once per window, not weekly, so the
  // whole world stays cheap even at 15+ leagues.
  // v25: raised alongside the playable-league volume so foreign divisions churn
  // just as visibly across seasons.
  aiSimDealsPerLeaguePerWindow: 7,
  aiSimCrossLeagueDealsPerWindow: 14,

  // Peer priority (v1.66). Two weeks of exclusivity for clubs at his own level —
  // one weekly AI tick plus a window-open burst, so the peers genuinely get first
  // refusal before anyone below can approach.
  peerPriorityOverall: 74,
  peerPriorityDays: 14,
  peerPriorityTierBand: 1,
  // Chance per window an AI club proactively renews a first-team player who is in
  // the final year of his deal, rather than risk losing him for nothing. Keeps AI
  // squads intact and mirrors the contract pressure the user feels.
  aiRenewChance: 0.5,

  // Financial discipline (v19, retuned v21). Clubs are still genuinely wary of
  // their books — they hold a real cash reserve and keep weeks of wages in hand —
  // but the v19 settings were cautious enough that the league went quiet. The
  // reserve drops to a sixth and the wage cushion to six weeks, which frees more
  // deals to clear while leaving a club that can't cover its wages a forced
  // seller (15% under asking). Wage bills stay capped at three-quarters of income.
  aiBudgetReserveRatio: 0.1,
  aiWageReserveWeeks: 4,
  aiDistressSellDiscount: 0.85,
  // v1.51: raised from 0.85. The stock world's median club sat AT 0.85, so half
  // of every division was locked out of the market before a ball was kicked —
  // `canAfford` refused every signing and the window went silent. Wages are a
  // small share of this economy next to fees, so a more permissive ceiling costs
  // little and is what actually lets clubs trade.
  aiMaxWageToIncomeRatio: 1.35,
  // 68 is the built-in default database's tier-1 squad average, so the stock
  // world's economy is unchanged and only richer/poorer databases are corrected.
  // The floor is 1.0: a squad BELOW the baseline never has its income cut (that
  // would just re-freeze the weaker clubs this fix exists to unblock) — the
  // scaling only ever compensates upward for a stronger-than-default database.
  wageIncomeBaselineOverall: 68,
  wageIncomeQualityMultMin: 1.0,
  wageIncomeQualityMultMax: 4.0,

  squadCap: 50,
  matchdaySquad: 18,

  simTableNoise: 4.5,

  academyMaxAge: 21,
  academyPromoteMinAge: 16,
  academyMaxLevel: 5,
  academyUpgradeCost: [2_000_000, 5_000_000, 10_000_000, 18_000_000, 32_000_000],
  academyUpkeepPerLevel: 20_000,
  // Youth scholarship wages: a raw ~50-overall kid earns £1k/wk, a senior-ready
  // ~72-overall prospect £5k/wk, scaled linearly between and clamped to the band.
  academyWageMin: 1_000,
  academyWageMax: 5_000,
  academyWageOverallLo: 50,
  academyWageOverallHi: 72,

  intakeClassBase: 3,
  intakeClassPerLevel: 0.5,
  intakeAgeMin: 14,
  intakeAgeMax: 17,
  intakeOverallBase: 46,
  intakeOverallSpread: 6,
  // v1.66: the intake ceiling distribution pulled down a touch and its spread
  // widened, so an ordinary class is genuinely ordinary and the standouts stand
  // out. A maxed academy at a giant club still centres near 80 via the level /
  // coach / reputation terms — that investment is the point.
  intakePotentialBase: 56,
  intakePotentialPerLevel: 2.2,
  intakePotentialPerCoachStar: 1.4,
  intakePotentialRepFactor: 0.08,
  intakePotentialSpread: 12,
  goldenGenChance: 0.06,
  goldenGenExtra: 2,
  goldenGenPotentialMin: 80,
  goldenGenPotentialMax: 90,

  fogBaseWidth: 15,
  fogBaseError: 9,
  fogMinWidth: 3,
  fogCoachStarReduction: 0.09,
  fogScoutStarReduction: 0.09,
  // Star bands are read as floors, not midpoints: 5★ = 90+, 4.5★ = 85–89,
  // 4★ = 80–84, 3.5★ = 75–79, and so on down to 1★ at 50 and below. Each
  // half-star is a flat 5 potential points, so the scale is legible at a glance
  // instead of needing the old rounded-midpoint arithmetic.
  starScaleMin: 50,
  starScaleMax: 90,
  starScalePerHalf: 5,

  u21MinutesWeight: 0.6,
  u21FocusBase: 5, // v1.68: 5 slots before any upgrade
  u21FocusMax: 15, // v1.68: base 5 + 10 upgrade levels
  u21FocusGrowthBonus: 0.1,
  u21SquadGrowthBonus: 0.06,
  u21GoalsPerMatch: 3.2,
  u21OppStrengthBase: 26,
  u21OppStrengthPerRep: 0.34,
  u21CoachStrengthPerStar: 0.8,

  u21CompetitionsPerSeason: 2,
  u21RoundsPerCompetition: 22,
  u21FirstKickoffDays: 30, // a month after the senior season gets going
  u21RegistrationLeadDays: 14,
  u21RoundIntervalDays: 7,
  u21RegistrationSize: 7,

  // Most clubs will deal for the right money; a third want a premium; a quarter
  // simply aren't selling. Elite prospects then multiply on top of that, which
  // is what makes an obsidian or legacy kid harder to prise away.
  //
  // v1.68 — the two multipliers COMPOUND, which nobody had priced: a legacy kid at
  // a premium club asked 2.6 × 5.0 = 13× his valuation, and even a willing seller
  // wanted 6.75×. A rival's prospect is worth a premium, not a fantasy, so the
  // stance is now a modest markup and the tier ladder tops out at 1.6× — the worst
  // case a manager can be quoted is ~2.9× value instead of 13×.
  u21SellStanceWeights: { willing: 42, premium: 33, unwilling: 25 },
  u21SellPricePremiumMult: 1.8,
  u21SellPriceWillingMult: 1.15,
  u21SellTierMult: { diamond: 1.2, obsidian: 1.4, legacy: 1.6, platinum: 1.2 },
  u21SellRefusalChance: 0.12,

  scoutReportDaysBase: 40,
  scoutReportDaysPerStar: 5,
  // Must comfortably outlast the report cadence (40 − 5×stars, floor 10) or a
  // scout's earlier finds always go cold before the next batch lands and reports
  // can never accumulate on the board (v12).
  scoutReportExpiryDays: 45,
  scoutFeeMult: 1.3,
  scoutProspectAgeMin: 15,
  scoutProspectAgeMax: 18,
  scoutPotentialBase: 62,
  scoutPotentialPerStar: 1.6,
  scoutPotentialSpread: 10,

  // Experience → report size. Rows are weights over 1,2,3,4,5,6 prospects.
  // A 1★ scout usually files one or two names; mass shifts steadily up the range
  // until a 3★ scout most often returns three and a 5★ scout half the time
  // returns three and rarely fewer than two. Row 0 is unreachable (no scout, no
  // report). Rows are already percentages and sum to 100.
  scoutReportSizeByExperience: [
    [0, 0, 0, 0, 0, 0], // — unused
    [32, 50, 10, 5, 2, 1], // 1★ → mostly one or two
    [24, 40, 20, 10, 4, 2], // 2★
    [16, 30, 30, 15, 6, 3], // 3★
    [8, 20, 40, 20, 8, 4], // 4★
    [3, 7, 50, 25, 10, 5], // 5★ → half the reports are a three-man shortlist
  ],
  // Judgement → prospect tier. Rows are weights over the six rungs of
  // `prospectTierOrder` — bronze/silver/gold/diamond/obsidian/legacy — and are
  // already percentages summing to 100, so each number reads directly as "how
  // often this judgement turns up this tier".
  //
  // A 1★ judge deals almost entirely in bronze and silver and finds a diamond
  // one report in fifty; a 5★ judge is the opposite, half his finds gold or
  // better. The top two rungs stay rare at every rating on purpose: obsidian
  // tops out at 1.5% and LEGACY at 0.75%, so even the best scout in the game
  // turns one up about once in a hundred and thirty finds.
  scoutTierByJudgement: [
    [0, 0, 0, 0, 0, 0], // — unused
    [70.0, 20.0, 7.4, 2.0, 0.5, 0.1], // 1★ →  2% diamond, 0.1% legacy
    [54.0, 28.0, 12.5, 4.5, 0.8, 0.2], // 2★
    [40.0, 34.0, 17.7, 7.0, 1.0, 0.3], // 3★
    [20.0, 46.0, 22.25, 10.0, 1.25, 0.5], // 4★
    [8.0, 50.0, 27.25, 12.5, 1.5, 0.75], // 5★ → 12.5% diamond, 0.75% legacy
  ],
  prospectTierOrder: ["bronze", "silver", "gold", "diamond", "obsidian", "legacy"],
  // Tier bands. Overall is what the kid can do now, potential the ceiling. The
  // bands overlap slightly so a tier is a strong signal, not a rigid bracket.
  // Diamond reaches the absolute cap — that's the wonderkid. Obsidian sits above
  // it, and LEGACY pins the ceiling at the cap: the once-a-career find, already
  // senior-ready as a teenager.
  // Bands are aligned to the star scale (starScaleMin/PerHalf) so a tier reads
  // as a star range without arithmetic: bronze tops out at 3★, silver spans
  // 3–3.5★, gold 3.5–4★, diamond 4.5–5★, and the top two are the full five.
  prospectTierBands: {
    // v1.66: every band's starting overall pulled down and the top ceilings
    // trimmed. A prospect is now RAW — even a Legacy find arrives in the 60s and
    // has to be developed, where before he walked in at 78–87 and needed only a
    // season or two of the (then much faster) youth curve to be world-class.
    // Ceilings still separate the tiers cleanly; they just no longer start the
    // top three rungs most of the way to their own ceiling.
    bronze: { overall: [44, 52], potential: [58, 70] },
    silver: { overall: [47, 56], potential: [66, 78] },
    gold: { overall: [51, 60], potential: [74, 84] },
    diamond: { overall: [55, 65], potential: [80, 89] },
    obsidian: { overall: [59, 69], potential: [85, 93] },
    legacy: { overall: [62, 72], potential: [89, 96] },
    // Pre-v1.53 saves can still carry a `platinum` badge; it maps onto the
    // diamond band so a migrated prospect never falls through to bronze.
    platinum: { overall: [55, 65], potential: [80, 89] },
  },
  fogJudgementStarReduction: 0.09,
  scoutWageBase: 3_000,
  scoutWagePerStar: 1_600,
  scoutFeePerStar: 55_000,
  scoutMaxHireable: 10, // v1.68: scoutNetworkBase 3 + 7 upgrade levels

  loanMaxAge: 21,
  loanWeeklyChance: 0.35,
  loanMinutesPerWeek: 72,
  loanMinutesWeightTop: 1.0,
  loanMinutesWeightSecond: 0.9,
  loanMinutesWeightSim: 0.8,
  academyLoanRepMargin: 8, // a prospect drops ~a rung to get minutes
  academyLoanRepCeiling: 12, // clubs more than this over his level don't bite
  academyLoanStarterBand: 4, // a club within this of his level plays him
  academyLoanJitter: 6, // deterministic tie-break spread on the five offered
  loanStarterMinutesMult: 1.0, // a club that plays him every week delivers full loan minutes
  loanRotationMinutesMult: 0.68, // a rotation move is worth noticeably less
  loanGrowthBonus: 0.15, // +15% growth for a developmental season out on loan
  saleKeennessPremium: 0.35, // the keenest suitor pays up to +35% over the coldest
  saleAppetiteMin: 0.88,
  saleAppetiteMax: 1.16,
  saleMinOfferShare: 0.75,
  loanGrowthMaxAge: 24,

  // Academy development boosts (v1.55)
  // v1.66: the academy bonuses were the last uncapped compounding layer — loan
  // (up to +35%) or U21 (up to +55%) times focus (+10%) landed on top of coach,
  // facility and plan. Each is roughly halved so the routes still matter for
  // WHERE a prospect develops without doubling his rate.
  academyLoanGrowthBonus: 0.06, // +6% for a developmental season out on loan
  academyLoanGrowthPerApp: 0.005, // +0.5% per loan appearance made
  academyLoanGrowthPerAppCap: 0.12, // …up to +12% from appearances alone
  academyU21GrowthBonus: 0.1, // +10% for playing the U21 league
  academyU21TeamPerfBonus: 0.08, // + up to this again for a top U21 finish
  academyU21RatingPivot: 7.0, // a U21 average rating above here counts as starring
  academyU21RatingBonus: 0.1, // + up to this again for a standout U21 campaign

  // Player regen (v1.55)
  regenMinPeakOverall: 75,
  regenAgeMin: 16,
  regenAgeMax: 18,
  regenOverallMin: 52,
  regenOverallMax: 60,

  // ── Global Club Network (v34) ──
  gcnUnlockFundsTarget: 5_000_000_000,
  gcnBuyValueMultiplier: 5,
  gcnBuyLeagueRepPremium: 2_000_000,
  gcnBuyClubRepPremium: 3_000_000,
  gcnFoundClubCost: 250_000_000,
  gcnFoundSquadAvgOverall: 58,
  // Group Clubs: 4 owned clubs at level 0, +2 per level, 8 levels → cap 20.
  gcnGroupClubsBase: 4,
  gcnGroupClubsPerLevel: 2,
  gcnGroupClubsUpgradeCost: [
    150_000_000, 300_000_000, 500_000_000, 750_000_000,
    1_050_000_000, 1_400_000_000, 1_800_000_000, 2_250_000_000,
  ],
  gcnGroupClubsMaxLevel: 8,
  // Brand Deals: L1 pays 100k/wk, +50k per level, 9 levels → 500k/wk at max.
  gcnBrandDealsBase: 100_000,
  gcnBrandDealsPerLevel: 50_000,
  gcnBrandDealsUpgradeCost: [
    150_000_000, 225_000_000, 300_000_000, 375_000_000, 450_000_000,
    525_000_000, 600_000_000, 675_000_000, 750_000_000,
  ],
  gcnBrandDealsMaxLevel: 9,
  // GCN Deals: L1 pays each owned club 50k/wk, +25k per level, 9 levels → 250k/wk.
  gcnDealsBase: 50_000,
  gcnDealsPerLevel: 25_000,
  gcnDealsUpgradeCost: [
    250_000_000, 400_000_000, 550_000_000, 700_000_000, 850_000_000,
    1_000_000_000, 1_150_000_000, 1_300_000_000, 1_450_000_000,
  ],
  gcnDealsMaxLevel: 9,
  gcnSellClubPriceFactor: 0.8,
  gcnSellPlayerPriceFactor: 0.9,
  gcnSellMinSquadSize: 16,
  gcnMinHoldSeasons: 5,
  gcnAllowHomeCountryClubs: true,

  // v1.67: both subsidies switched off — they were inflating AI budgets far
  // beyond anything the market could justify by the third season. Zero disables
  // the payments entirely (both call sites guard on > 0).
  aiSeasonSubsidy: 0,
  aiWeeklySubsidy: 0,

  // Running costs sized so a mid-table club roughly breaks even on its recurring
  // lines and banks its prize money, rather than banking everything. The
  // reinvestment write-off then keeps the cash pile from compounding: a club
  // holding far more than it needs spends 30% of the excess each season on the
  // operation, floored at two years of wages so nobody is ever left unable to
  // trade.
  aiOperatingCostPerReputationByTier: [7_000, 2_600, 1_100, 550],
  // 55% of the excess a season, floored at 1.5 years of the club's own wages.
  // At 30% the write-off couldn't keep up with the income refilling the pile —
  // a club relegated with top-flight cash still sat on £200M+ in the third tier
  // several seasons later. At this rate a cash pile converges within two or three
  // seasons of a club's actual level, which is the point: a division's clubs
  // should be as rich as that division, whatever they used to be.
  aiSurplusReinvestRate: 0.55,
  aiSurplusFloorWageYears: 1.5,

  targetGoalsPerMatch: 2.7,
  targetHomeWinPct: 45,
};
