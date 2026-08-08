// ── Single tuning config (GAME_DESIGN.md §14) ─────────────────────────────
// Every balance number lives here. Tuning never means editing engine code.
// Adjust only via the calibration harness (npm run calibrate).

import type { GcnExecRole, Mentality, ProspectTier, ScoutTravelBand, Style } from "../types";

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
  synergyCap: number; // ±10% (archetype/tactic synergy band) — v2.1, was ±20%
  /**
   * How far a role's INSTRUCTION fit may move his own effective rating. ±6%.
   *
   * The archetype half of the identity system: `synergyCap` above bounds "does
   * this KIND of player suit the style" (a class question), and this bounds
   * "does this exact ROLE suit the five dials". Deliberately the smaller of the
   * two — style is the headline choice and the dials are fine-tuning, so the
   * fine-tuning must not outweigh it. Smaller than `TACTIC_FIT_SWING` (±8%) for
   * the same reason: whether a squad CAN execute a plan matters more than
   * whether a role enjoys it.
   *
   * There is deliberately no second channel. Rating already feeds attack,
   * midfield, defense and scorer weighting, so one lever moves everything — the
   * v1.73 system that moved six separate engine quantities was both harder to
   * reason about and, as it turned out, quietly broken. If you are tempted to
   * add "…and it should also affect stamina", that is how the six came back.
   */
  instructionFitSwing: number;
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
  /** Attack-weighted mean `paceReliance` — the point at which a side's attackers
   * exploit a high line exactly as much as an average side would (v2.1). Derived
   * from the archetype table by measurement; see the value's own note. */
  paceExploitPivot: number;
  /** How hard pace punishes an exposed defensive line (v2.1). Multiplied by how
   * exposed the line actually is, so a deep block is never affected. */
  paceExploitSwing: number;
  /**
   * How hard a defence's SHAPE against a chance type moves that chance's
   * conversion (v2.2) — the single dial for the chance-type system in
   * `lib/chancetypes.ts`, which replaced the role brief's rating bonus.
   *
   * Multiplies a resistance already centred on a measured pivot, so an ordinary
   * defence lands on exactly 1 whatever this is set to and the world's scoring
   * cannot drift. It therefore scales how much SHAPE matters against SHAPE —
   * whether a crossing side is genuinely blunted by two towering centre backs —
   * without touching how many chances anybody creates.
   *
   * Re-run `npm run calibrate` (conversion is what it measures) plus
   * `verify:standings` and `verify:reputation` if it moves: this is the channel
   * that replaced the largest lookup lever, and the note beside `synergyCap`
   * records how sharply those two harnesses react to compressing identity.
   */
  chanceTypeSwing: number;
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

  // ── Match ratings (v2.0) ─────────────────────────────────────────────────
  //
  // What a player's 4–10 out of ten is made of. Before v2.0 the whole formula
  // was `6.5 + goals + assists/2 + gd×0.15 + ±0.4` — so a midfielder who
  // neither scored nor assisted came out at 6.5 every single week, and a season
  // of them averaged 6.5 with a standard deviation small enough that the
  // individual awards (which score `avgRating × (1 + teamSuccess)`) were
  // decided almost entirely by which club finished highest. The whole spread
  // that separates a great season from an ordinary one lived in the ±0.4 noise.
  //
  // Every term below is a REASON a rating moved, so a number on the match
  // report can be traced to something that happened on the pitch.

  /** The rating a wholly unremarkable full appearance earns. */
  ratingBase: number;
  /** Per goal, and per assist. */
  ratingPerGoal: number;
  ratingPerAssist: number;
  /** Per goal of the final margin, from the player's own side's point of view.
   * Small: a rout is a team outcome and shouldn't hand a bit-part player the
   * same credit as a scorer. */
  ratingPerGoalDiff: number;
  /** Clean-sheet bonus for the keeper and the back line. */
  ratingCleanSheet: number;
  /** Conceding is a defender's business, so it is charged to the defence per
   * goal against — the counterpart to the clean sheet, and what stops a back
   * four beaten 5-0 rating the same as one that lost 1-0. */
  ratingPerConcededDef: number;
  /**
   * How hard a player's own PERFORMANCE LEVEL moves his rating.
   *
   * This is the term that actually creates the spread, and it is the reason a
   * defensive midfielder can now have a genuinely good game. It reads how his
   * effective rating on the day compared with what he is ordinarily worth —
   * i.e. form, fitness, how well the tactic suited him, whether he was played
   * out of position — and converts that ratio into rating points. A player 10%
   * above his own baseline earns about `ratingFormWeight × 0.1` of a point.
   *
   * Deliberately measured against HIS OWN overall rather than against the
   * league: an 88-rated striker having a quiet game should rate below a
   * 70-rated one having the game of his life, which is exactly what an
   * end-of-season award needs to be able to see.
   */
  ratingFormWeight: number;
  /**
   * Rating points per point of overall above the MATCH's own mean.
   *
   * The performance term above is quality-neutral by construction (it divides
   * by the player's own overall), so without this a season of ratings would
   * correlate ~0 with ability and the awards would again be decided by noise
   * and team success. This is the term that says a better player has, on
   * average, a better game.
   *
   * Small on purpose: at 0.03 a fifteen-point quality gap is worth about half a
   * rating point, so a great game by an ordinary player still outranks a quiet
   * one by a star. Raise it and awards become a re-ranking of the overall
   * column; drop it to zero and they become a lottery. Both are worse.
   */
  ratingPerOverallEdge: 0.075,
  /**
   * Spread of the per-match luck term, as a standard deviation.
   *
   * Larger than the old ±0.4 uniform band, and normally distributed rather than
   * flat: real match ratings cluster around the middle with genuine outliers at
   * the edges, where a uniform band produces as many 6.9s as 6.5s and no 8.5s
   * at all. This is the only term with no in-fiction reason behind it, so it is
   * kept smaller than the performance term — luck should be visible in one
   * match and average out across a season, which is what makes the season-long
   * table of averages worth reading.
   */
  ratingNoiseSd: number;
  /** A substitute's rating is pulled toward the base by how little he played,
   * so a 10-minute cameo can't win Player of the Season off one goal. At 0 a
   * sub is judged exactly like a starter; at 1 a 1-minute appearance is worth
   * precisely the base. Applies to the EARNED part only — a goal still counts,
   * it just counts proportionately. */
  ratingSubDamping: number;
  /** Floor and ceiling. 10 is a perfect game and must stay reachable; 4 is as
   * bad as a rating gets. */
  ratingMin: number;
  ratingMax: number;

  // Sim leagues get the same three ideas as the playable engine — how good he
  // is for this level, what his side achieved, and luck — expressed per SEASON
  // rather than per match, since the resolver never plays one. The two halves
  // of the world have to agree here: the legacy awards pool every top flight,
  // so a sim league whose ratings are flatter than a playable one's would win
  // or lose them purely on which kind of league a player happens to be in.
  /** Rating points per point of overall above the league's own mean. */
  simRatingPerOverall: number;
  /** Total swing across the table, champions to bottom club. */
  simRatingFinishSwing: number;
  /** Season-rating spread, as a standard deviation. Narrower than the per-match
   * figure because this IS a season average — a mean over 30 matches has far
   * less variance than one match does, and using the match figure here would
   * make sim players spread wider than playable ones. */
  simRatingNoiseSd: number;
  /** Ceiling on what goals or assists can add to a sim player's season rating,
   * so a freak tally can't hand him a 10.0. */
  simRatingScorerMax: number;

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

  // ── Blooding prospects (v1.92) ──
  // Selection ranks on current ability, so a prospect never out-rates the
  // veteran ahead of him; development needs minutes, so he never improves. The
  // squad ages in place. See `rotationMultiplier` in lib/rotation.ts. Applies
  // only in matches where rotation is already cheap.
  /** Oldest a player may be to count as a prospect for blooding. */
  youthBloodingMaxAge: number;
  /** Growth headroom he needs before a club bothers — this is about players with
   * a future, not about being young. */
  youthBloodingMinHeadroom: number;
  /** Headroom at which the boost is at full strength. */
  youthBloodingFullHeadroom: number;
  /** Selection boost at full headroom. Deliberately modest: enough to win a
   * close call in a cup tie, never enough to hand over the shirt. */
  youthBloodingSelectionWeight: number;

  // Fitness
  fitnessDrainPerMatch: number; // full 90 at age 27
  fitnessDrainAgeFactor: number; // extra drain per year over 30
  fitnessRecoveryPerDay: number;
  /**
   * Recovery multiplier for a goalkeeper (v1.99).
   *
   * A keeper covers a fraction of the ground an outfielder does and takes
   * almost none of the contact, so he is fresh again far sooner — and unlike
   * every other position he is expected to start every match of a congested
   * week. Keyed on the PRIMARY position, the same field every other
   * position-dependent rule reads.
   *
   * This is a RECOVERY term, deliberately not a drain one: a keeper should
   * still tire over ninety minutes exactly as he always did, he should just be
   * ready again quicker. The two are different quantities and collapsing them
   * would silently change what a match costs him.
   */
  gkFitnessRecoveryMult: number;
  minFitnessToStart: number; // AI won't start players below this


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
  growthEliteCurve: number;
  /** Headroom (potential − overall) at which elite resistance is eased by the
   * full `growthHeadroomReliefMax` (v1.92). Below it the relief scales down. */
  growthHeadroomFullRelief: number;
  /** Share of the elite-resistance PENALTY waived for a player with full
   * headroom. The curve is keyed on current overall alone and so cannot tell a
   * future superstar from a journeyman at his ceiling; without this an elite
   * successor is arithmetically impossible. See `eliteResistMult`. */
  growthHeadroomReliefMax: number; // >1 pushes the damping toward the top of the band
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
  /** Age at which an ORDINARY prime season starts costing a little (v1.92).
   * Before this a player holds his level exactly as v1.52 intended; after it he
   * drifts down, ramping to `latePrimeDriftMax` at decline onset. Without this a
   * player held his PEAK rating from 27 to 35 and no prospect could ever
   * displace him — see `developPlayer`. */
  latePrimeAge: number;
  /** Overall an ordinary season costs at the top of the ramp (just before
   * decline onset). Small: this is a fade, not a fall. */
  latePrimeDriftMax: number;
  /** Age at which EARNED prime growth has tapered to nothing (v2.1).
   *
   * The prime branch's gain path had no age term at all: `primeGrowthPerSeasonMax
   * × perf × minutes × facilities × elite-resist` reads exactly the same for a
   * 33-year-old as for a 27-year-old. Measured over ten seasons
   * (`npx tsx scripts/measure-veteran.ts`), that made the whole 24–33 band a
   * PLATEAU rather than a curve — mean gain +0.2/season flat across ten years,
   * with a 33-year-old as likely to improve as a 26-year-old (12.7% vs 13.3%)
   * and nothing turning negative until 35.
   *
   * The taper runs from `growthEndAge` to here, so a 27-year-old is untouched
   * and improvement fades out smoothly as decline approaches instead of
   * stopping at a cliff. Set at/below `growthEndAge` it disables the taper
   * entirely, which is the pre-v2.1 behaviour. */
  primeGrowthTaperEndAge: number;
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
  /** Days unattached before a DECLINING player may retire rather than go on
   * waiting for a club (v1.92). Age retirement only bites at `retirementAgeMin`,
   * so nothing otherwise removes a faded pro the market has passed over. */
  retireUnattachedDays: number;
  /** Chance he does so, once eligible — a roll, so the tail leaves gradually. */
  retireUnattachedChance: number;
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
  /** Max lift from the STANDING of the division a candidate played in (v1.87),
   * scaled linearly by `leagueReputation()` over [0, LEAGUE_REP_MAX].
   *
   * This is the only award term that compares one league against another, and
   * it exists for the two save-wide legacy honours: their pool is every top
   * division in the world, so without it a 7.6 average in a weak first tier
   * outranks a 7.4 in the strongest league on earth. A league's honours are
   * unaffected — every candidate there shares the same reputation, so the lift
   * is a constant that cancels out of an in-league comparison.
   *
   * Deliberately the largest of the four weights: it is worth ~1.4 rating points
   * across the full 0–10 span, which is the gap the legacy awards were missing,
   * and still small enough that a genuinely outstanding season in a mid-table
   * league beats an ordinary one at a giant. */
  awardLeagueRepWeight: number;

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

  /**
   * What a backroom wage costs by the DIVISION the club plays in (v1.89), indexed
   * by tier − 1 exactly like `weeklyIncomeByTier`.
   *
   * Every staff and scout wage in the game was a flat number keyed on stars
   * alone, while club income runs roughly 38:1 from the top flight to the fourth
   * tier. A 5-star coach therefore cost £110k/week whether he worked for a club
   * earning £950k a week or one earning £25k — which made the whole backroom
   * unaffordable below the top division and priced a promoted side out of the
   * facilities system it had just unlocked.
   *
   * The ladder is deliberately much SHALLOWER than the income one (2.6:1 against
   * 38:1). A good coach is a good coach anywhere and the market for him is
   * global, so a fourth-tier club should find him a stretch, not a rounding
   * error — this closes most of the gap without making the lower leagues a place
   * where elite staff are cheap. Applied to `staffWageFor` and `scoutWage`, and
   * to the fees that go with them, so the hiring screen and the wage bill agree.
   */
  staffWageByTier: number[];

  // Sponsors / investments (v6, Club → Income). Weekly income from season-long
  // deals; quality scales with club reputation, division, and Club
  // Marketability — a 0–100 score built from what the club has actually done.
  sponsorBaseWeeklyByReputation: number; // weekly £ per reputation point, shirt-scaled
  sponsorSlotShare: Record<string, number>; // per-slot fraction of the shirt baseline
  sponsorTierMults: number[]; // offer tier multipliers (Regional/National/Global)

  /** ── What a major sponsorship is worth per season (v1.86) ──
   *
   * The ANNUAL value of a front-of-shirt deal (slot share 1.0) at a National
   * suitor, read straight off the 0–100 marketability score: `Min` at 0, `Max`
   * at 100, interpolated on `Curve`. Every other figure on the page is this one
   * scaled — by the slot's share, by the tier roll, and by the term length.
   *
   * This replaced a stack of multipliers (reputation × slot share × division
   * ladder × tier × marketability band × noise) whose product nobody could
   * predict and which double-counted the division: the division ladder was
   * applied here AND is 32% of the marketability score the same sum multiplies
   * by. A single band with the division inside marketability says the same thing
   * once, and — the point of the rework — the headline number is now legible
   * from the tuning file: a maxed club is quoted `Max` a season for its shirt.
   */
  sponsorMajorAnnualMin: number;
  sponsorMajorAnnualMax: number;
  /** Exponent on the 0–1 marketability position between Min and Max. Above 1
   * the curve is back-loaded: the last twenty points of marketability are worth
   * far more than the first twenty, which is what keeps a mid-table top-flight
   * club from being quoted near-elite money for turning up. */
  sponsorMajorAnnualCurve: number;

  /** ── Club Marketability, the 0–100 score (v1.86) ──
   *
   * Six factors, each producing a 0–1 SCORE that is then multiplied by its
   * weight. The v44 model gave each factor a points budget and let it earn
   * points directly out of band tables, which meant a factor's weight and its
   * internal scale were the same number — re-weighting anything meant re-cutting
   * every band in it. Scores and weights are now separate: the band tables below
   * are all normalised 0–1, and `marketabilityWeights` alone decides what each
   * one is worth. Re-balancing is a one-line change.
   *
   * The weights sum to 100 with Europe included. A club with no European
   * football has that factor RENORMALISED away rather than scored zero — see
   * `lib/marketability.ts` for why (a first-season club would otherwise be
   * capped at 80 through no fault of its own, and could never reach the top
   * money band).
   */

  /** Each factor's share of the 0–100 score. Keys are `MarketabilityFactorKey`.
   * These are the only numbers that decide what a factor is worth; everything
   * else in this block is a normalised 0–1 curve. */
  marketabilityWeights: Record<string, number>;

  /** A. League Division. Score by the league's own 0–10 reputation
   * (`config/leaguerep.ts`), index 0 = reputation 0. This is the division's
   * standing in the world game, not the club's tier number, so a top flight in a
   * major nation and a top flight in a small one are correctly worth different
   * money. */
  marketabilityLeagueRepScore: number[];

  /** B. League Position. Score by finishing rank as a FRACTION of the division
   * (0 = champion, 1 = bottom): `[maxFraction, score]`, read low to high — the
   * first band whose fraction is not exceeded wins. A fraction rather than an
   * absolute position so an 18-club league and a 24-club one read alike. */
  marketabilityPositionBands: [number, number][];

  /** C. Recent Team Form. Points over the club's last `…FormMatches` completed
   * matches (win/draw), scaled onto 0–1 against a full run of wins. An unbeaten
   * run of `…FormUnbeatenGames` or more adds `…FormUnbeatenBonus` on the same
   * 0–1 scale, before the clamp. */
  marketabilityFormMatches: number;
  marketabilityFormWin: number;
  marketabilityFormDraw: number;
  marketabilityFormUnbeatenGames: number;
  marketabilityFormUnbeatenBonus: number;

  /** D. Squad Star Power. Score by the mean overall of the club's top
   * `…StarPowerTopN` senior players: `[minAverage, score]`, read low to high. */
  marketabilityStarPowerBands: [number, number][];
  marketabilityStarPowerTopN: number;

  /** E. Club Facilities. Scored as total levels held across every facility in
   * `FACILITY_SPECS` over the total available — one point per upgrade, so four
   * five-level facilities read as n/20 and adding a fifth facility moves the
   * denominator on its own (v1.86). Linear, deliberately: a band table here
   * would make the last upgrade in a band worth nothing. */

  /** F. European Cup Performance. Score by how far the club got, keyed by
   * `EuroStage`, and scaled by the cup's own tier via
   * `marketabilityEuroTierMult` — winning the Conference League is not worth
   * what winning the Champions League is. `qualified` covers a club that is in a
   * cup this season but has not yet been eliminated or won it. */
  marketabilityEuroStageScore: Record<string, number>;
  /** Multiplier on the stage score by cup tier, index 0 = Champions League. */
  marketabilityEuroTierMult: number[];

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

  // The academy and scouting BASELINES — what a club that has not built the
  // Youth Academy / Scouting Network facility runs on (v1.82). Everything above
  // these baselines is produced by those two facilities and lives in
  // `config/facilities.ts`, not here.
  //
  // The per-level ladders that used to sit alongside them (scoutNetworkMaxLevel,
  // academySquadMaxLevel/SizePerLevel, focusSlotMaxLevel, scoutSpeed*,
  // scoutFilter*, youthPr*, and all seven UpgradeCost arrays) are deleted: the
  // upgrade tracks they priced no longer exist, and a tuning number nothing
  // reads is the trap this file's own header warns about.
  scoutNetworkBase: number; // scouts employable with no Scouting Network built
  academySquadSizeBase: number; // prospects the academy holds with no facility built

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

  // ── Club reputation drift (v1.92) ──
  // `Team.reputation` was stamped by worldgen and frozen forever, so winning the
  // league changed nothing about who would sign for you. It now drifts once a
  // season toward what the club has become. See lib/reputation.ts.
  /** How the three pieces of evidence are weighted. Squad is the largest because
   * it is the one a target can see for himself; standing is what makes winning
   * the division mean something to the market. */
  repWeights: { squad: number; league: number; standing: number };
  /** The squad-overall band stretched across the 0–100 reputation scale. Squad
   * overalls cluster in a narrow range, so using them raw would make the term
   * say nothing. */
  repSquadFloor: number;
  repSquadCeil: number;
  /** Share of the gap to the target a club closes in one season, and the hard
   * cap on how far it may move. Both bind — the rate makes a distant target
   * approach smoothly, the cap stops one freak season relocating a club. */
  repDriftRate: number;
  repDriftMaxPerSeason: number;

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
  /**
   * Urgency added per formation slot the club has NO natural body for (v1.89).
   *
   * A missing position and a weak one are different problems, and the ordinary
   * shortfall arithmetic conflates them: a side with no centre-back but a
   * full-back filling in scores as a few rating points short, which sits below
   * half a dozen "could be better here" positions. Large enough to outrank any
   * ordinary shortfall (the whole rating span of a squad is ~25 points), so a
   * genuinely absent position is always what the club shops for first.
   */
  aiMissingCoverUrgency: number;
  /**
   * How much better an alternative tactic must score before an AI club switches
   * to it (v1.90), as a fraction of its current tactic's score.
   *
   * The hysteresis on `reviewClubTactics`, and the whole reason a club reads as
   * having an identity. The squad-fit search is run over a few dozen
   * formation×style combinations and the winner is often better by a fraction of
   * a percent on noise alone; without a threshold every club re-picks its shape
   * every season and none of them is ever *building* toward anything. At 4% a
   * club changes when its personnel have genuinely moved on from the system, and
   * otherwise signs players to deepen the system it has.
   */
  aiTacticSwitchGain: number;
  /**
   * Appearances for the club, above which a player counts as an established
   * first-teamer his club is reluctant to sell (v1.90).
   *
   * Roughly two full seasons. Below it a player is squad furniture and ordinary
   * stance rules apply; at or above it he is somebody the supporters know, and
   * `saleCandidates` will only let him go under the conditions in
   * `aiKeyPlayerSellChance`.
   */
  aiKeyPlayerApps: number;
  /**
   * Chance per window that a club will even CONSIDER selling one of its key
   * players — an established first-teamer (see `aiKeyPlayerApps`) who is also
   * among its best (v1.90).
   *
   * Not a ban: a club that never sells its stars is as unrealistic as one that
   * sells them for nothing, and a hard block would freeze the top of the market
   * entirely. At 12% a genuine marquee transfer is a thing that happens a couple
   * of times a season across a division rather than every window, and the user
   * can no longer strip an AI club of its best XI over two seasons.
   *
   * Deterministic per club, per season, per player — derived from the world seed,
   * so a save reloaded makes the same clubs willing to deal and the answer can't
   * be re-rolled by retrying a bid.
   */
  aiKeyPlayerSellChance: number;
  /**
   * How many of its best players a club treats as key (v1.90), among those who
   * also clear `aiKeyPlayerApps`.
   *
   * Six is about the spine of a side — the players a supporter would name — and
   * leaves the rest of the XI tradeable, so the market stays busy. Raising it
   * toward 11 progressively freezes AI squads; the transfer volume tuning
   * assumes it stays well below that.
   */
  aiKeyPlayerCount: number;
  /**
   * Spare natural bodies a club keeps per position, over what its formation
   * asks for, before it will sell anyone who plays there (v1.89).
   *
   * The floor that stops a rebuilding club selling its last centre-back. At 1 a
   * side playing two centre-backs keeps three before it sells one — enough for
   * an injury or a suspension, which is the point of a squad. Raising it makes
   * the AI market noticeably quieter; the transfer volume tuning above assumes
   * this stays small.
   */
  aiMinSpareCover: number;
  /**
   * Floor on the age-band multiplier when a candidate fills a position the club
   * has NO natural body for (v1.89).
   *
   * `aiAgeBandFalloff` compounds hard — a 30-year-old is worth a few percent to a
   * rebuilding club — which is right for shopping preferences and wrong for an
   * emergency: a side with no centre-back needs one at any age. This floors the
   * preference so a gap-filler stays a live target, without disabling the age
   * band (a young one still scores higher).
   */
  aiGapFillMinAgeFit: number;
  /**
   * Squad size every AI club is topped back up to at the rollover (v1.89).
   *
   * Sits above `matchdaySquad` (the legal minimum) deliberately: a club at
   * exactly the minimum is one retirement from being unable to name a bench, and
   * the top-up only runs once a season. The slack is what absorbs a season of
   * ordinary attrition. Measured: without this pass the median playable squad
   * fell from 28 to 19 across 20 seasons, because every AI buy path is
   * discretionary and nothing ever obliged a club to replace what it lost.
   */
  aiSquadFloor: number;
  aiAgeBandFalloff: number; // interest multiplier per year outside the stance age band
  aiMaxBudgetSharePerDeal: number; // most of its budget a club commits to one player
  // Market volume.
  aiDealsPerWeek: number; // base AI↔AI deals attempted each week a window is open
  aiFreeAgentSignChance: number; // chance an acting club with no target signs a free agent
  aiRenewChance: number; // chance per window an AI club renews a final-year first-teamer
  aiWindowDealsPerLeague: number; // AI↔AI deals each playable division attempts when a window opens (v1.51)
  freeAgentPoolFloor: number; // free agents the AI leaves unsigned, so the user's tab is never empty (v1.51)
  /** Unattached players `replenishFreeAgents` restocks the market up to (v1.89).
   * Distinct from `freeAgentPoolFloor`, which is where routine AI signings stop:
   * a restock target equal to the brake leaves the pool pinned at the point
   * business ceases, so this sits well above it. */
  freeAgentPoolTarget: number;
  /**
   * ── Free-agent replenishment (v1.89) ──
   * `replenishFreeAgents` in lib/worldgen.ts, run once per season rollover.
   *
   * The world only ever lost players: retirement takes everyone, but a regen is
   * born only from a retiree who peaked at `regenMinPeakOverall` or better, so
   * the whole tail below that bar was a net loss every season. Twelve seasons in,
   * playable-league bodies per formation slot had fallen to x1.32 at centre-back
   * against x8 at winger, and clubs that could not buy one could not find one
   * free either.
   */
  /** Living bodies per formation slot the world tops a position up TO. Below
   * this a position is short and gets free agents; at or above it, nothing is
   * generated however small the pool. Set near the low end of the healthy range
   * the world generates at, so this is a floor and not a target the market
   * drifts up to. */
  freeAgentTargetCoverRatio: number;
  /** Hard cap on bodies created in one rollover, so no future change to the
   * shortfall arithmetic can flood a save. */
  freeAgentReplenishMax: number;
  /** [min, max] overall band. Journeymen — this is a source of bodies, not of
   * talent; quality stays the academy's and the regens' business. */
  freeAgentReplenishOverall: [number, number];
  /** [min, max] age band. Squad-filler age: old enough to be unattached without
   * it reading as a wasted prospect. */
  freeAgentReplenishAge: [number, number];

  /**
   * ── Youth intake: the world's age structure (v1.92) ──
   *
   * The v1.89 replenishment counts BODIES and nothing else, and it generates
   * them at 23–32 — squad-filler age. That holds the headcount flat while the
   * age pyramid inverts underneath it, which is the real cause of "squads
   * degrade after ten seasons". Measured over 15 seasons: the 18–21 cohort fell
   * 545 → 119 and the 22–25 cohort fell 712 → **27**, while 34+ climbed 23 → 871
   * and the whole world's mean age went 23.7 → 31.5. The population count looked
   * healthy the entire time. Every club was simply fielding the same generation,
   * one year older each season, until it retired together and took the top of
   * the game with it (85+ players peaked at 130 in season 11 and halved by 16).
   *
   * `replenishYouth` fixes the SHAPE rather than the size: each season the world
   * generates enough teenagers to hold the young cohort at a target share of the
   * population, so there is always a generation coming through behind the one
   * currently playing. This is the structural counterpart to the regen system —
   * regens replace the individually great, this replaces the pyramid.
   */
  /** Age band new intake is generated in. Genuinely young: these players are
   * meant to spend years developing before they replace anyone. */
  youthIntakeAge: [number, number];
  /** Share of the world's living players that should sit under
   * `youthIntakeCohortMaxAge`. Below it, the shortfall is generated. */
  youthIntakeCohortShare: number;
  /** The age that defines the "young cohort" the share above is measured over. */
  youthIntakeCohortMaxAge: number;
  /** [min, max] overall band for intake. A raw teenager: what he BECOMES is
   * `youthIntakePotential`'s business, and the development curve's. */
  youthIntakeOverall: [number, number];
  /** [min, max] potential band. Deliberately wide and reaching the elite band at
   * the top: a generation with no future world-class players in it produces
   * exactly the shortage of them this system exists to prevent. The elite tail
   * is rare by the roll, not by the cap. */
  youthIntakePotential: [number, number];
  /** Share of intake rolled with the elite potential band rather than the
   * ordinary one — the rate at which the world mints future stars. */
  youthIntakeEliteShare: number;
  /** [min, max] potential for that elite slice. */
  youthIntakeElitePotential: [number, number];
  /** Hard cap on intake per season, so no future change to the share arithmetic
   * can flood a save. */
  youthIntakeMax: number;
  /** Share of the prospects already sitting unsigned that counts against this
   * season's shortfall. Below 1 deliberately: crediting them all lets a
   * saturated market switch intake off entirely, which reproduces the decay a
   * few seasons later once the backlog ages out. See `replenishYouth`. */
  youthIntakeMarketCredit: number;

  /**
   * ── AI youth recruitment (v1.92) ──
   * `aiRecruitYouth` in lib/transfers.ts. Generating a generation is useless if
   * nobody signs it: development is driven by MINUTES, so an unsigned prospect
   * never develops and ages out of the young cohort having become nothing. Every
   * existing buy path scores a signing as an upgrade, which a 16-year-old never
   * is — so clubs need a separate, explicitly potential-driven pass.
   */
  /** Oldest a free agent may be to be recruited as a prospect. */
  aiYouthRecruitMaxAge: number;
  /** Growth headroom (potential − overall) a prospect needs to be worth a slot.
   * This, not age alone, is what separates a prospect from a journeyman. */
  aiYouthRecruitMinHeadroom: number;
  /** Young players a club will carry before it stops recruiting more. Counted
   * over the squad, so a club that has already invested in a crop waits for it
   * to come through rather than hoarding indefinitely. */
  aiYouthProspectsHeld: number;
  /** Potential points deducted per year of age when ranking prospects, so an
   * equal ceiling further away is preferred — but not without limit. */
  aiYouthRecruitAgeDiscount: number;
  /** Chance a youth signing is reported in the news ticker. Low: forty clubs
   * doing this every summer would bury the transfers the manager cares about. */
  aiYouthRecruitNewsChance: number;
  /** Squad size beyond which a club takes on no more youth, however promising.
   * Deliberately NOT `squadCap` (50, which almost never binds): gating on the
   * cap let clubs hoard until the median squad reached 44. A club with a full
   * book needs to play the prospects it has, not sign more. */
  aiYouthSquadCeiling: number;

  // ── Ageing out of an AI club's plans (v1.92) ──
  // Every expiring AI contract used to be renewed unconditionally, so no club
  // ever declined to re-sign anybody and veterans accumulated on club books
  // until they retired at 36–39. See `aiLetsExpire` in lib/contracts.ts.
  /** Age from which an AI club may simply let a deal run out. */
  aiExpireAge: number;
  /** Players (by overall) a club protects whatever their age — a veteran still
   * among the club's best is not surplus. */
  aiExpireProtectBest: number;
  /** Chance an eligible ageing player is allowed to leave. A roll, not a rule,
   * so clubs keep some veterans and a division doesn't shed its over-33s all in
   * the same summer. */
  aiExpireChance: number;
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
  /**
   * How many substitutes a side names (v1.99).
   *
   * Was `matchdaySquad - 11` at six sites, which conflated two different
   * questions: `matchdaySquad` is also read as a squad-size FLOOR (a club at or
   * below it may not sell — contracts.ts, transfers.ts), so widening the bench
   * by deriving it from that number would also have told every AI club in the
   * world to hoard two more players. They are stated separately now, and
   * `benchCap()` is the one accessor everything reads.
   */
  benchSize: number;
  /**
   * Share of a club's displayed overall that comes from its starting XI, the
   * rest coming from the matchday bench (v1.90). See `squadOverall` in
   * lib/selection.ts.
   *
   * 0.8 because most league minutes are played by the eleven, but a side with
   * nothing behind it should still read as weaker than one with real cover — at
   * this weight a bench ten points off the XI costs the club two points of
   * overall, which is visible without swamping the first-team rating.
   */
  squadOverallXIWeight: number;

  // Sim leagues (§4)
  simTableNoise: number; // sd of strength noise in synthetic tables

  // ── Youth Academy (§18) ──
  academyMaxAge: number; // last age a player may spend in the academy (age-out at +1)
  academyPromoteMinAge: number; // youngest age a prospect may be promoted to the senior team
  // Weekly running cost per LEVEL of the Youth Academy facility (v1.82 — the
  // level now lives in `team.facilities`, and the build/upgrade prices with it
  // in config/facilities.ts, which is why the old academyUpgradeCost ladder and
  // its academyMaxLevel cap are gone from here).
  academyUpkeepPerLevel: number;
  // Academy player wages (v25; re-based on the tier ladder in v1.85). Prospects
  // are on youth terms — a small weekly scholarship, not a professional contract.
  //
  // The scholarship is priced off the prospect's BADGE rather than his current
  // overall. A 15-year-old Legacy find and a 15-year-old Bronze have almost the
  // same overall today and wildly different futures, so an overall-scaled wage
  // charged the same for both and quietly made the rarest prospects the cheapest
  // thing in the game to hoard. The badge is the club's own read on what a kid is
  // worth, which is the number a wage should follow.
  academyWageByTier: Record<ProspectTier, number>; // weekly, per prospect
  // What it costs to sign a scouted prospect into the academy (v1.85), by badge.
  // Youth signings used to be free, which made a scout's shortlist a list of
  // things to take rather than a list of things to choose between. The scouting
  // pipeline still undercuts the transfer market heavily — this is a fraction of
  // what an equivalent senior player costs — but it is no longer nothing.
  prospectSignFeeByTier: Record<ProspectTier, number>;
  /**
   * What a QUICK SELL pays, as a fraction of the best offer on the table (v1.87).
   *
   * A quick sell is the academy's disposal route: the prospect leaves the world
   * entirely rather than joining the buying club. That is the point of it —
   * releasing a prospect into a real club's squad means a rival is handed a
   * player they never chose and never valued, and doing it in bulk is a way to
   * quietly seed the world with your own castoffs. Deleting him instead keeps
   * the disposal a purely private decision.
   *
   * The discount is what it costs to have that convenience. A normal sale still
   * pays full price, so anyone willing to pick a suitor and place the player
   * properly is always better off; the quick sell is for a squad list you want
   * shorter, not for a squad list you want monetised.
   */
  quickSellShareOfBestOffer: number;

  // Prospect generation. The annual intake day these were written for is gone
  // (v1.89) — what remains reads them is `seedInitialAcademy`, the starting crop
  // a new save opens with. The class-size pair is dead weight kept only so an
  // old save's tuning still parses.
  /** Prospects a new save's academy opens with (v2.1). Was `u21RegistrationSize
   * + 2` — a legal U21 seven plus cover — and is stated directly now that the
   * competition it was sized for is gone. */
  academySeedSize: number;
  intakeClassBase: number; // dead since v1.89 (was: class size at level 0)
  intakeClassPerLevel: number; // dead since v1.89
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

  // Youth minutes + focus prospects. The U21 league these were named for is
  // gone (v2.1, pending a rework); the names are kept because renaming a tuning
  // key is churn that reaches every save, and what they DO is unchanged — a
  // youth minute is still worth less than a senior one (it now only ever weights
  // LOAN minutes), and a focus prospect still gets the coaching staff's
  // attention.
  u21MinutesWeight: number; // youth minute worth vs a senior minute (development)
  u21FocusBase: number; // focus slots with no Youth Academy built (v1.82)
  u21FocusMax: number; // absolute cap on focus slots, whatever the facility says
  u21FocusGrowthBonus: number; // extra growth multiplier for focus prospects
  /**
   * ── The academy is a better place to be YOUNG (v1.93) ──
   *
   * A 16-year-old in the academy develops faster than the same 16-year-old
   * carried in the senior squad, and the edge fades to nothing as he approaches
   * the age he must be promoted at. That is what makes the academy a genuine
   * pathway rather than a waiting room: before this, the only reason to keep a
   * prospect in it was the squad cap, so the optimal play was to promote every
   * good teenager immediately and the academy screen described a formality.
   *
   * It is deliberately an AGE curve, not a flat bonus. A flat one would say
   * "the academy is simply better", which makes promoting anybody a mistake and
   * turns `academyMaxAge` into a punishment. Ramped down to zero instead, the
   * decision the manager actually faces is a timing one — hold him another year
   * for the coaching, or promote him for the senior minutes that drive
   * everything else — and both answers are live at different ages.
   *
   * `academyYouthGrowthBonus` is the bonus at (or below) `academyYouthPeakAge`;
   * it decays linearly to 0 at `academyMaxAge`, so a prospect at the age-out
   * boundary gains nothing from staying and the ramp joins the senior curve
   * smoothly rather than as a cliff.
   *
   * It multiplies into the same `extraGrowth` term the loan/U21/focus bonuses
   * use, so it stacks with them exactly as every other academy lever does and
   * needs no new channel in `developPlayer`.
   */
  academyYouthGrowthBonus: number;
  academyYouthPeakAge: number;

  // ── Archetype retraining (v1.93) ──
  //
  // The Development → Archetype page. A class development center at level 5 can
  // put a player through a programme that reshapes his ATTRIBUTES toward a
  // target archetype while holding his overall — see lib/archetypedev.ts.
  /** Seasons a programme takes with no staff speed-up. The brief's "2 years". */
  archetypeConvertSeasons: number;
  /** Programmes ONE center may run at once. The brief's "1 player at a time at
   * base"; it is per center, so a club with all four built can retrain four
   * players — one into each class — rather than one player in total. */
  archetypeConvertSlots: number;
  /**
   * How much of the gap to the target shape a programme closes per season, as a
   * fraction, before the final season snaps the rest.
   *
   * Deliberately partial. A programme that did nothing until it completed would
   * make a two-season commitment invisible for two seasons — the player would
   * read exactly as he did before, and the manager would have no way to tell it
   * was working. Reshaping a share each summer means his attributes visibly
   * drift toward the role, and his derived archetype flips when it genuinely
   * earns it, which is the same rule every other identity change in the game
   * follows.
   */
  archetypeConvertProgressShare: number;

  // ── Dynamic rivalries (v1.94) ──
  //
  // A rivalry is FORMED by the save's own history (lib/rivalry.ts) and then pays
  // out on the fixtures it produces. Two halves, and they are tuned against
  // different things: the formation numbers decide how often a rivalry happens
  // at all, and the payout numbers decide what one is worth when it does.
  /** Consecutive seasons two clubs must BOTH finish inside
   * `rivalryTitleRaceTop` to be declared rivals. Three is the brief's own
   * number and it is doing real work: two is a coincidence in a division where
   * the same six clubs share the top places, three is a pattern. */
  rivalryTitleRaceSeasons: number;
  /** The finishing places that count as "in the title race". */
  rivalryTitleRaceTop: number;
  /**
   * Multiplier on the Performance Bonus and Stadium Bonus upgrade tracks in a
   * rivalry fixture. The brief asks for "massive", and 3× is what that means
   * here: it is the difference between a bonus track being background income
   * and a derby being the week the club's finances turn on.
   *
   * It multiplies the UPGRADE tracks specifically, not the gate or the TV money
   * — so it rewards a manager who invested in those tracks rather than handing
   * out flat cash, and a club that bought neither gets exactly nothing extra.
   * That is deliberate: the rivalry makes an existing investment pay, which is
   * a decision, where flat cash would be a windfall.
   */
  rivalryMatchBonusMult: number;
  /** How many one-off minor sponsorships a rivalry week attracts. */
  rivalryOfferCount: number;
  /** Multiplier on a rivalry one-off's weekly value over an ordinary minor.
   * These are single-season deals bought at a premium for the association, so
   * they are worth carrying even against a better ordinary offer. */
  rivalryOfferAmountMult: number;
  /** Days before the fixture that the rivalry sponsors come to the table, and
   * how long they stay. Short on purpose — the whole point is that it is THAT
   * week's money, not a permanent uplift. */
  rivalryOfferLeadDays: number;
  /** Seasons without meeting after which a rivalry goes dormant and stops
   * paying. A club relegated three divisions is no longer your rival, and a
   * rivalry that pays forever on a fixture that never happens is just a
   * permanent income boost with a story attached. */
  rivalryDormantSeasons: number;
  /** The most rivalries one save may carry at once. A manager with eleven
   * rivals has none — the word has to keep meaning something, and the payouts
   * are large enough that an uncapped list would become the main income line. */
  rivalryMaxActive: number;
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
   * Both are inclusive [min, max] ranges, clamped to potentialAbsoluteCap.
   *
   * v1.90: `overall` here is now only a FALLBACK, used when a prospect is rolled
   * at an age outside the academy band (`prospectOverallByAge` covers 13–17).
   * The live path reads the age table — see `prospectTierQualityAt` in
   * lib/scouts.ts. `potential` is still the single source for the ceiling: a
   * tier's ceiling is what the tier MEANS, and it must not vary with the age the
   * kid happened to be found at. */
  prospectTierBands: Record<ProspectTier, { overall: [number, number]; potential: [number, number] }>;

  /**
   * Ability band per tier and per age (v1.90), indexed
   * `[tier][age - prospectOverallByAgeMin]`.
   *
   * A 13-year-old Gold and a 17-year-old Gold share a ceiling but not a current
   * rating — four years of development separate them. Before this the tier
   * carried ONE overall band and `generatePlayer`'s maturity curve was left to
   * scale it down, which made the age effect implicit, unauditable, and
   * impossible to state as a design decision. The table says it outright.
   *
   * Rows must cover `prospectOverallByAgeMin`..`Max` inclusive. A tier or age
   * the table doesn't author falls back to `prospectTierBands[tier].overall`,
   * so a future age-band change can never leave a prospect unrollable.
   */
  prospectOverallByAge: Partial<Record<ProspectTier, [number, number][]>>;
  /** First age `prospectOverallByAge` rows are indexed from. */
  prospectOverallByAgeMin: number;
  /**
   * Slack allowed either side of a rolled band (v1.90), in overall/potential
   * points.
   *
   * The bands above are the design intent; this is the wobble that stops every
   * Gold 15-year-old in a save reading as the same player. Applied AFTER the
   * band roll and clamped so it can never cross `potentialAbsoluteCap` — so a
   * Legacy prospect can come in a shade under his band, and a Bronze one a shade
   * over, without either tier losing its identity.
   */
  prospectBandSlack: number;
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

  /**
   * What it costs to put a scout on the road (v1.85), by how far from home the
   * brief sends him.
   *
   * Sending a scout used to be free — the only cost was his weekly wage, which he
   * drew whether he travelled or not — so there was never a reason to point a
   * brief anywhere but Worldwide. Distance now has a price, in two parts: a
   * one-off `upfront` when the brief is issued (flights, visas, getting set up)
   * and a `weekly` retainer for as long as he is out there. A fixed-duration trip
   * bills the whole retainer at send time, so the total is knowable before the
   * manager commits; an open-ended brief bills the retainer weekly instead.
   *
   * The four bands are relative to the country the manager MANAGES in, not to the
   * scout's own nationality — it is the club paying, and the club is where the
   * trip starts from. `scoutTravelBandFor` in lib/scouts.ts resolves a target to a
   * band off SCOUT_WORLD, so a new country in that tree prices itself.
   */
  scoutTripCost: Record<ScoutTravelBand, { upfront: number; weekly: number }>;
  /** Weeks a scouting "month" bills as (v1.85). The assignment duration picker is
   * in months, and the retainer is quoted weekly, so a month bills as this many
   * weeks of it. */
  scoutTripWeeksPerMonth: number;

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
  /** A ring-fenced club may still trade players with the rest of the network,
   * provided both ends sit in the same country and neither is the manager's own
   * club (v1.88). The arm's-length rule that matters is that the MANAGER's squad
   * never mixes with a club inside his own pyramid; two ring-fenced holdings
   * dealing with each other is ordinary domestic business. */
  gcnAllowDomesticNetworkTransfers: boolean;
  /** A transfer between two network clubs in the same country is paid at this
   * fraction of the player's market value, buying club → selling club (v1.88).
   * A free move inside one pyramid is what the ring fence exists to prevent; a
   * priced one leaves both balance sheets honest. Cross-border moves inside the
   * network stay free — no domestic rival is affected by them. */
  gcnDomesticTransferPriceFactor: number;

  // ── GCN club finances (v1.88) ──
  // An owned club in a SIM league used to book nothing at all: weeklyEconomyTick
  // skips sim leagues, and the network's own tick paid it only GCN Deals plus any
  // standing order. So the Finance panel read £0 in and £0 out on a club with a
  // real squad on real wages, and "fund this club" had nothing to fund against.
  // The club now keeps abstracted books of its own — one income line and one
  // wage line, both derived from what it actually is.
  /** Fraction of the ordinary weekly income lines (TV, gate, commercial) a
   * sim-league club books. Below 1 because a sim league's commercial ceiling is
   * lower than the playable pyramid's, and because these clubs pay no facility
   * upkeep or staff wages. */
  gcnSimIncomeFactor: number;
  /**
   * How hard a sim club's income scales with its REPUTATION (v1.88).
   *
   * Necessary, not cosmetic. Every income line the economy exposes is read at
   * the club's TIER, and every sim league in the world is tier 1 — so before
   * this, a rep-91 giant and a rep-50 also-ran booked within 26% of each other
   * while their wage bills differed FIVEFOLD. Measured across 64 sim clubs that
   * put 38% of them in the red, and it was precisely the big clubs — the assets
   * an empire is built on — losing £1.5M a week while minnows turned a profit.
   *
   * The multiplier is `(rep / gcnSimIncomeRepPivot) ^ gcnSimIncomeRepPower`: a
   * club at the pivot is unchanged, above it earns more, below it less. The
   * power is what sets how steeply commercial pull outruns reputation.
   */
  gcnSimIncomeRepPivot: number;
  gcnSimIncomeRepPower: number;
  /** Fraction of its squad wage bill a sim-league owned club actually pays each
   * week. The full bill would bankrupt a club the network has just stocked with
   * good players, which is the opposite of what owning it should mean. */
  gcnSimWageFactor: number;

  // ── Global Executives (v1.95) ─────────────────────────────────────────────
  // Three seats, each driving exactly one network-wide channel. The scaling
  // mirrors the club facility system on purpose — a base for holding the seat at
  // all, a per-star term, and a per-badge-tier term — because it is the same
  // idea ("who is in the job, and how long have they been in it") at network
  // scale, and one vocabulary is worth more than a bespoke curve here.
  //
  // Every effect below is a PERCENT. The split between the stars term and the
  // badge term is the design's load-bearing part: an executive you hire today at
  // 5 stars gets most of the way, and the last stretch is only available to one
  // you KEEP. That is what makes a ten-season appointment a bet worth taking,
  // and it is asserted by `verify:gcn`.
  /** Effect for holding the seat at all, before stars or badges. */
  gcnExecBaseEffect: Record<GcnExecRole, number>;
  /** Effect per star (1–5), so a 5-star hire is worth 5× this. */
  gcnExecStarEffect: Record<GcnExecRole, number>;
  /** Effect per single badge tier held in the seat (bronze 1 … legacy 6). */
  gcnExecBadgeEffect: Record<GcnExecRole, number>;
  /** Seasons served for each badge tier — the executive's own ladder. Kept
   * separate from the club staff ladder because an executive serves the NETWORK
   * and there is only one seat: the tiers have to be reachable inside one
   * career, which the facility ladder (10 seasons at one building, competing
   * with two other badge slots) is not designed for. */
  gcnExecBadgeSeasons: number[];
  /** Weekly wage of a 1-star executive, and what each further star adds. Paid
   * from the treasury, never a club budget. */
  gcnExecWageBase: number;
  gcnExecWagePerStar: number;
  /** What a badge tier the candidate ARRIVES with adds to their weekly wage.
   * Pedigree is bought, not given. */
  gcnExecWagePerBadgeTier: number;
  /** One-off signing fee as a multiple of the weekly wage. */
  gcnExecFeeWeeks: number;
  /** How many candidates the shortlist holds per seat. Small on purpose: this is
   * an elite market, not a job board. */
  gcnExecMarketPerRole: number;
  /** Star distribution on the executive market, as cumulative weights from 1★ up.
   * Weighted toward the middle — a 5-star director is a genuine find. */
  gcnExecMarketStarWeights: number[];
  /** Chance a candidate arrives carrying a badge at all, and the ceiling on what
   * that badge may be. As with club staff, the top of the ladder is only ever
   * EARNED: an executive who has served a legacy term is not on the market. */
  gcnExecBadgeHireChance: number;
  gcnExecBadgeHireMaxSeasons: number;

  // ── International Scouting Hubs (v1.95) ───────────────────────────────────
  // The end-game counterpart to club scouting. A hub is a BUILDING in one
  // SCOUT_WORLD sub-region: bought once, upgraded by level, and thereafter
  // filing reports continuously without a scout being sent anywhere.
  //
  // The whole point is that it out-finds the club academy, so the tier roll is
  // biased upward by level rather than by a scout's judgement. What it costs is
  // the treasury and the wait.
  /** Cost to establish a hub, by the region's own difficulty band. A region the
   * network already has a club in is cheaper — see `gcnHubPresenceDiscount`. */
  gcnHubBuildCost: number;
  /** Per-level upgrade costs after the build, index 0 = level 1 → 2. */
  gcnHubUpgradeCost: number[];
  gcnHubMaxLevel: number;
  /** Weekly running cost per hub level, billed to the treasury. A hub is an
   * ongoing commitment, not a one-off purchase — an empire of half-staffed hubs
   * should hurt. */
  gcnHubUpkeepPerLevel: number;
  /** Discount on the build cost when the network already owns a club in that
   * region's country. Local presence is the thing that makes a hub cheap to
   * open, and it is the one rule tying the two halves of the network together. */
  gcnHubPresenceDiscount: number;
  /** Days between report batches at level 1, and what each further level cuts. */
  gcnHubReportDays: number;
  gcnHubReportDaysPerLevel: number;
  /** How many prospects one batch may contain, at level 1 and per level above. */
  gcnHubBatchBase: number;
  gcnHubBatchPerLevel: number;
  /** The hub's tier roll (v1.95). A hub rolls on the same prospect ladder the
   * club academy does, but the roll is shifted UP by its level — that shift is
   * the whole reason to build one. Expressed as an effective judgement so the
   * roll goes through `rollProspectTier`, the one function that decides a tier:
   * a second tier-rolling routine here would be a second answer to one question.
   *
   * `base` is what a level-1 hub rolls at, and it deliberately equals a good
   * club scout's judgement rather than beating it — a hub's edge at level 1 is
   * VOLUME and continuity, and quality is what the levels buy. */
  gcnHubJudgementBase: number;
  gcnHubJudgementPerLevel: number;
  /** Signing fee multiplier on a hub find, applied to the ordinary
   * `prospectSignFeeByTier` price. Above 1: the network pays a premium for
   * getting there first, which is what stops a hub being a cheaper academy. */
  gcnHubSignFeeFactor: number;
  /** Days a hub report stays live before the trail goes cold. */
  gcnHubReportExpiryDays: number;
  /** Age band a hub finds in. The same 13–17 band the club academy scouts, so
   * the two pipelines are comparable and neither is quietly finding a different
   * kind of player. */
  gcnHubProspectAgeMin: number;
  gcnHubProspectAgeMax: number;
  /** How many prospects a hub may hold on its books at once, per level. Full,
   * the hub keeps scouting but nothing more can be signed until a prospect is
   * placed at a club, promoted, or released. */
  gcnHubCapacityPerLevel: number;
  /** Growth multiplier a prospect gets for developing AT a hub, at level 1 and
   * per level above. This is the "you can develop them here" half of the feature
   * and the reason to leave a prospect in place rather than move him at once.
   *
   * It sits ABOVE the club academy's own multiplier deliberately: a hub is the
   * end-game version, and it costs a treasury to build where an academy comes
   * free with the club. */
  gcnHubGrowthBase: number;
  gcnHubGrowthPerLevel: number;
  /** Weekly wage per hub prospect, billed to the treasury. Flat rather than
   * badge-scaled (the academy's own wages are badge-scaled): at hub scale the
   * decision is how many to carry, not which. */
  gcnHubProspectWage: number;
  /** Age at which a hub prospect must be placed, promoted or released — the same
   * age the club academy ages out at, so a prospect's clock doesn't change
   * meaning depending on which pipeline found him. */
  gcnHubMaxAge: number;
  /**
   * How often a hub's brief is HONOURED per named criterion (v1.99).
   *
   * Deliberately not 1. A focus is an instruction to a scouting network, and a
   * network reports what it finds — at 1.0 the brief stops being a bias and
   * becomes a player generator, which would make "Brazilian / CB / Anchor" a
   * way to mint the exact prospect you wanted every batch. At 0.7 a focused hub
   * is obviously working (a batch of six returns ~4 on brief) while still
   * turning up the winger nobody asked for, which is the half of scouting worth
   * keeping. Each criterion rolls independently, so a fully-specified brief is
   * satisfied outright about a third of the time. */
  gcnHubFocusHitChance: number;

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
  // v1.73: trimmed from 1.74 when archetype classes landed. The attacking classes
  // are the most common in a generated world and add chance volume, which pushed
  // the calibration harness from 2.76 to 2.84 goals/match; this pulls the base
  // rate back so the target holds with the new system switched on.
  // v1.91: re-cut together so squad quality actually decides a season. The old
  // set hit the goals/home targets but had almost no dynamic range left: the
  // best side in a division (85 overall) beat the worst (70) by only 1.51-0.77,
  // and over 40 simulated seasons finish-vs-squad-overall correlated just 0.54,
  // with champions averaging the 2.5th-best squad. That is how a newly promoted
  // 67-rated side wins a league of 70+ clubs.
  //
  // The root defect was `chanceQualityCenter`. Its own comment says it is "the
  // ATTACK/(ATTACK+DEFENSE) value of two equal teams", but it was set to 0.385
  // when two equal sides produce q = 0.5 — the attack and defense columns of
  // PHASE_WEIGHTS sum to ~5.4 and ~5.15, so an even match sits at a half. The
  // squash was centred below the match it was meant to centre on, which left an
  // even game already 78% up the curve with 0.07 of headroom to `goalProbCeil`.
  // Superiority had nowhere to go, so every gap compressed into the same result.
  //
  // Recentring on 0.5 costs scoring (an even match no longer sits near the
  // ceiling), so the ceiling and chance rate rise to pay for it. `homeAdvantage`
  // comes down because a sharper engine amplifies it too — left at 1.07 it
  // pushed home wins to ~50%. `midfieldSharpness` moves only 2.2 → 3.0: it
  // compounds a strength edge into chance VOLUME, and the sweep showed the knee
  // is early — 9.0 doubled discrimination but blew champion points out to 106
  // and collapsed draws, which is a different kind of wrong season.
  //
  // Measured over 40 full 38-game seasons (`npm run verify:standings`):
  // correlation 0.54 → 0.65, champion points 81 → 89, draws 24.4% → 25.3%,
  // 2.62 goals/match, and the champion is now the 2.3rd-best squad rather than
  // a mid-table one. Re-run `npm run calibrate` AND `npm run verify:standings`
  // after touching any of these six — the two answer different questions and a
  // change that holds goals/match can still wreck a table.
  baseChancesPerSegment: 2.05,
  goalProbFloor: 0.085,
  goalProbCeil: 0.54,
  chanceQualitySlope: 12.0,
  midfieldSharpness: 3.0,
  chanceQualityCenter: 0.5,
  homeAdvantage: 1.04,
  // v2.1: 0.2 → 0.16, and `instructionFitSwing` 0.06 → 0.05, alongside
  // `ROLE_BRIEF_SWING` 0.08 → 0.06. The three of them are the LOOKUP half of
  // player identity — a manager reads `CLASS_STYLE_ROW`, fields the class it
  // rewards, and the answer never changes again. Compounded they were a ~±30%
  // band on effective rating, which is more than most transfer decisions are
  // worth and is what made the game have a recipe. Softening them is what makes
  // archetypes FORGIVING: a Sniper asked to play a possession game is still a
  // worse idea than a Metronome, no longer a disqualifying one.
  //
  // The counterpart is `lib/familiarity.ts`, which pays a side for CONTINUITY —
  // something a save earns rather than looks up.
  //
  // ── How far these could be cut, and why not further (MEASURED) ────────────
  //
  // The first cut halved all three (0.1 / 0.04 / 0.04) and FAILED
  // `verify:standings`: the champion averaged the 4.7th-best squad against a
  // ceiling of 4. Correlation actually IMPROVED (0.632 → 0.695) — the table
  // still tracked quality, but titles stopped going to the best sides, because
  // compressing the largest identity channel narrows the spread between clubs
  // and lets noise decide more seasons.
  //
  // The instinct to blame familiarity for that was wrong, and A/B measurement is
  // what showed it: setting `FAMILIARITY_SWING` to 0 reproduced the failure
  // BYTE-IDENTICALLY. `verify:standings` drives `simulateMatch` directly and
  // never calls `applyMatchResult`, so no club in it ever accrues familiarity —
  // every side sits at the centre reading exactly 1.
  //
  // That is not a flaw in the harness; it is the honest statement of the trade.
  // Familiarity only separates clubs that DIFFER in how settled they are, and in
  // a steady-state division they largely do not. So it cannot substitute
  // one-for-one for a channel that separated them by squad composition — the
  // headroom it reclaims is real for a manager who rebuilds or churns systems,
  // and near-zero across a division of clubs that all keep theirs.
  //
  // 0.12 then passed `verify:standings` (rho 0.668, champion the 3.5th-best
  // squad) and FAILED `verify:reputation`, which is the harness that catches
  // this properly: it stacks one club's squad and asserts it wins its division
  // at least once in eight seasons. At 0.12 it finished 2nd, 2nd, then collapsed
  // to 7th/13th/18th — a side built to dominate sliding to the bottom of the
  // table, which is the same compression stated far more starkly than a mean
  // champion rank ever states it. Two harnesses, two different sensitivities:
  // `verify:standings` asks whether the table tracks quality ACROSS a division,
  // `verify:reputation` asks whether a genuinely superior squad can WIN.
  //
  // 0.16 is the landing point — a 20% cut, with margin on both (champion rank
  // 3.30, one title). 0.14 also passes both but sits exactly on
  // `verify:standings`'s champion-rank ceiling of 4.00, which is too tight to
  // ship. **Run `verify:standings` AND `verify:reputation` before cutting these
  // further** — `calibrate` is unmoved by all of it and structurally cannot see
  // either failure.
  synergyCap: 0.16,
  instructionFitSwing: 0.05,
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
  // v2.1: pace vs a high line. `paceExploitPivot` is MEASURED, not chosen — it
  // is the attack-weighted mean `paceReliance` across the 30 archetypes with a
  // real attacking phase weight (0.524; the span is 0.25 for a Conductor to 0.90
  // for a Bullet). Centred there, an ordinary attack multiplies by exactly 1, so
  // this cannot lift the world's scoring and `calibrate` is unmoved.
  //
  // The swing is large because what it multiplies is small: a high line's own
  // `lineOppChanceMult` term is 1.08, so `exposedBy` is 0.08 and the effect at
  // the extremes is ±0.08 × 2.5 × 0.38 ≈ ±7.6% of chance VOLUME against a high
  // line, and exactly nothing against a deep block. Re-run `calibrate` if either
  // moves — it is chance volume, which is the thing that harness measures.
  paceExploitPivot: 0.524,
  paceExploitSwing: 2.5,
  // v2.2: the chance-type system's one dial. Sized so a strongly-shaped defence
  // (two Towers and a Shield against a crossing side) moves that type's
  // conversion by roughly a fifth, while an ordinary back line moves it by
  // exactly nothing — the pivot in `lib/chancetypes.ts` guarantees the second
  // by construction, which is what keeps `calibrate` on target.
  chanceTypeSwing: 0.55,
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

  // Match ratings (v2.0). `ratingFormWeight` is the headline: it is what turns
  // a flat 6.5 for everyone who didn't score into a spread wide enough for a
  // season average to mean something. See the interface for what each term is.
  ratingBase: 6.27,
  ratingPerGoal: 1.0,
  ratingPerAssist: 0.55,
  ratingPerGoalDiff: 0.11,
  ratingCleanSheet: 0.45,
  ratingPerConcededDef: 0.16,
  ratingFormWeight: 4.2,
  ratingPerOverallEdge: 0.075,
  ratingNoiseSd: 0.42,
  ratingSubDamping: 0.75,
  ratingMin: 4,
  ratingMax: 10,
  simRatingPerOverall: 0.035,
  simRatingFinishSwing: 0.5,
  simRatingNoiseSd: 0.16,
  simRatingScorerMax: 1.2,

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
  // 23 and 6 points of headroom: a genuine prospect rather than a finished
  // squad player. 0.25 at full headroom is worth ~4 rating points to a 70-rated
  // prospect, which wins him a cup start over an equal veteran without ever
  // displacing a materially better player.
  youthBloodingMaxAge: 23,
  youthBloodingMinHeadroom: 6,
  youthBloodingFullHeadroom: 18,
  youthBloodingSelectionWeight: 0.25,

  fitnessDrainPerMatch: 22,
  fitnessDrainAgeFactor: 0.8,
  fitnessRecoveryPerDay: 3.5,
  gkFitnessRecoveryMult: 1.5,
  minFitnessToStart: 55,


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
  // v1.92: 26 → 27. A footballer's peak is his late twenties, and the window has
  // to be long enough for a wonderkid to actually ARRIVE at his ceiling — see
  // `growthOldFalloffPerYear` below and `eliteResistMult`'s headroom relief.
  growthEndAge: 27,
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
  //
  // v1.92: 4.5 → 5.4 (+20%). Paired with the same +20% on
  // `primeGrowthPerSeasonMax` below, this is a deliberate world-wide lift to how
  // fast overall is earned. It exists to answer the long-save decay problem: the
  // supply of world-class players is set by how many prospects reach the elite
  // band before the retirement scythe takes the generation above them, and at
  // the old rate the two didn't balance — squads visibly thinned at the top over
  // ten seasons. These two constants are the headline budget every other growth
  // term multiplies into, so raising them lifts the whole distribution rather
  // than any one age band.
  //
  // v2.0: 5.4 → 8.1 (+50%), paired with the same +50% on
  // `primeGrowthPerSeasonMax`. The two are always moved together — see the note
  // on that constant for why lifting only one is the wrong shape.
  //
  // MEASURED, and the cost is real and should be known before this is moved
  // again. `measure:growth` over 8 seasons, regulars with headroom: mean career
  // gain 8.88 → 12.89, and the "ever-present with room to grow, gained ≤2"
  // case 8% → 1%. `calibrate` and `verify:standings` are both unmoved (2.61
  // goals/match, rho 0.652). What DOES move is the world's ceiling:
  // `measure:quality` over 15 seasons puts the 85+ population at 507 against a
  // baseline peak of 256, and the top flight's squad mean at 84.8 against 81.5.
  // The SHAPE of both curves is the same (rise, then decline as the cohort
  // ages), so this is a scale shift rather than a new failure mode — but the
  // world now grows roughly twice as many elite players as it did, which is the
  // price of every career being twice as rewarding. If that reads as too many
  // 90s, the lever is these two constants, not the elite-resistance curve.
  growthPerSeasonMax: 8.1,
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
  // 20 points of headroom is a genuine wonderkid, and 0.75 waives three quarters
  // of the brake for him. Worked through the full arc: a regen born at 54 with
  // 91 potential now reaches the high 80s inside his growth window instead of
  // topping out at 76.9 — he can actually succeed the player he was born from.
  // A player AT his ceiling has zero headroom and zero relief, so the curve's
  // real job (no 19-year-old 90s) is untouched.
  growthHeadroomFullRelief: 20,
  growthHeadroomReliefMax: 0.55,
  // Peaked age curve (v17). 17 is the breakout year at full strength; each year
  // below that costs 0.16 (so a 14-year-old sits at 1.0 − 0.48 → 0.52 of a
  // 17-year-old's rate) and each year above costs 0.09,
  // easing growth out toward growthEndAge instead of cutting it off.
  growthPeakAge: 17,
  growthPeakMult: 1.35,
  growthYoungFalloffPerYear: 0.16,
  // v1.92: 0.09 → 0.05. This, not the elite-resistance curve, was the binding
  // constraint on ever producing a new star: at 0.09 the age multiplier had
  // collapsed by 22, so a regen born with 91 potential peaked at 76.9 however
  // much headroom relief he was given. Swept across the growth window and the
  // falloff together, (28, 0.05) lands that same regen at ~84 — a genuine
  // successor — while an ordinary player with a 70 ceiling still stops at 70,
  // because headroom, not age, is what the brake reads.
  growthOldFalloffPerYear: 0.06,
  growthAgeMultFloor: 0.35,
  // v1.51: prime growth loosened so players over 24 visibly develop. The pivot
  // drops to 6.7 (a solid regular now improves, not only a standout), the per-
  // season ceiling rises, and prime players join the weekly in-season tick.
  // v1.92: 3.0 → 3.6 (+20%), in step with `growthPerSeasonMax`. Lifting only the
  // youth budget would push the world's growth even further into the age band
  // that takes longest to pay off — the opposite of what the long-save shortage
  // of finished players needs.
  // v2.0: 3.6 → 5.4 (+50%), in step with `growthPerSeasonMax` above.
  primeGrowthPerSeasonMax: 5.4,
  // 6.55 sits just under the median regular's rating (~6.65), so an ordinary
  // first-teamer having a normal season edges forward while a squad player who
  // rates below the median still stagnates. At the old 6.9 only ~12% of players
  // cleared the bar at all, which is why nobody over 24 appeared to develop.
  //
  // v2.0: 6.55 → 6.35. This is the constant that decides whether raising the
  // two headline budgets above actually reaches the player the raise was FOR,
  // and it had to be measured rather than reasoned about. The prime branch is a
  // CLIFF, not a curve: `primePerf > 0` is a hard gate, so a regular rating
  // 6.56 grows and one rating 6.54 gains exactly zero — and multiplying his
  // growth by 1.5× leaves zero exactly where it was. Measured over 8 seasons
  // (`npm run measure:growth`), that is where the reported symptom lived: the
  // 25–27 band gained +3.66 across eight ever-present seasons while carrying
  // 10.3 points of declared headroom, and the youth bands were healthy
  // throughout (+17.7 for the 16–18s) — so the defect was never the headline
  // budget, which is what a +50% on it alone would have been aimed at.
  //
  // Deliberately a small move, and NOT to zero. The gate is doing real work:
  // growth on merit is the whole design of this branch, and a pivot that every
  // squad player clears would hand the world a free point a season and undo
  // what v1.52 fixed. 6.35 is about a fifth of a rating point of slack — enough
  // that a solid regular having a normal campaign inches forward instead of
  // being told he is finished at 25.
  primeGrowthPerfPivot: 6.35,
  primeInSeasonShare: 0.45,
  // 0.25 in perf units ≈ 0.3 of a rating point below the 6.55 pivot, so anything
  // from ~6.25 up is treated as an ordinary season and costs nothing. Below that
  // he sheds at most 1.5 in a season — noticeable, recoverable next year.
  primeDeclineTolerance: 0.25,
  primeBadSeasonMaxLoss: 1.5,
  // 30, ramping to 1.2 by decline onset (~35). A 29-year-old is untouched, a
  // 31-year-old sheds a few tenths, and a 34-year-old about a point — enough
  // that a growing 21-year-old closes on him over three or four seasons, which
  // is exactly how a squad renews itself.
  latePrimeAge: 30,
  latePrimeDriftMax: 1.2,
  // 34 — earned growth is at full strength at 27 and gone by 34, which is where
  // the measured data says it should be: at 34 only 9.6% of regulars gained
  // anything at all even before this, so the taper is finishing a curve the
  // world was already implying rather than imposing a new rule. Deliberately
  // short of `declineOnsetAge` (35) so the two join smoothly — earned growth
  // reaches zero just as automatic decline takes over.
  primeGrowthTaperEndAge: 34,
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
  // v1.92: 36–39 → 34–38. The v1.52 band was set when an ordinary prime season
  // cost nothing and decline began at 35, which combined to keep a player at
  // PEAK ability from 27 until he retired — measured, the top flight's average
  // starter aged 25.3 → 33.4 over thirteen seasons and 135 of 220 starters were
  // 32 or older. With ~350 players a year reaching 34 and ~3.5 years of career
  // left apiece, the standing 34+ population settles near 1,225 whatever the
  // market does; the band itself is the only lever on that arithmetic. Widened
  // downward rather than narrowed, so a durable pro can still play to 38 and the
  // spread between the early- and late-retiring stays real.
  retirementAgeMin: 34,
  retirementAgeMax: 38,
  // A declining player nobody has signed for a year hangs them up (v1.92). Age
  // retirement only bites at 36+, so without this a faded pro sat unsigned in
  // the free-agent list for years, ageing and never playing: measured, the 34+
  // population grew 23 → 784 over eleven seasons even with the youth pyramid
  // healthy. 365 days is a full season passed over by every club in the world,
  // which is the market's own verdict rather than an arbitrary age.
  retireUnattachedDays: 365,
  retireUnattachedChance: 0.5,

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
  // League standing (v1.87). Worth 0.20 at a 10-reputation division and 0 at a
  // 0 — about 1.4 rating points across the span, which is the single biggest
  // award term because it is the only one asked to compare two different
  // leagues. It decides the legacy honours and cancels out of every in-league
  // one. Sized against the ~0.5-point spread that separates the best seasons in
  // a division: a genuinely exceptional campaign in a Strong league still beats
  // an ordinary one in a Major, but a merely-very-good one no longer does.
  awardLeagueRepWeight: 0.2,

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
  // Top flight pays the full rate; the fourth tier pays ~38% of it. See the
  // field comment for why this ladder is far flatter than the income one.
  staffWageByTier: [1.0, 0.72, 0.52, 0.38],
  marketRefreshDays: 10,

  // v44: rebased from 5,200. The old star model topped out at a ~1.88× money
  // multiplier; the new tier ladder tops out at 6.0×. Left alone, every elite
  // sponsorship would have tripled overnight — a rep-85 top-flight shirt deal
  // went from ~£200M to ~£647M in testing. 5,200 × 1.88 / 6.0 ≈ 1,630 puts the
  // TOP of the new ladder exactly where the top of the old one sat, so the
  // ladder became the spec's without the commercial economy moving.
  //
  // v1.85: doubled, 1,630 → 3,260. This is the base every investment offer is
  // built from — it sits BEFORE the slot share, the division ladder, the tier
  // roll, the marketability multiplier and the noise, so doubling it here is
  // exactly "every offer amount is worth twice what it was" and nothing else in
  // the commercial model has to move. Deliberately done at the base rather than
  // at any of the multipliers: a multiplier is a statement about a club's
  // standing, and inflating one would have changed what the Investments page's
  // own "offer multiplier" means.
  //
  // v1.86: this is now the MINOR (weekly partnership) baseline only. Majors are
  // priced by `sponsorMajorAnnual*` below, off marketability directly, because
  // the old chain quietly applied the division ladder twice — see that block.
  //
  // v1.91: cut 20%, 3_260 → 2_608. The MINOR half of "reduce the base value of
  // offers by 20%". Done at the base for the same reason v1.85 doubled it here:
  // it sits before the slot share, the division ladder, the tier roll, the
  // marketability multiplier and the noise, so this is exactly "every weekly
  // partnership is worth a fifth less" and nothing about what a club's standing
  // MEANS has changed.
  sponsorBaseWeeklyByReputation: 2_608,

  // A front-of-shirt deal, per season, at a National suitor. £20M at zero
  // marketability, £100M at a hundred: the owner's spec, and the arithmetic the
  // headline falls out of — a maxed club offered a 3-season shirt deal is quoted
  // 100M × 3 × 0.9775 ≈ £293M, and at a Global suitor (1.4×) up to ~£410M.
  //
  // The curve is 1.6 rather than linear because a straight line makes the middle
  // of the ladder far too rich: a 50-marketability club — mid-table top flight,
  // no Europe, average squad — would be quoted £60M/season, two thirds of what
  // an elite club gets for a fraction of the work. At 1.6 that same club is
  // quoted ~£46M, and the £100M ceiling stays something only a club that has
  // maxed genuinely everything, Europe included, ever sees.
  //
  // v1.91: both ends cut 20%, £20M/£100M → £16M/£80M. The MAJOR half of the same
  // change. Scaling both ends leaves the curve's SHAPE untouched — the band is
  // still "nothing special at zero, everything at a hundred", just a fifth
  // cheaper — so a maxed club's 3-season shirt deal now quotes ≈£235M rather
  // than ≈£293M and the mid-ladder club that was quoted ~£46M/season is quoted
  // ~£37M. Cutting only the max would have flattened the curve instead, which
  // is a different change: it would squeeze the gap between an ordinary club
  // and an elite one, and that gap is the whole point of the marketability
  // score.
  sponsorMajorAnnualMin: 16_000_000,
  sponsorMajorAnnualMax: 80_000_000,
  sponsorMajorAnnualCurve: 1.6,
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

  // ── Club Marketability (v1.86) ──
  //
  // Six factors. The weights are the owner's spec, with one change made on
  // measurement rather than taste: League Division was specified at 40, which
  // made the other five factors decorative — a top-flight club scored 40 before
  // kicking a ball and a fourth-division one could do everything else perfectly
  // and still be outbid by a top-flight side with an empty trophy room. At 32 it
  // is still comfortably the largest single factor (nothing else exceeds 20) and
  // still the thing that gates the top money band, but the remaining 68 is now
  // enough that running a club well is worth roughly what the division is.
  //
  // The 8 points came off Division and went to Facilities (10 → 14) and Position
  // (10 → 12): those are the two factors most directly bought with the manager's
  // own decisions, which is the behaviour the commercial game should reward.
  marketabilityWeights: {
    league: 32,
    europe: 20,
    starPower: 15,
    facilities: 14,
    position: 12,
    form: 7,
  },
  // A. League Division — by the league's 0–10 reputation. The owner's ladder
  // (10 → 100%, 9 → 80%, 8 → 60%, 7 → 45%, 6 → 30%) extended downward on the
  // same decaying curve, so the bottom of the world isn't a cliff to zero.
  //  rep:                        0     1     2    3     4    5     6    7     8    9  10
  marketabilityLeagueRepScore: [0, 0.03, 0.07, 0.12, 0.18, 0.24, 0.3, 0.45, 0.6, 0.8, 1.0],
  // B. League Position — as a fraction of the division, so league size doesn't
  // change what a finish is worth. Champion 1.0, top four ~0.8, mid-table ~0.3.
  marketabilityPositionBands: [
    [0.0, 1.0], // champions / leaders
    [0.1, 0.82], // top 10%
    [0.2, 0.62], // top fifth — European places in most divisions
    [0.35, 0.4],
    [0.5, 0.22], // upper half
    [0.75, 0.08],
    [1.0, 0.02], // relegation scrap; never quite zero — you're still in the division
  ],
  // C. Recent Team Form — ten matches at 3 for a win is 30 raw, scaled onto
  // 0–1; five unbeaten adds 0.15 before the clamp, so a good run maxes the
  // factor without needing ten straight wins.
  marketabilityFormMatches: 10,
  marketabilityFormWin: 3,
  marketabilityFormDraw: 1,
  marketabilityFormUnbeatenGames: 5,
  marketabilityFormUnbeatenBonus: 0.15,
  // D. Squad Star Power — mean of the three best senior players. Wider than the
  // v44 table: 85 used to be full marks, which meant every serious club sat at
  // the ceiling. 90+ is now what a genuinely global squad reads as.
  marketabilityStarPowerBands: [
    [0, 0.1],
    [65, 0.25],
    [70, 0.4],
    [75, 0.55],
    [80, 0.7],
    [85, 0.85],
    [90, 1.0],
  ],
  marketabilityStarPowerTopN: 3,
  // E. Club Facilities — no table: levels held / levels available, straight.
  // F. European Cup Performance — how far you got, times what the cup is worth.
  // `qualified` is the in-progress reading, so a club three matchdays into a
  // group isn't scored as though it had already gone out.
  marketabilityEuroStageScore: {
    qualified: 0.45,
    groupStage: 0.35,
    roundOf16: 0.55,
    quarterFinal: 0.7,
    semiFinal: 0.85,
    runnerUp: 0.93,
    champion: 1.0,
  },
  //                            UCL  UEL  UECL
  marketabilityEuroTierMult: [1.0, 0.7, 0.45],
  // What the score buys. Five bands over 0–100. `valueMult` no longer scales the
  // money — `marketabilityOfferAnnual` does that directly and continuously
  // (v1.86) — so this ladder is now only about how many suitors call and how
  // good the brands are. `valueMult` survives as the headline "offer multiplier"
  // the page quotes, and is kept honest by being the same curve: it is what the
  // annual band works out to, relative to its floor.
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

  // The unbuilt baselines (v1.82). Both are what a club runs on with no
  // facility; the Scouting Network takes scouts to 7 and the Youth Academy takes
  // the academy to 48, and those ceilings live in config/facilities.ts.
  //
  // 2 and 15 are the design brief's own base effects, restated here so the
  // "never built it" path and the facility's level-1 row agree by construction —
  // building the facility must not be what gives a club its first scout.
  scoutNetworkBase: 2,
  academySquadSizeBase: 15,

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

  // Club reputation drift (v1.92). Squad carries the most weight — a signing
  // target judges the teammates he'd have — with the division and last season's
  // finish behind it. Weights need not sum to 1; the blend normalises.
  repWeights: { squad: 0.5, league: 0.3, standing: 0.2 },
  // A squad overall of 55 is the bottom of the professional game and 88 is an
  // elite European side; stretched across 0–100, the term separates clubs that
  // the raw numbers (all in the 60s and 70s) would report as identical.
  repSquadFloor: 55,
  repSquadCeil: 88,
  // 25% of the gap per season, capped at 4 points. A club that wins its league
  // with a squad to match closes most of the distance in about five seasons and
  // moves ~3-4 points the summer it happens — enough that a title visibly opens
  // up the market next window, slow enough that reputation stays the game's
  // slowest-moving number. Reputation is built over careers, not campaigns.
  repDriftRate: 0.25,
  repDriftMaxPerSeason: 4,

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
  aiMissingCoverUrgency: 30,
  aiTacticSwitchGain: 0.04,
  aiKeyPlayerApps: 60,
  aiKeyPlayerSellChance: 0.12,
  aiKeyPlayerCount: 6,
  aiMinSpareCover: 1,
  aiGapFillMinAgeFit: 0.6,
  aiSquadFloor: 24,
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
  // The market's stocked inventory (v1.89), distinct from the brake above.
  // `freeAgentPoolFloor` is where routine AI signings STOP; this is what
  // `replenishFreeAgents` restocks TO, and it has to sit well above the brake or
  // the pool spends the season pinned at the point business stops. Sized so
  // forty clubs topping up at the rollover leave a browsable market behind.
  freeAgentPoolTarget: 90,
  // 2.5 bodies per slot. Swept over 20 seasons: at 2.0 the high-demand positions
  // (centre-back above all — 98 slots against a winger's 15) sit permanently on
  // the edge and squads still drift down toward the matchday minimum; 2.5 holds
  // squad sizes and positional cover flat for the length of a long save.
  freeAgentTargetCoverRatio: 2.5,
  // Sized against the measured shortfall (peaks ~45/season across the world) with
  // headroom, since `ensureAiSquads` now draws on this pool every rollover too.
  // A cap that binds turns a one-season dip into a permanent deficit.
  freeAgentReplenishMax: 120,
  freeAgentReplenishOverall: [48, 68],
  freeAgentReplenishAge: [23, 32],

  // Youth intake (v1.92). Worldgen seeds a world whose under-22s are ~33% of the
  // population (172 u18 + 545 aged 18–21 out of 2152 at kickoff); by season 10
  // that had fallen to 8%. 0.30 holds roughly the shape the world is BORN with,
  // which is the honest target: it is not a boost, it is the absence of the
  // decay. Measured against the same 15-season sweep that found the problem.
  youthIntakeAge: [16, 19],
  // 0.22, not 0.30. The share must be sized to what the world can EMPLOY, not to
  // the shape worldgen happens to start with. Development is driven by minutes,
  // so a prospect nobody signs grows 1.6 overall a season against 4.6 for one
  // playing regularly — measured, a tracked cohort with a mean potential of 80.8
  // gained 1.1 a season because 70% of them sat unsigned. Generating more
  // teenagers than clubs will sign does not replenish the world; it manufactures
  // a permanent underclass that never develops and drags every average down.
  youthIntakeCohortShare: 0.27,
  youthIntakeCohortMaxAge: 22,
  // A raw teenager. `overallIsAgeAdjusted` is NOT used here — the generator's
  // maturity curve is wanted, so a 16-year-old reads as unfinished.
  youthIntakeOverall: [46, 60],
  // Most of a generation are squad players and lower-league pros; the elite
  // slice below is what keeps the top of the game stocked a decade out.
  // Matched to the band worldgen itself seeds youth in (`youthPotentialFloor`
  // 72 → `youthPotentialBandTop` 92). This was [62, 80] with an 8% elite slice,
  // and that single mistuning was the deepest cause of long-save decay: every
  // generation the world minted was materially WORSE than the one it replaced,
  // so quality fell however well the intake, recruitment and ageing systems
  // worked. Measured at season 11 with the rest of the pipeline fixed, the best
  // under-23 in the entire world rated 74 against top-flight starters averaging
  // 79.6, and the top fifty prospects had a mean POTENTIAL of 75.9 — they could
  // not have replaced those starters even fully developed. An intake band below
  // the world's own is a slow dilution, not a replenishment.
  youthIntakePotential: [72, 88],
  youthIntakeEliteShare: 0.1,
  youthIntakeElitePotential: [88, 95],
  // ~150/season holds the cohort at a world of ~2200. Cap sized with headroom so
  // a save recovering from an inverted pyramid can catch up over a few seasons
  // rather than being pinned by the cap forever.
  youthIntakeMax: 260,
  // 0.75: a full market throttles intake hard without ever closing it. At 1.0
  // the pass stops dead while a backlog exists and the decay returns once that
  // backlog ages out; at 0 the world inflates by ~230 players a season.
  youthIntakeMarketCredit: 0.6,

  // AI youth recruitment. 21 is the age by which a prospect who was going to be
  // signed has been; 8 points of headroom excludes the journeymen
  // `replenishFreeAgents` mints (band [48,68] with little room above) while
  // admitting every genuine prospect. Six per club across ~500 clubs absorbs a
  // generation comfortably, and the count is measured over the squad so it is a
  // standing capacity rather than a per-window quota.
  aiYouthRecruitMaxAge: 21,
  aiYouthRecruitMinHeadroom: 8,
  // 10, not 6. This is an ABSORPTION capacity and has to be sized against the
  // intake, which is the thing that measuring showed: at 6 the world's clubs
  // offered 41 prospect slots between them at kickoff (squads already carry
  // ~6 developing players each) against ~150 new teenagers a season, so the
  // free-agent pool grew without limit and most of a generation never played.
  // At 10 a squad of ~27 carries a third of itself in developing players, which
  // is what a real academy-fed club looks like, and the pool clears.
  aiYouthProspectsHeld: 12,
  aiYouthRecruitAgeDiscount: 1.5,
  aiYouthRecruitNewsChance: 0.02,
  // 32: a first team, a full bench and a developing group behind them. Sits
  // above `aiSquadFloor` (24) with real room, and well under `squadCap` (50) so
  // youth recruitment can never be what pushes a club to its registration limit.
  aiYouthSquadCeiling: 32,

  // Ageing out. 33 is where a fringe player stops being part of a club's plans
  // while a good one is still first choice — which is why the top 14 (an XI plus
  // cover) are protected by ability regardless. 55% of the eligible each summer
  // clears the accumulated block over a couple of seasons without any division
  // visibly emptying at once.
  aiExpireAge: 33,
  aiExpireProtectBest: 14,
  aiExpireChance: 0.55,
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
  benchSize: 9,
  squadOverallXIWeight: 0.8,

  simTableNoise: 4.5,

  academyMaxAge: 21,
  academyPromoteMinAge: 16,
  academyUpkeepPerLevel: 20_000,
  // Youth scholarship wages: a raw ~50-overall kid earns £1k/wk, a senior-ready
  // ~72-overall prospect £5k/wk, scaled linearly between and clamped to the band.
  academyWageByTier: {
    bronze: 500,
    silver: 1_000,
    gold: 1_500,
    diamond: 2_000,
    obsidian: 3_000,
    legacy: 5_000,
    platinum: 2_000, // pre-v1.53 alias — priced as what it migrates to (diamond)
  },
  prospectSignFeeByTier: {
    bronze: 1_000_000,
    silver: 2_000_000,
    gold: 3_000_000,
    diamond: 5_000_000,
    obsidian: 7_000_000,
    legacy: 10_000_000,
    platinum: 5_000_000, // pre-v1.53 alias — priced as diamond
  },
  // 80%: enough of a haircut that placing a prospect properly is always the
  // better deal, small enough that clearing an academy place isn't a punishment.
  quickSellShareOfBestOffer: 0.8,

  // 9 — a legal U21 seven plus two spare, which is what this was before v2.1
  // deleted the competition it was sized against. Kept at the same number: the
  // crop was a reasonable academy to start with independently of why.
  academySeedSize: 9,
  intakeClassBase: 3,
  intakeClassPerLevel: 0.5,
  // v1.90: the academy intake band is 13–17, matching `prospectOverallByAge`.
  // A prospect enters at 13 at the earliest and is found no later than 17; he
  // may then stay until `academyMaxAge` (21), at the end of which he must be
  // promoted, sold or released.
  intakeAgeMin: 13,
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
  // v1.82: 3 unbuilt — the Youth Academy's own base effect, so the "never built
  // it" path and the facility's level-1 row agree. The cap sits above what the
  // facility can reach (8 at max), so it never silently clips the building.
  u21FocusBase: 3,
  u21FocusMax: 15,
  u21FocusGrowthBonus: 0.1,
  // +25% at 16 and below, decaying to 0 at academyMaxAge (21). Sized against
  // the lever beside it: bigger than focus (+10%),
  // because it is the one that should decide whether a prospect is in the
  // academy at all, and small enough that senior minutes — worth up to a 0.35 →
  // 1.0 swing on the whole growth stack in `developPlayer` — still beat it for
  // a prospect who would actually play. That is the intended tension: coaching
  // wins for a teenager who'd sit on a senior bench, minutes win for one ready
  // to start.
  academyYouthGrowthBonus: 0.25,
  academyYouthPeakAge: 16,

  archetypeConvertSeasons: 2,
  archetypeConvertSlots: 1,
  // 0.6 of the remaining gap each summer. Chosen so the FIRST season already
  // moves him most of the way (which is what makes the programme legible) while
  // leaving the completion genuinely worth waiting for.
  archetypeConvertProgressShare: 0.6,

  // Rivalries (v1.94). The brief's own numbers where it gave them (three
  // consecutive seasons, top three); the payout side is set so a derby is a
  // genuine event without becoming the club's business model — at 3× the
  // Performance and Stadium tracks, two league meetings a season is worth
  // roughly one extra home fixture's bonus income, plus whatever the one-off
  // sponsors are taken up.
  rivalryTitleRaceSeasons: 3,
  rivalryTitleRaceTop: 3,
  rivalryMatchBonusMult: 3,
  rivalryOfferCount: 2,
  rivalryOfferAmountMult: 2.5,
  rivalryOfferLeadDays: 7,
  rivalryDormantSeasons: 3,
  rivalryMaxActive: 4,
  scoutReportDaysBase: 40,
  scoutReportDaysPerStar: 5,
  // Must comfortably outlast the report cadence (40 − 5×stars, floor 10) or a
  // scout's earlier finds always go cold before the next batch lands and reports
  // can never accumulate on the board (v12).
  scoutReportExpiryDays: 45,
  scoutFeeMult: 1.3,
  // v1.90: pulled to the academy band (13–17) so a scouted find and an academy
  // prospect are priced off the same age table. A scout used to bring back
  // 18-year-olds, who fell outside `prospectOverallByAge` entirely and had to
  // use the fallback band.
  scoutProspectAgeMin: 13,
  scoutProspectAgeMax: 17,
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
    // v1.90: the potential ladder is now a clean, stated 5-point rung per tier —
    // bronze 65–70 through legacy 90+ — rather than the wide overlapping bands
    // it grew into. A tier's ceiling is the thing the badge PROMISES, so the
    // rungs no longer overlap: a Gold is never secretly a Diamond. The
    // `prospectBandSlack` wobble (±2) is what keeps two Golds from being the
    // same player, and it is applied on top of these.
    // `overall` here is the fallback for ages outside the academy band; the
    // 13–17 path reads `prospectOverallByAge` below.
    bronze: { overall: [45, 60], potential: [65, 70] },
    silver: { overall: [48, 63], potential: [70, 75] },
    gold: { overall: [48, 64], potential: [75, 80] },
    diamond: { overall: [52, 67], potential: [80, 85] },
    obsidian: { overall: [55, 70], potential: [85, 90] },
    // "90+" — the top rung is open-ended by design, capped only by
    // `potentialAbsoluteCap`. This is the once-a-career find.
    legacy: { overall: [60, 80], potential: [90, 95] },
    // Pre-v1.53 saves can still carry a `platinum` badge; it maps onto the
    // diamond band so a migrated prospect never falls through to bronze.
    platinum: { overall: [52, 67], potential: [80, 85] },
  },
  // Ability by tier and age, 13 → 17 (v1.90). Read left to right, each entry is
  // the [min, max] overall a prospect of that tier arrives with at that age.
  // Every ladder climbs ~3 points a year, and the tiers separate more at the top
  // than the bottom — a Legacy 17-year-old is already a senior squad player at
  // 75–80, a Bronze one is still a 57–60 kid.
  prospectOverallByAgeMin: 13,
  prospectOverallByAge: {
    //         13        14        15        16        17
    bronze:   [[45, 48], [48, 51], [51, 54], [54, 57], [57, 60]],
    silver:   [[48, 51], [51, 54], [54, 57], [57, 60], [60, 63]],
    gold:     [[48, 51], [52, 55], [55, 58], [58, 61], [61, 64]],
    diamond:  [[52, 55], [55, 58], [58, 61], [61, 64], [64, 67]],
    obsidian: [[55, 58], [58, 61], [61, 64], [64, 67], [67, 70]],
    legacy:   [[60, 65], [65, 70], [68, 72], [72, 77], [75, 80]],
    // Migrated pre-v1.53 badge, same rung as diamond (see prospectTierBands).
    platinum: [[52, 55], [55, 58], [58, 61], [61, 64], [64, 67]],
  },
  // ±2 either side of any rolled band. See the field comment.
  prospectBandSlack: 2,
  fogJudgementStarReduction: 0.09,
  scoutWageBase: 3_000,
  scoutWagePerStar: 1_600,
  scoutFeePerStar: 55_000,
  scoutMaxHireable: 10, // v1.68: scoutNetworkBase 3 + 7 upgrade levels

  scoutTripCost: {
    home: { upfront: 100_000, weekly: 50_000 },
    region: { upfront: 150_000, weekly: 50_000 },
    continent: { upfront: 200_000, weekly: 75_000 },
    overseas: { upfront: 250_000, weekly: 100_000 },
  },
  scoutTripWeeksPerMonth: 4,

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
  gcnAllowDomesticNetworkTransfers: true,
  gcnDomesticTransferPriceFactor: 1,
  // A sim club books 70% of the ordinary income lines and pays 80% of its wage
  // bill — a modest structural surplus, so a well-run network club grows rather
  // than needing a permanent standing order to stay alive.
  // Swept over 64 sim clubs (rep 50–91). At 0.85 / pivot 70 / power 2.4 only 2 of
  // the 64 run at a loss, and net RISES with reputation — +£297k/wk at rep 91,
  // +£142k at rep 65, +£57k at rep 50. That ordering is the point: a big club is
  // an asset the empire is built on and a small one is viable but thin, which is
  // the opposite of what the flat tier-keyed income lines produced on their own.
  gcnSimIncomeFactor: 0.85,
  gcnSimIncomeRepPivot: 70,
  gcnSimIncomeRepPower: 2.4,
  gcnSimWageFactor: 0.8,

  // ── Global Executives (v1.95) ──
  // Read the three rows together: the ceiling of each seat is
  // base + 5×star + 6×badge, and the split is what the design is about.
  //   football  — 3 + 5×1.4 + 6×1.5 = 19.0% at the absolute top, of which a
  //               brand-new 5-star hire can reach 10.0% and the other 9.0% is
  //               only ever earned by keeping someone for a decade.
  //   commerce  — 5 + 5×3.0 + 6×3.5 = 41.0% on the network's passive income.
  //               The biggest headline number, and it should be: it multiplies
  //               a track the manager already chose to buy, so it pays back an
  //               investment rather than handing out money.
  //   scouting  — 4 + 5×2.2 + 6×2.4 = 29.4% off hub costs and onto hub speed.
  // Football is the smallest because it touches EVERY player at EVERY owned club
  // and lands on the same effective-rating lever the tactics tables use — a
  // fifth of a rating point across an empire is already an enormous edge, and
  // anything larger makes buying clubs strictly better than managing one.
  gcnExecBaseEffect: { football: 3, commerce: 5, scouting: 4 },
  gcnExecStarEffect: { football: 1.4, commerce: 3.0, scouting: 2.2 },
  gcnExecBadgeEffect: { football: 1.5, commerce: 3.5, scouting: 2.4 },
  // 1/2/4/6/9/13 seasons → bronze…legacy. Deliberately reachable inside one
  // appointment (the club-staff ladder tops out at 10 seasons at ONE of three
  // badge slots, which is a different bet) but long enough that a legacy
  // executive is the mark of a save played out rather than a purchase.
  gcnExecBadgeSeasons: [1, 2, 4, 6, 9, 13],
  gcnExecWageBase: 40_000,
  gcnExecWagePerStar: 55_000,
  gcnExecWagePerBadgeTier: 30_000,
  gcnExecFeeWeeks: 26,
  gcnExecMarketPerRole: 4,
  // Cumulative weights for 1★…5★: 5% / 20% / 45% / 80% / 100%. A 5-star
  // candidate is a one-in-five sighting on a four-name shortlist.
  gcnExecMarketStarWeights: [0.05, 0.2, 0.45, 0.8, 1],
  gcnExecBadgeHireChance: 0.22,
  // Caps an arriving badge at gold (6 seasons on the ladder above). Diamond and
  // beyond are earned at YOUR network or not at all — the same rule the club
  // staff market follows, and for the same reason: a ladder you can buy the top
  // of is not a ladder.
  gcnExecBadgeHireMaxSeasons: 6,

  // ── International Scouting Hubs (v1.95) ──
  // Priced against the rest of the end game: a club costs £250M to found and the
  // unlock threshold is £5bn, so a hub at £180M is a real commitment that an
  // established network can make several of. The upkeep is what stops it being a
  // one-off purchase you forget about.
  gcnHubBuildCost: 180_000_000,
  gcnHubUpgradeCost: [120_000_000, 200_000_000, 320_000_000, 500_000_000],
  gcnHubMaxLevel: 5,
  gcnHubUpkeepPerLevel: 45_000,
  gcnHubPresenceDiscount: 0.25,
  // Level 1 files every ~24 days, level 5 every ~12 — roughly twice the cadence
  // of a good club scout at the top, on top of running in a region permanently
  // rather than for the length of a trip.
  gcnHubReportDays: 24,
  gcnHubReportDaysPerLevel: 3,
  gcnHubBatchBase: 2,
  gcnHubBatchPerLevel: 0.6,
  // Judgement 3.0 at level 1 (a solid club scout) rising to 5.4 at level 5 —
  // past anything hireable, which is the end-game promise. It is passed through
  // `rollProspectTier` like any other judgement, so the elite-tier rates stay
  // the single ladder the whole game rolls on.
  gcnHubJudgementBase: 3.0,
  gcnHubJudgementPerLevel: 0.6,
  gcnHubSignFeeFactor: 1.6,
  gcnHubReportExpiryDays: 30,
  gcnHubProspectAgeMin: 13,
  gcnHubProspectAgeMax: 17,
  gcnHubCapacityPerLevel: 6,
  // 1.35 at level 1 → 1.75 at level 5. The club academy's Youth Academy tops out
  // well below this, which is the point of an end-game building.
  gcnHubGrowthBase: 1.35,
  gcnHubGrowthPerLevel: 0.1,
  gcnHubProspectWage: 4_000,
  gcnHubMaxAge: 21,
  gcnHubFocusHitChance: 0.7,

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
