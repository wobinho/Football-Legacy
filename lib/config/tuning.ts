// ── Single tuning config (GAME_DESIGN.md §14) ─────────────────────────────
// Every balance number lives here. Tuning never means editing engine code.
// Adjust only via the calibration harness (npm run calibrate).

import type { Mentality, Style } from "../types";

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
  synergyCap: number; // ±10%
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
  /** Attacking focus biases scorer/assist weighting toward a flank or the centre. */
  focusFlankBias: number; // extra scorer weight applied to the emphasised side (0..1)

  // ── Set pieces (v6, EA-FC-style assignments) ──
  penaltyChance: number; // chance a given chance is a penalty
  freeKickChance: number; // chance it's a direct free-kick
  cornerChance: number; // chance it's a corner
  penaltyConversion: number; // fixed goal probability for a penalty
  setPieceTakerBias: number; // scorer/assist weight multiplier for the designated taker

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
  clutchMinute: number; // Clutch trait activates from here

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

  // Youth overall realism (§5, v9 balance). A young player's *current* overall is
  // pulled toward an age-appropriate "soft cap" — most 17-year-olds land in the
  // 50s–low-60s, not already an 88. But this is a SOFT cap, not a hard ceiling:
  // a rare seeded "prodigy" roll lets a teenager keep most of a high requested
  // overall, so once in a while a genuine 80-rated 17-year-old with a 90+ ceiling
  // appears. Ability the soft cap trims is folded back into potential either way,
  // so trimmed kids still read as high-ceiling prospects.
  youthOverallCapBase: number; // soft-cap centre at youthOverallCapStartAge
  youthOverallCapStartAge: number; // youngest age the soft cap applies from
  youthOverallCapPerYear: number; // soft cap rises this much per year until it clears
  youthOverallCapClearAge: number; // age at/after which no cap applies
  youthProdigyChance: number; // per-young-player chance of an uncapped prodigy roll
  youthProdigyKeepMin: number; // prodigy keeps at least this fraction of ability over the cap
  youthProdigyKeepMax: number; // …up to this fraction (rest still becomes headroom)
  youthSoftCapOvershoot: number; // ordinary youths may exceed the cap by up to this much (jitter)

  // Youth potential band (balance): growing players are given a hidden ceiling
  // in a high, well-spread band so almost every prospect is worth developing but
  // ceilings still vary meaningfully. Only applies to players young enough to
  // still grow (age <= growthEndAge); prime/veteran headroom is untouched.
  youthPotentialFloor: number; // growing players' potential is pulled up to at least this
  youthPotentialBandTop: number; // …and spread up toward this (capped by potentialAbsoluteCap)

  // Player quality floor (balance): no generated player is ever weaker than this
  // overall. Keeps the world free of hopeless 38-rated bodies — every player is at
  // least a rough professional, and every prospect is worth developing.
  minOverall: number;

  // Development (§5)
  growthEndAge: number; // 24
  primeEndAge: number; // 31
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
  weeklyIncomeByTier: number[]; // index = tier-1
  positionBonusMax: number; // 1st place weekly bonus, scales linearly to 0
  gateIncomePerReputation: number;
  wagePerOverallCurve: { base: number; exponent: number }; // weekly wage ≈ base * exp(exponent*overall)
  seasonPrizeByTier: number[]; // end-of-season prize for champion, scales down
  promotionBonus: number;
  cupWinBonus: number;

  // Club income facilities (§ club income) — one-time upgrade cost per level,
  // permanent weekly income boost. Index = level being purchased (0 → level 1).
  facilityMaxLevel: number;
  stadiumUpgradeCost: number[]; // cost to reach each level
  stadiumIncomePerLevel: number; // extra weekly gate income per level
  commercialUpgradeCost: number[];
  commercialIncomePerLevel: number; // extra weekly commercial income per level
  // Extra revenue facilities (v6) — same pattern, more ways to grow income.
  mediaUpgradeCost: number[];
  mediaIncomePerLevel: number; // club media / streaming
  hospitalityUpgradeCost: number[];
  hospitalityIncomePerLevel: number; // corporate boxes & premium seating
  retailUpgradeCost: number[];
  retailIncomePerLevel: number; // megastore + online merchandising

  // Staff market (v6) — dismiss-to-refresh cadence.
  staffRefreshDays: number; // days until a dismissed slot's new crop arrives

  // Sponsors / investments (v6, Club → Income). Weekly income from season-long
  // deals; quality scales with club reputation, division, and squad
  // marketability (the Marketable trait).
  sponsorBaseWeeklyByReputation: number; // weekly £ per reputation point, shirt-scaled
  sponsorSlotShare: Record<string, number>; // per-slot fraction of the shirt baseline
  sponsorTierMults: number[]; // offer tier multipliers (Regional/National/Global)
  sponsorMarketabilityFactor: number; // how strongly squad marketability lifts offers
  sponsorLengthMin: number; // shortest deal offered (seasons)
  sponsorLengthMax: number; // longest deal offered
  sponsorOfferExpiryDays: number; // an unsigned offer expires after this many days
  sponsorRefreshDays: number; // days after slot empties before a new offer lands
  // Major (lump-sum) vs minor (weekly) investments (v7). Majors pay a one-time
  // upfront ≈ (equivalent weekly × ~52 weeks × season length × incentive mult);
  // minors run at most one season and pay weekly.
  sponsorMajorSlots: string[]; // which slots are lump-sum majors
  sponsorMajorUpfrontMult: number; // incentive multiplier on the equivalent-weekly lump
  sponsorMajorLengthMin: number; // shortest major deal (seasons)
  sponsorMajorLengthMax: number; // longest major deal (seasons)

  // Training facilities (Player Development). One-time upgrade cost per level;
  // no weekly income — they speed development / recovery instead.
  trainingFacilityMaxLevel: number;
  trainingUpgradeCost: number[];
  medicalUpgradeCost: number[];

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

  // Scouting network facility (v5): raises concurrent scout assignments. Bought
  // from the Scouting Department Upgrades panel (Academy → Scouting).
  scoutNetworkMaxLevel: number; // capacity = scoutNetworkBase + level
  scoutNetworkBase: number; // assignments available at level 0 (with a scout hired)
  scoutNetworkUpgradeCost: number[]; // one-time cost to reach each level

  // Academy squad-size facility (v7): raises how many prospects the academy can
  // hold at once. Bought from the Scouting Department Upgrades panel. Cap =
  // academySquadSizeBase + level*academySquadSizePerLevel.
  academySquadSizeBase: number; // prospects the academy holds at level 0
  academySquadSizePerLevel: number; // + per upgrade level
  academySquadMaxLevel: number;
  academySquadUpgradeCost: number[]; // one-time cost to reach each level

  // Transfers (§10 — interim rules pending design session)
  valueCurve: { base: number; exponent: number }; // value ≈ base * exp(exponent*overall)
  youthPotentialValueBoost: number; // multiplier at max headroom
  aiAcceptThreshold: number; // accept if bid >= value * threshold (fringe)
  aiKeyPlayerPremium: number; // starters demand more
  aiBidChancePerWeek: number; // chance an AI club bids on a user player
  freeAgentSigningFee: number;
  // Incoming-offer negotiation (EA-FC-style). A buyer opens below its ceiling and
  // the user can counter with any number; the AI accepts at/under the ceiling,
  // counters back toward the midpoint, or walks if pushed too far / too long.
  negotiationBuyerCeilingMult: number; // ceiling ≈ value * this (over the opening offer)
  negotiationMaxRounds: number; // user counters allowed before patience runs out
  negotiationWalkAwayOver: number; // instant walk if a counter exceeds ceiling * this
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

  // Intake day (mid-March, once per season)
  intakeClassBase: number; // class size at level 0
  intakeClassPerLevel: number; // + per academy level (rounded)
  intakeAgeMin: number;
  intakeAgeMax: number;
  intakeOverallBase: number; // raw ability center of a new class
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
  starScaleMin: number; // potential mapped to 1 star
  starScaleMax: number; // potential mapped to 5 stars

  // U21 league (12 teams, double round-robin, statistical)
  u21MinutesWeight: number; // youth minute worth vs a senior minute (development)
  u21FocusMax: number; // focus prospects the user may flag
  u21FocusGrowthBonus: number; // extra growth multiplier for focus prospects
  u21SquadGrowthBonus: number; // extra growth multiplier for players tagged into the U21 squad
  u21GoalsPerMatch: number; // youth football is looser than the senior game
  u21OppStrengthBase: number; // opponent strength = base + rep * perRep (+noise)
  u21OppStrengthPerRep: number;
  u21CoachStrengthPerStar: number; // youth-coach bonus to user U21 strength

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

  // Loans (out only)
  loanMaxAge: number;
  loanWeeklyChance: number; // chance per open-window week a listed player is taken
  loanMinutesPerWeek: number; // statistical minutes credited per week on loan
  loanMinutesWeightTop: number; // minute weight by destination: tier 1 / tier 2 / sim
  loanMinutesWeightSecond: number;
  loanMinutesWeightSim: number;

  // Calibration targets (for the harness printout)
  targetGoalsPerMatch: number;
  targetHomeWinPct: number;
}

export const TUNING: TuningConfig = {
  schemaVersion: 1,

  segmentsPerMatch: 6,
  minutesPerSegment: 15,
  baseChancesPerSegment: 1.73,
  goalProbFloor: 0.08,
  goalProbCeil: 0.4,
  chanceQualitySlope: 11.0,
  midfieldSharpness: 2.2,
  chanceQualityCenter: 0.385,
  homeAdvantage: 1.07,
  synergyCap: 0.1,
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

  // Rock-paper-scissors, hidden. Counter beats Possession, Possession beats
  // Direct, Direct beats Counter. Diagonal (mirror) is neutral 1.0. Off-diagonal
  // edges sit at ±6% on ATTACK so a good read tilts a match without deciding it.
  styleCounter: {
    Possession: { Possession: 1.0, Counter: 0.94, Direct: 1.06 },
    Counter: { Possession: 1.06, Counter: 1.0, Direct: 0.94 },
    Direct: { Possession: 0.94, Counter: 1.06, Direct: 1.0 },
  },
  // Attacking overloads a Defensive block but is caught out by a compact Balanced
  // shape; Defensive frustrates Attacking. Kept gentle (±4%).
  mentalityCounter: {
    Defensive: { Defensive: 1.0, Balanced: 0.98, Attacking: 1.04 },
    Balanced: { Defensive: 1.02, Balanced: 1.0, Attacking: 1.02 },
    Attacking: { Defensive: 0.96, Balanced: 0.98, Attacking: 1.0 },
  },

  subMinutes: [60, 75],
  maxSubs: 5,
  clutchMinute: 75,

  fitnessDrainPerMatch: 22,
  fitnessDrainAgeFactor: 0.8,
  fitnessRecoveryPerDay: 3.5,
  fitnessCoachRecoveryPerStar: 0.35,
  physioRecoveryPerStar: 0.25,
  minFitnessToStart: 55,

  headCoachMatchdayPerStar: 0.01,

  formNudgePerRatingPoint: 0.012,

  // Soft cap centres: a 12yo ~52, 15yo ~63, 17yo ~72, clearing at 22. Ordinary
  // youths are pulled to (just around) this; the ability trimmed becomes potential
  // headroom. But ~3% of young players roll "prodigy" and keep most of a high
  // requested overall — that's the rare 80-rated-17yo-with-a-90-ceiling gem.
  // (Centres raised so even a 12-year-old academy kid clears the 50-overall floor
  // and reads as a real, developable prospect rather than a hopeless 38.)
  youthOverallCapBase: 52,
  youthOverallCapStartAge: 12,
  youthOverallCapPerYear: 3.7,
  youthOverallCapClearAge: 22,
  youthProdigyChance: 0.03,
  youthProdigyKeepMin: 0.6,
  youthProdigyKeepMax: 0.95,
  youthPotentialFloor: 88,
  youthPotentialBandTop: 96,
  youthSoftCapOvershoot: 3,

  minOverall: 50,

  growthEndAge: 24,
  primeEndAge: 31,
  declineOnsetAge: 32,
  declineOnsetLongevitySwing: 2,
  declineOnsetPaceReliancePenalty: 1.5,
  growthPerSeasonMax: 6,
  declinePerSeasonBase: 1.6,
  growthCatchupBelow: 60,
  growthCatchupMult: 1.8,
  retirementAgeMin: 34,
  retirementAgeMax: 37,

  potentialRecalcAgeMax: 29,
  potentialUpMax: 3,
  potentialDownMax: 2,
  potentialPerfPivot: 6.9,
  potentialMinutesFloor: 0.25,
  potentialAbsoluteCap: 97,
  trainingFacilityGrowthPerLevel: 0.12,
  medicalFacilityRecoveryPerLevel: 0.5,
  medicalFacilityAgeDrainReductionPerLevel: 0.12,

  weeklyIncomeByTier: [950_000, 320_000],
  positionBonusMax: 300_000,
  gateIncomePerReputation: 6_000,
  wagePerOverallCurve: { base: 160, exponent: 0.082 },
  seasonPrizeByTier: [25_000_000, 8_000_000],
  promotionBonus: 30_000_000,
  cupWinBonus: 10_000_000,

  facilityMaxLevel: 5,
  stadiumUpgradeCost: [4_000_000, 9_000_000, 18_000_000, 32_000_000, 55_000_000],
  stadiumIncomePerLevel: 90_000,
  commercialUpgradeCost: [3_000_000, 7_000_000, 14_000_000, 26_000_000, 45_000_000],
  commercialIncomePerLevel: 70_000,
  mediaUpgradeCost: [2_000_000, 5_000_000, 11_000_000, 20_000_000, 34_000_000],
  mediaIncomePerLevel: 55_000,
  hospitalityUpgradeCost: [3_500_000, 8_000_000, 15_000_000, 27_000_000, 46_000_000],
  hospitalityIncomePerLevel: 75_000,
  retailUpgradeCost: [2_500_000, 6_000_000, 12_000_000, 22_000_000, 38_000_000],
  retailIncomePerLevel: 60_000,

  staffRefreshDays: 2,

  sponsorBaseWeeklyByReputation: 5_200,
  sponsorSlotShare: { shirt: 1.0, sleeve: 0.35, apparel: 0.6, boot: 0.4, stadium: 0.75 },
  sponsorTierMults: [0.7, 1.0, 1.4], // Regional / National / Global
  sponsorMarketabilityFactor: 1.0,
  sponsorLengthMin: 1,
  sponsorLengthMax: 4,
  sponsorOfferExpiryDays: 21,
  sponsorRefreshDays: 5,
  sponsorMajorSlots: ["shirt", "stadium"],
  sponsorMajorUpfrontMult: 1.15,
  sponsorMajorLengthMin: 1,
  sponsorMajorLengthMax: 3,

  trainingFacilityMaxLevel: 5,
  trainingUpgradeCost: [3_500_000, 8_000_000, 16_000_000, 28_000_000, 48_000_000],
  medicalUpgradeCost: [2_500_000, 6_000_000, 12_000_000, 22_000_000, 38_000_000],

  contractWageCurve: { base: 160, exponent: 0.082 },
  contractLengthMin: 1,
  contractLengthMax: 5,
  contractDemandMult: 1.0,
  contractRenewYearsDefault: 3,
  contractAcceptRatio: 0.98,
  contractRejectRatio: 0.8,
  contractVeteranAge: 32,

  scoutNetworkMaxLevel: 3, // base 2 + 3 levels → up to 5 scouts on assignment
  scoutNetworkBase: 2,
  scoutNetworkUpgradeCost: [3_500_000, 7_000_000, 12_000_000],

  academySquadSizeBase: 12, // base 12 + 4 levels × 3 → up to 24 prospects
  academySquadSizePerLevel: 3,
  academySquadMaxLevel: 4,
  academySquadUpgradeCost: [2_000_000, 4_500_000, 8_000_000, 13_000_000],

  valueCurve: { base: 12_000, exponent: 0.104 },
  youthPotentialValueBoost: 1.8,
  aiAcceptThreshold: 1.1,
  aiKeyPlayerPremium: 1.35,
  aiBidChancePerWeek: 0.1,
  freeAgentSigningFee: 0,
  negotiationBuyerCeilingMult: 1.6,
  negotiationMaxRounds: 3,
  negotiationWalkAwayOver: 1.15,
  squadCap: 50,
  matchdaySquad: 18,

  simTableNoise: 4.5,

  academyMaxAge: 21,
  academyPromoteMinAge: 16,
  academyMaxLevel: 5,
  academyUpgradeCost: [2_000_000, 5_000_000, 10_000_000, 18_000_000, 32_000_000],
  academyUpkeepPerLevel: 20_000,

  intakeClassBase: 3,
  intakeClassPerLevel: 0.5,
  intakeAgeMin: 12,
  intakeAgeMax: 17,
  intakeOverallBase: 50,
  intakeOverallSpread: 6,
  intakePotentialBase: 60,
  intakePotentialPerLevel: 2.2,
  intakePotentialPerCoachStar: 1.4,
  intakePotentialRepFactor: 0.08,
  intakePotentialSpread: 11,
  goldenGenChance: 0.06,
  goldenGenExtra: 2,
  goldenGenPotentialMin: 84,
  goldenGenPotentialMax: 93,

  fogBaseWidth: 15,
  fogBaseError: 9,
  fogMinWidth: 3,
  fogCoachStarReduction: 0.09,
  fogScoutStarReduction: 0.09,
  starScaleMin: 50,
  starScaleMax: 92,

  u21MinutesWeight: 0.6,
  u21FocusMax: 3,
  u21FocusGrowthBonus: 0.1,
  u21SquadGrowthBonus: 0.06,
  u21GoalsPerMatch: 3.2,
  u21OppStrengthBase: 26,
  u21OppStrengthPerRep: 0.34,
  u21CoachStrengthPerStar: 0.8,

  scoutReportDaysBase: 40,
  scoutReportDaysPerStar: 5,
  scoutReportExpiryDays: 14,
  scoutFeeMult: 1.3,
  scoutProspectAgeMin: 15,
  scoutProspectAgeMax: 18,
  scoutPotentialBase: 62,
  scoutPotentialPerStar: 1.6,
  scoutPotentialSpread: 10,

  loanMaxAge: 21,
  loanWeeklyChance: 0.35,
  loanMinutesPerWeek: 72,
  loanMinutesWeightTop: 1.0,
  loanMinutesWeightSecond: 0.9,
  loanMinutesWeightSim: 0.8,

  targetGoalsPerMatch: 2.7,
  targetHomeWinPct: 45,
};
