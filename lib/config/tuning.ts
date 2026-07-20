// ── Single tuning config (GAME_DESIGN.md §14) ─────────────────────────────
// Every balance number lives here. Tuning never means editing engine code.
// Adjust only via the calibration harness (npm run calibrate).

import type { Mentality, ProspectTier, Style } from "../types";

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
  // Investment deadlines & slot discipline (v11). An offer is a real decision:
  // it sits on the table for a short, visible window and is gone if not signed,
  // after which the slot goes quiet for a cooldown before a new suitor appears.
  sponsorDeadlineDaysMajor: number; // days a major offer stays on the table
  sponsorDeadlineDaysMinor: number; // days a minor offer stays on the table
  sponsorCooldownDaysMin: number; // shortest quiet spell after a lapsed/passed offer
  sponsorCooldownDaysMax: number; // longest quiet spell
  /** Cap on concurrently-signed major deals. Majors pay a lump sum on signing,
   * so without a cap the user can hold every major at once and re-sign short
   * ones each season for repeated windfalls. Keeps the big money a choice. */
  sponsorMaxActiveMajors: number;
  /** Minimum length for a major deal, in seasons. Enforced at offer generation
   * so a lump sum is always a multi-season commitment rather than a yearly
   * re-signable windfall. */
  sponsorMajorMinSeasons: number;

  // Training facilities (Player Development). One-time upgrade cost per level;
  // no weekly income — they speed development / recovery instead. Costs are a
  // major-infrastructure decision (v15): a training centre competes with a
  // marquee signing, not with a squad-player fee.
  trainingFacilityMaxLevel: number;
  trainingUpgradeCost: number[];
  medicalUpgradeCost: number[];

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
  starScaleMin: number; // potential mapped to 1 star
  starScaleMax: number; // potential mapped to 5 stars

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
  // prospects a report brings back (1–7); JUDGEMENT decides how good they are
  // (which ProspectTier each find lands in). Both are pure distribution tables
  // indexed by star rating, so the engine only ever samples — it never
  // special-cases a rating.
  /** Per experience star (index 1–5), the probability weights over report sizes
   * 1…7. Row index 0 is unused (no scout, no report). Each row is normalised at
   * sample time, so the numbers read as relative likelihoods. */
  scoutReportSizeByExperience: number[][];
  /** Per judgement star (index 1–5), the probability weights over the prospect
   * tiers in `prospectTierOrder`. Row 0 unused. */
  scoutTierByJudgement: number[][];
  /** Tier order the weight rows above are indexed against. */
  prospectTierOrder: ProspectTier[];
  /** Per-tier quality bands. `overall` is the ability a find comes back with and
   * `potential` the ceiling it is given — a Platinum prospect is the wonderkid.
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

  // Maturity curve: 12yo ≈ 0.42 of eventual ability, 14 ≈ 0.55, 16 ≈ 0.71,
  // 18 ≈ 0.86, 20 ≈ 0.97, finished at 21. Because it's a continuous curve rather
  // than a bracketed cap, each extra year of age is worth something — a 16yo is
  // meaningfully ahead of a 14yo of identical promise, which is the thing the
  // old age-locked model got wrong. ~3% roll "prodigy" and mature early, which
  // is where the genuine 80-rated 17-year-old comes from.
  maturityStartAge: 12,
  maturityFullAge: 21,
  maturityFloor: 0.42,
  maturityCurve: 1.35,
  maturitySpread: 2.5,
  youthProdigyChance: 0.03,
  youthProdigyKeepMin: 0.55,
  youthProdigyKeepMax: 0.9,
  youthPotentialFloor: 88,
  youthPotentialBandTop: 96,

  heightFullAge: 19,
  heightPerYoungYear: 0.012,

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
  stadiumUpgradeCost: [9_000_000, 21_000_000, 42_000_000, 74_000_000, 125_000_000],
  stadiumIncomePerLevel: 90_000,
  commercialUpgradeCost: [7_000_000, 16_000_000, 32_000_000, 58_000_000, 100_000_000],
  commercialIncomePerLevel: 70_000,
  mediaUpgradeCost: [5_000_000, 12_000_000, 25_000_000, 45_000_000, 76_000_000],
  mediaIncomePerLevel: 55_000,
  hospitalityUpgradeCost: [8_000_000, 18_000_000, 35_000_000, 62_000_000, 105_000_000],
  hospitalityIncomePerLevel: 75_000,
  retailUpgradeCost: [6_000_000, 14_000_000, 28_000_000, 50_000_000, 85_000_000],
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
  sponsorMajorLengthMin: 2,
  sponsorMajorLengthMax: 4,
  // A major is a 12-day decision; minors linger a little longer since they're
  // lower stakes. Cooldowns are short enough that a passed slot isn't dead for
  // a season, long enough that passing costs you something.
  sponsorDeadlineDaysMajor: 12,
  sponsorDeadlineDaysMinor: 18,
  sponsorCooldownDaysMin: 14,
  sponsorCooldownDaysMax: 30,
  sponsorMaxActiveMajors: 1,
  sponsorMajorMinSeasons: 2,

  // 10× the old costs (v15). Training infrastructure is now a genuine
  // long-horizon investment weighed against the transfer market, not a cheap
  // early-game formality bought in the first season.
  trainingFacilityMaxLevel: 5,
  trainingUpgradeCost: [35_000_000, 80_000_000, 160_000_000, 280_000_000, 480_000_000],
  medicalUpgradeCost: [25_000_000, 60_000_000, 120_000_000, 220_000_000, 380_000_000],

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

  scoutNetworkMaxLevel: 5, // base 2 + 5 levels → up to 7 scouts on assignment
  scoutNetworkBase: 2,
  scoutNetworkUpgradeCost: [3_500_000, 7_000_000, 12_000_000, 18_000_000, 25_000_000],

  academySquadSizeBase: 12, // base 12 + 4 levels × 3 → up to 24 prospects
  academySquadSizePerLevel: 3,
  academySquadMaxLevel: 4,
  academySquadUpgradeCost: [2_000_000, 4_500_000, 8_000_000, 13_000_000],

  focusSlotMaxLevel: 7, // base 3 + 7 levels → up to 10 focus slots
  focusSlotUpgradeCost: [1_500_000, 3_000_000, 5_000_000, 7_500_000, 10_500_000, 14_000_000, 18_000_000],

  valueCurve: { base: 12_000, exponent: 0.104 },
  youthPotentialValueBoost: 1.8,
  aiAcceptThreshold: 1.1,
  aiKeyPlayerPremium: 1.35,
  aiBidChancePerWeek: 0.1,
  freeAgentSigningFee: 0,
  negotiationBuyerCeilingMult: 1.6,
  negotiationMaxRounds: 3,
  negotiationWalkAwayOver: 1.15,

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
  aiMinUpgradeGain: 1.5,
  aiAgeBandFalloff: 0.78,
  aiMaxBudgetSharePerDeal: 0.45,
  aiDealsPerWeek: 2,

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
  u21FocusBase: 3,
  u21FocusMax: 10,
  u21FocusGrowthBonus: 0.1,
  u21SquadGrowthBonus: 0.06,
  u21GoalsPerMatch: 3.2,
  u21OppStrengthBase: 26,
  u21OppStrengthPerRep: 0.34,
  u21CoachStrengthPerStar: 0.8,

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

  // Experience → report size. Rows are weights over 1,2,3,4,5,6,7 prospects.
  // A 1★ scout almost always files a single name (and only ~1% of the time the
  // full seven); mass shifts steadily up the range until a 5★ scout returns
  // seven half the time. Row 0 is unreachable (no scout, no report).
  scoutReportSizeByExperience: [
    [0, 0, 0, 0, 0, 0, 0], //  — unused
    [55, 22, 12, 6, 3, 1, 1], // 1★ →  1% seven
    [30, 27, 20, 11, 6, 3, 3], // 2★ →  3%
    [12, 18, 24, 20, 12, 7, 7], // 3★ →  7%
    [4, 8, 15, 20, 20, 13, 20], // 4★ → 20%
    [2, 3, 6, 9, 12, 18, 50], // 5★ → 50%
  ],
  // Judgement → prospect tier. Rows are weights over bronze/silver/gold/platinum.
  // A poor judge mostly turns up bronze and hits platinum ~1% of the time; a
  // 5★ judge finds a wonderkid roughly one report in ten.
  scoutTierByJudgement: [
    [0, 0, 0, 0], // — unused
    [64, 27, 8, 1], // 1★ →  1% platinum
    [48, 34, 16, 2], // 2★ →  2%
    [32, 38, 26, 4], // 3★ →  4%
    [18, 36, 39, 7], // 4★ →  7%
    [8, 30, 52, 10], // 5★ → 10%
  ],
  prospectTierOrder: ["bronze", "silver", "gold", "platinum"],
  // Tier bands. Overall is what the kid can do now, potential the ceiling. The
  // bands overlap slightly so a tier is a strong signal, not a rigid bracket.
  // Platinum reaches the absolute cap — that's the generational talent.
  prospectTierBands: {
    bronze: { overall: [50, 58], potential: [62, 74] },
    silver: { overall: [54, 64], potential: [73, 83] },
    gold: { overall: [60, 71], potential: [82, 90] },
    platinum: { overall: [68, 80], potential: [89, 97] },
  },
  fogJudgementStarReduction: 0.09,
  scoutWageBase: 3_000,
  scoutWagePerStar: 1_600,
  scoutFeePerStar: 55_000,
  scoutMaxHireable: 7, // scoutNetworkBase 2 + 5 upgrade levels

  loanMaxAge: 21,
  loanWeeklyChance: 0.35,
  loanMinutesPerWeek: 72,
  loanMinutesWeightTop: 1.0,
  loanMinutesWeightSecond: 0.9,
  loanMinutesWeightSim: 0.8,

  targetGoalsPerMatch: 2.7,
  targetHomeWinPct: 45,
};
