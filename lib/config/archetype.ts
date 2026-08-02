// ── Archetypes & classes (§5, v1.77) ──────────────────────────────────────
//
// An Archetype is the identity a player has EARNED, read off the attributes he
// actually has. It is a derived view — like `overall` and the six card faces —
// never a stored field, and it re-reads itself every time his attributes move.
// The loop the design asks for is:
//
//     Training Plan → Attributes → Archetype → Tactical effect
//
// ── v1.77: this is now the ONLY archetype system ──────────────────────────
// Until v1.77 there were two: a roster of 38 GENERATION-SEED archetypes assigned
// at birth (`config/archetypes.ts`, now deleted) and these 45 derived ones. That
// was a genuine design duplication — a player could be generated a "Poacher" and
// read as a "Sniper", and the UI had to show one and hide the other. The seed
// roster is gone; everything it supplied now hangs off the derived archetype:
//
//   attribute generation → the archetype's TRAINING PLAN weights (below)
//   style synergy        → the CLASS_STYLE_ROW table below
//   scorer/assist, pace, height, goal flavour → the per-class rows below
//
// The circularity that forced two systems apart is resolved by generating from
// the PLAN rather than from the archetype: worldgen picks a plan for the
// position, shapes the attribute line from its primary/secondary tiers, and the
// archetype the player then reads as is — by construction — the one that plan
// aims at. Generation and identity agree without either defining the other.
//
// ── The 1:1 plan mapping ──────────────────────────────────────────────────
// There are exactly 45 archetypes because there are exactly 45 training plans
// (9 position groups × 5). Each archetype names its plan, and assignment scores a
// player's attributes against that plan's own PRIMARY and SECONDARY lists. This
// is what makes the loop legible to a player: the plan you train IS the archetype
// you are aiming at, by name.
//
// Everything here is pure data. `deriveArchetype` is the only logic, and it reads
// the training table rather than duplicating it — nothing names an attribute.

import type { Attributes, DefLine, Focus, Pos, Press, Style, Tempo, Width } from "../types";
import { ATTR_KEYS, type AttrKey } from "./attributes";
import { fitAttrsToOverall, keyAttrsFor } from "./positions";
import {
  OTHER_SHARE,
  PRIMARY_SHARE,
  SECONDARY_SHARE,
  TRAINING_PLAN_MAP,
  defaultPlanFor,
  planPosOf,
  plansForPosition,
  type TrainingPlanDef,
} from "./training";

/**
 * The five classes an archetype belongs to (v1.75). A class is what the TACTICAL
 * engine reads — archetypes exist for identity and flavour, classes exist for
 * maths.
 *
 *   Creators  — passing, vision, control. Want time on the ball; hate chasing it.
 *   Engines   — stamina, pressing, box-to-box coverage. Wasted sitting deep.
 *   Enforcers — tackling, strength, aerial duels. Excel with the play in front
 *               of them; exposed by a high line.
 *   Blitzers  — direct running, lethal finishing, counter-attacking speed.
 *               Thrive in fast, chaotic attacks; go missing in a slow setup.
 *   Mavericks — technical flair and unpredictable movement. Break a game open
 *               off the cuff; blunted when told to play to a rigid pattern.
 *
 * The fifth class is the v1.75 split: the old Spearhead bundled two different
 * kinds of attacker — the one who runs straight at goal and the one who invents
 * something — into a single tactical row, so a side of nine forwards all wanted
 * the exact same instructions. Separating them gives squad-building an actual
 * choice between direct threat and improvisation.
 */
export type ArchetypeClass = "Creator" | "Engine" | "Enforcer" | "Blitzer" | "Maverick";

export const ARCHETYPE_CLASS_ORDER: ArchetypeClass[] = [
  "Creator",
  "Engine",
  "Enforcer",
  "Blitzer",
  "Maverick",
];

export const ARCHETYPE_CLASS_LABEL: Record<ArchetypeClass, string> = {
  Creator: "Creator",
  Engine: "Engine",
  Enforcer: "Enforcer",
  Blitzer: "Blitzer",
  Maverick: "Maverick",
};

/**
 * The colour each class is drawn in, everywhere it appears (v1.74).
 *
 * A class is the one player-facing thing the tactical engine actually reads, so
 * it earns a colour: once a manager learns that violet means Creator, a squad
 * list, a transfer row and the Tactics readout all become scannable at a glance
 * without reading a word. That only works if there is exactly ONE palette — a
 * second copy in a component would drift and teach the wrong association — so it
 * lives here beside the classes themselves, as pure data.
 *
 * Chosen to sit against the dark theme (#0b0c0f) at readable contrast while
 * staying clear of the gold accent, which is reserved for the active/important
 * thing and must not be confused with an identity.
 *
 * v1.76: these are now taken FROM the archetype artwork rather than chosen
 * independently. Every icon in `/public/archetype_icons` is drawn on a
 * class-coloured hex frame — Wall (Enforcer) green, Architect (Creator) blue,
 * Vanguard (Engine) red, Guardian (Maverick) yellow, General (Blitzer) violet —
 * and the old palette disagreed with the art on all five. Since the icon and the
 * label sit side by side on every surface, the art is the authority: a pill in
 * one colour beside a badge in another taught two contradictory associations at
 * once. Change these only alongside the PNGs.
 */
export const ARCHETYPE_CLASS_COLOR: Record<ArchetypeClass, string> = {
  Creator: "#4a90ff", // blue — vision and invention
  Engine: "#e8443c", // red — lungs and legs
  Enforcer: "#2fbe4a", // green — cold, defensive steel
  Blitzer: "#b04dff", // violet — the sharp end
  Maverick: "#f2e35c", // yellow — flair, and the risk that comes with it
};

/** One-line description of what a class does for a side, for the UI. */
export const ARCHETYPE_CLASS_BLURB: Record<ArchetypeClass, string> = {
  Creator: "Playmakers. Thrive with time on the ball; tire quickly when made to chase.",
  Engine: "Runners. The lungs of the side; restricted by a deep defensive line.",
  Enforcer: "Destroyers. Excel with the play in front of them; exposed by a high line.",
  Blitzer: "Attackers. Thrive in fast attacks; isolated by a slow, defensive setup.",
  Maverick: "Improvisers. Break open a packed defence; wasted on a rigid, direct plan.",
};

export interface Archetype {
  id: string;
  /** The earned name — "Architect", "Predator". A bare noun, no article: it is
   * a badge that sits beside a player's name, and "The" in front of every one of
   * 45 labels costs width in every list without adding information. */
  name: string;
  /** The training plan this archetype corresponds to, 1:1. */
  planId: string;
  cls: ArchetypeClass;
  /** One-line player-facing summary of the identity. */
  desc: string;
  /**
   * Two real footballers the role is recognisably named after (v1.85).
   *
   * A description tells a manager what a role does; a name he already knows tells
   * him what it *feels* like, in one glance and without reading a sentence. These
   * are illustrative only — nothing in the engine, worldgen or the generated name
   * pool reads them, and no generated player is ever one of these people. They
   * exist for the Tactics → Help roster and nothing else.
   */
  examples: [string, string];
}

/**
 * The artwork for an archetype, served from `/public/archetype_icons`.
 *
 * Derived from the name rather than stored per row: the icon files are named
 * exactly for the archetypes (`Architect.png`), so a hand-written path column
 * would be 45 chances to typo a filename that only fails at runtime, in the
 * browser, as a broken image. Deriving it means adding an archetype and dropping in
 * `<Name>.png` is all there is to it.
 *
 * The dev-mode assertion at the bottom of this file checks every name is a legal
 * filename; whether the PNG is actually present is checked by the UI, which
 * falls back to the class dot.
 */
export function archetypeIconSrc(archetype: Archetype): string {
  // Encoded because the check below permits a space in a name, and a raw space
  // in a URL is not a valid request.
  return `/archetype_icons/${encodeURIComponent(archetype.name)}.png`;
}

/**
 * The 45 archetypes, grouped by the position set whose plans they mirror (v1.75).
 *
 * Names and classes are the owner's roster, taken as given. Two things about it
 * are worth recording, because they look like mistakes and are not:
 *
 *  - The roster lists a position beside each name ("Razor | LW"). That is the
 *    role's SPIRITUAL home, not a constraint — the binding is to the training
 *    PLAN, and the plan's position set is what decides where the archetype can
 *    actually be earned. Several entries name a position their plan doesn't sit
 *    in (Dribbler is listed CM and is the CM ball-carrier; Acrobat is listed DM
 *    and is the DM press-resistance plan) and the plan wins in every case.
 *  - The split is exactly nine archetypes per class, which is deliberate and worth
 *    preserving: a class's SHARE of a generated world decides how easy its
 *    tactical bonus is to stack, so an even table is the neutral starting point
 *    that keeps every squad-building route viable. (Even so, the shipped split by
 *    world POPULATION won't be even — archetypes are earned from attributes, and
 *    some plans are far more common than others. `npm run calibrate` is the check
 *    on what that does to scoring.)
 *
 * `id` is stable across this rename: a saved player stores his archetype id, so
 * changing one would silently reset an established identity to "no incumbent"
 * and lose the hysteresis margin on every player in every save. The ids that
 * already matched the new names were kept as they were; the handful whose name
 * changed outright keep their OLD id with the new name (`iron_lung` → Lung,
 * `apex_predator` → Predator, and so on).
 */
export const ARCHETYPE_ROSTER: Archetype[] = [
  // ── Goalkeepers ──────────────────────────────────────────────────────────
  { id: "wall", name: "Wall", planId: "gk_shotstopper", cls: "Enforcer",
    desc: "Imposing shot stopper who forms a low-block shield in net against close-range efforts.",
    examples: ["Gianluigi Buffon", "Jan Oblak"] },
  { id: "vanguard", name: "Vanguard", planId: "gk_sweeper", cls: "Engine",
    desc: "Agile, high-line goalkeeper who aggressively sweeps up through-balls and protects high defensive lines.",
    examples: ["Alisson Becker", "Hugo Lloris"] },
  { id: "initiator", name: "Initiator", planId: "gk_distribution", cls: "Creator",
    desc: "Elite kicking and passing goalkeeper who launches rapid, long-range build-ups from the back.",
    examples: ["Ederson", "Manuel Neuer"] },
  { id: "general", name: "General", planId: "gk_command", cls: "Blitzer",
    desc: "Commanding goalkeeper who organises defensive structures and claims high balls inside the box.",
    examples: ["Peter Schmeichel", "Thibaut Courtois"] },
  { id: "guardian", name: "Guardian", planId: "gk_balanced", cls: "Maverick",
    desc: "Well-rounded goalkeeper providing consistent match-to-match reliability and steady fundamentals.",
    examples: ["Iker Casillas", "Marc-André ter Stegen"] },

  // ── Centre backs ─────────────────────────────────────────────────────────
  { id: "enforcer", name: "Stopper", planId: "cb_stopper", cls: "Enforcer",
    desc: "Physical bully centre back who dominates aerial and ground duels to intimidate attackers.",
    examples: ["Nemanja Vidić", "Jaap Stam"] },
  { id: "architect", name: "Architect", planId: "cb_ballplaying", cls: "Creator",
    desc: "Deep playmaker centre back who conducts team possession and dictates play from the defensive third.",
    examples: ["Franz Beckenbauer", "Mats Hummels"] },
  { id: "interceptor", name: "Interceptor", planId: "cb_cover", cls: "Enforcer",
    desc: "Intelligent defender who anticipates passes, cuts off channels, and cleans up counter-attacks.",
    examples: ["Paolo Maldini", "Raphaël Varane"] },
  { id: "tower", name: "Tower", planId: "cb_aerial", cls: "Enforcer",
    desc: "Imposing aerial presence who dominates the box and clears central crosses effortlessly.",
    examples: ["Virgil van Dijk", "John Terry"] },
  { id: "sentinel", name: "Sentinel", planId: "cb_balanced", cls: "Enforcer",
    desc: "Rock-solid defensive anchor stabilising deep defensive lines and low-block setups.",
    examples: ["Giorgio Chiellini", "Alessandro Nesta"] },

  // ── Full backs ───────────────────────────────────────────────────────────
  { id: "engine", name: "Motor", planId: "fb_wingback", cls: "Engine",
    desc: "Relentless overlapping fullback providing non-stop stamina and high-intensity wide width.",
    examples: ["Roberto Carlos", "Achraf Hakimi"] },
  { id: "anchor", name: "Anchor", planId: "fb_defensive", cls: "Enforcer",
    desc: "Lockdown fullback who shuts down opponent wingers in 1v1 isolation duels on the flank.",
    examples: ["Aaron Wan-Bissaka", "Lilian Thuram"] },
  { id: "constructor", name: "Constructor", planId: "fb_inverted", cls: "Creator",
    desc: "Tactical fullback who tucks into central midfield to create passing overloads and build-up control.",
    examples: ["Trent Alexander-Arnold", "João Cancelo"] },
  { id: "dynamo", name: "Dynamo", planId: "fb_athlete", cls: "Engine",
    desc: "Athletic fullback capable of sustaining continuous high-press intensity without collapsing physically.",
    examples: ["Kyle Walker", "Javier Zanetti"] },
  { id: "protector", name: "Protector", planId: "fb_balanced", cls: "Enforcer",
    desc: "Defensive-first fullback providing structural stability and reliable touchline protection.",
    examples: ["César Azpilicueta", "Philipp Lahm"] },

  // ── Defensive midfield ───────────────────────────────────────────────────
  { id: "destroyer", name: "Destroyer", planId: "dm_anchor", cls: "Enforcer",
    desc: "Aggressive midfield enforcer who physically breaks up opponent build-up play in central areas.",
    examples: ["Casemiro", "Gennaro Gattuso"] },
  { id: "metronome", name: "Metronome", planId: "dm_regista", cls: "Creator",
    desc: "Midfield anchor who dictates overall match tempo with calm, high-volume distribution.",
    examples: ["Andrea Pirlo", "Sergio Busquets"] },
  { id: "iron_lung", name: "Lung", planId: "dm_boxtobox", cls: "Engine",
    desc: "High-stamina defensive midfielder who sustains relentless pressing across the central third.",
    examples: ["N'Golo Kanté", "Edgar Davids"] },
  { id: "escapist", name: "Acrobat", planId: "dm_pressresist", cls: "Maverick",
    desc: "Agile, press-resistant midfielder capable of wiggling out of high-intensity opponent traps.",
    examples: ["Mousa Dembélé", "Thiago Alcântara"] },
  { id: "shield", name: "Shield", planId: "dm_balanced", cls: "Enforcer",
    desc: "Central screen protecting the backline by blocking direct central passing lanes.",
    examples: ["Rodri", "Claude Makélélé"] },

  // ── Central midfield ─────────────────────────────────────────────────────
  { id: "workhorse", name: "Workhorse", planId: "cm_boxtobox", cls: "Engine",
    desc: "Exhaustless central runner covering every blade of grass to connect defence directly to attack.",
    examples: ["Steven Gerrard", "Arturo Vidal"] },
  { id: "maestro", name: "Maestro", planId: "cm_metronome", cls: "Creator",
    desc: "Central orchestrator who maintains team possession and controls match rhythm under pressure.",
    examples: ["Xavi Hernández", "Toni Kroos"] },
  { id: "dribbler", name: "Dribbler", planId: "cm_carrier", cls: "Blitzer",
    desc: "Direct ball-carrier who bursts through defensive lines with aggressive central dribbling.",
    examples: ["Frenkie de Jong", "Mateo Kovačić"] },
  { id: "infiltrator", name: "Infiltrator", planId: "cm_mezzala", cls: "Blitzer",
    desc: "Half-space attacker who slices through narrow gaps between opponent fullbacks and centre-backs.",
    examples: ["İlkay Gündoğan", "Andrés Iniesta"] },
  // Turbine is the roster's one name with no plan of its own: it is listed as a
  // second "Balanced Center Back" alongside Sentinel, and CB balanced can only
  // be one archetype. The balanced CM is the one plan the roster leaves unnamed,
  // and Turbine's brief — high mobility, covering ground, Engine class — is the
  // box-to-box central role almost word for word, so the spare name and the
  // spare plan are paired here. That also keeps the icon folder exactly 1:1 with
  // the table, which the check at the bottom of this file enforces.
  { id: "engine_room", name: "Turbine", planId: "cm_balanced", cls: "Engine",
    desc: "High-mobility midfielder who covers vast ground across the middle to connect both boxes.",
    examples: ["Antonio Rüdiger", "Marquinhos"] },

  // ── Attacking midfield ───────────────────────────────────────────────────
  { id: "visionary", name: "Visionary", planId: "am_playmaker", cls: "Creator",
    desc: "Elite key passer who unlocks tight, low-block defences with thread-the-needle vision.",
    examples: ["Mesut Özil", "Kevin De Bruyne"] },
  { id: "phantom", name: "Phantom", planId: "am_shadowstriker", cls: "Blitzer",
    desc: "Ghostly attacker making late, undetected arriving runs directly into the penalty area.",
    examples: ["Thomas Müller", "Frank Lampard"] },
  { id: "marksman", name: "Marksman", planId: "am_sniper", cls: "Blitzer",
    desc: "Lethal long-range shooter capable of scoring from outside the penalty box on fast transitions.",
    examples: ["Wesley Sneijder", "James Rodríguez"] },
  { id: "illusionist", name: "Illusionist", planId: "am_agility", cls: "Blitzer",
    desc: "Elusive playmaker who uses agility and balance to operate in high-density central spaces.",
    examples: ["Zinedine Zidane", "Dennis Bergkamp"] },
  { id: "catalyst", name: "Catalyst", planId: "am_balanced", cls: "Blitzer",
    desc: "High-tempo attacking spark who drives offensive momentum and quick final-third combinations.",
    examples: ["Bruno Fernandes", "Martin Ødegaard"] },

  // ── Wide midfield ────────────────────────────────────────────────────────
  { id: "provider", name: "Provider", planId: "wm_winger", cls: "Maverick",
    desc: "Classic crosser hugging the touchline to deliver precision passes into the box for strikers.",
    examples: ["Jesús Navas", "Ryan Giggs"] },
  { id: "conductor", name: "Conductor", planId: "wm_playmaker", cls: "Creator",
    desc: "Wide orchestrator who controls attacking transitions and tempo from wide midfield positions.",
    examples: ["David Beckham", "Bernardo Silva"] },
  { id: "marathoner", name: "Marathoner", planId: "wm_workhorse", cls: "Engine",
    desc: "Tireless wide runner who tracks back defensively while continuously supporting forward attacks.",
    examples: ["Park Ji-sung", "Dirk Kuyt"] },
  { id: "inside_invader", name: "Invader", planId: "wm_inverted", cls: "Engine",
    desc: "Relentless wide runner who cuts aggressively into central channels to overload defensive shapes.",
    examples: ["Federico Valverde", "Freddie Ljungberg"] },
  { id: "specialist", name: "Specialist", planId: "wm_balanced", cls: "Engine",
    desc: "Reliable wide performer delivering consistent athletic coverage and tactical flexibility across flanks.",
    examples: ["James Milner", "Ivan Perišić"] },

  // ── Wingers ──────────────────────────────────────────────────────────────
  { id: "razor", name: "Razor", planId: "w_cutter", cls: "Blitzer",
    desc: "Sharp-cutting winger slicing inside onto their dominant foot to score direct goals.",
    examples: ["Arjen Robben", "Mohamed Salah"] },
  { id: "speedster", name: "Speedster", planId: "w_speed", cls: "Blitzer",
    desc: "Blistering touchline winger who exploits wide open space on fast counter-attacks.",
    examples: ["Kylian Mbappé", "Gareth Bale"] },
  { id: "virtuoso", name: "Virtuoso", planId: "w_trickster", cls: "Maverick",
    desc: "Flamboyant 1v1 specialist who uses skill moves to dismantle defenders in wide areas.",
    examples: ["Ronaldinho", "Vinícius Júnior"] },
  { id: "architect_winger", name: "Planner", planId: "w_creator", cls: "Creator",
    desc: "Creative winger who carves open high-percentage scoring chances from wide channels.",
    examples: ["Lionel Messi", "Ángel Di María"] },
  { id: "complete_winger", name: "Stylist", planId: "w_balanced", cls: "Maverick",
    desc: "Versatile attacking winger combining unpredictable flair, direct scoring, and creative crossing.",
    examples: ["Luís Figo", "Bukayo Saka"] },

  // ── Strikers ─────────────────────────────────────────────────────────────
  { id: "battering_ram", name: "Ram", planId: "st_targetman", cls: "Maverick",
    desc: "Powerful physical forward who holds up long balls and batters through low blocks.",
    examples: ["Didier Drogba", "Olivier Giroud"] },
  { id: "sniper", name: "Sniper", planId: "st_poacher", cls: "Maverick",
    desc: "Clinical box predator with elite positioning and one-touch finishing instincts.",
    examples: ["Filippo Inzaghi", "Ruud van Nistelrooy"] },
  { id: "decoy", name: "Decoy", planId: "st_false9", cls: "Creator",
    desc: "Deep-dropping striker who draws centre-backs out of position to free up space for wingers.",
    examples: ["Roberto Firmino", "Karim Benzema"] },
  { id: "bullet", name: "Bullet", planId: "st_speed", cls: "Maverick",
    desc: "Pacy breakaway forward who breaks through high defensive lines on direct counter-attacks.",
    examples: ["Thierry Henry", "Victor Osimhen"] },
  { id: "apex_predator", name: "Predator", planId: "st_balanced", cls: "Maverick",
    desc: "Universal finisher maintaining high goal-conversion rates across defensive, balanced, or attacking mentalities.",
    examples: ["Ronaldo Nazário", "Robert Lewandowski"] },
];

/**
 * Build a lookup with a NULL prototype.
 *
 * `Object.fromEntries` returns an ordinary object, so a miss on a key that
 * happens to name an Object.prototype member returns that member instead of
 * undefined — `getArchetype("toString")` would hand back a function, and every
 * `?? fallback` guarding a lookup would silently not fire. That is not
 * hypothetical here: one archetype's id is literally `constructor`.
 */
function lookup<T>(entries: [string, T][]): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, Object.fromEntries(entries));
}

export const ARCHETYPE_MAP: Record<string, Archetype> = lookup(
  ARCHETYPE_ROSTER.map((p) => [p.id, p])
);

/** The archetype a training plan aims at — the other half of the 1:1 mapping. */
export const ARCHETYPE_BY_PLAN: Record<string, Archetype> = lookup(
  ARCHETYPE_ROSTER.map((p) => [p.planId, p])
);

export function getArchetype(id: string): Archetype | undefined {
  return ARCHETYPE_MAP[id];
}

/** Every archetype a player at this position can earn (his plan set's five). */
export function archetypesForPosition(pos: Pos): Archetype[] {
  return plansForPosition(pos)
    .map((plan) => ARCHETYPE_BY_PLAN[plan.id])
    .filter((p): p is Archetype => !!p);
}

/** The positions an archetype can be earned at — its plan's position set.
 * Derived rather than stored, so the plan table stays the single authority on
 * which roles exist where. */
export function positionsOfArchetype(a: Archetype): Pos[] {
  const planPos = TRAINING_PLAN_MAP[a.planId]?.planPos;
  if (!planPos) return [];
  return ALL_POSITIONS.filter((p) => planPosOf(p) === planPos);
}

const ALL_POSITIONS: Pos[] = [
  "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST",
];

/** Every archetype whose plan covers any of these positions — the scout brief's
 * option list for a position group. */
export function archetypesForPositions(positions: Iterable<Pos>): Archetype[] {
  const want = new Set(positions);
  return ARCHETYPE_ROSTER.filter((a) => positionsOfArchetype(a).some((p) => want.has(p)));
}

// ── Generation & engine data (v1.77) ──────────────────────────────────────
//
// Everything below is what the deleted seed roster used to supply. It is
// authored PER CLASS rather than per archetype, which is the point: with 45
// archetypes, hand-authoring six style synergies plus scorer/assist/pace/height
// for each would be 450 numbers nobody could keep coherent, and the engine only
// ever needed the tactical grouping anyway. A class already means "what kind of
// footballer this is"; that is exactly the granularity synergy and goal-scoring
// weights want.
//
// Where a single ROLE genuinely differs from its class — a Tower is tall, a
// Sniper scores far more than his class average — a per-archetype override row
// below adjusts it. Overrides are the exception and are listed explicitly.

/** The six styles, in the column order `CLASS_STYLE_ROW` is authored in.
 * Declared rather than implied so the row lookup and `CLASS_FAVORED_STYLES`
 * read the same order without either hand-destructuring a tuple. */
const STYLE_ORDER: Style[] = [
  "Possession",
  "Counter",
  "Direct",
  "Gegenpress",
  "ParkTheBus",
  "WingPlay",
];

/**
 * How much a class's identity is worth under each style of play, as percentage
 * bonuses, in `STYLE_ORDER`.
 *
 * ── The three rules this table obeys (v1.78) ──────────────────────────────
 * Until v1.78 this was authored by feel, row by row, and it was badly unfair:
 * Engine summed to +45 across the six styles against Creator's +15 — three
 * times the value merely for existing — and Maverick was the best pick for NO
 * style at all, beaten at Possession by Creator and at Counter by Blitzer.
 * There was no reason ever to build around a Maverick. The rules now are:
 *
 *   1. EVERY ROW SUMS TO ZERO. A class is worth something because of what it
 *      suits, never because of which class it is. This is the fairness
 *      guarantee, and it is what makes the whole layer net-neutral across a
 *      mixed world rather than a flat bonus to whoever is commonest.
 *   2. EVERY CLASS STRICTLY WINS AT LEAST ONE STYLE. A class nobody's best at
 *      is a class nobody builds around. Blitzer wins two (Counter and Direct)
 *      deliberately — they are the same fast-transition plan wearing two hats,
 *      and splitting them would be artificial.
 *   3. NO CLASS IS DOMINATED. No row is ≥ another everywhere.
 *
 * ── The fourth rule, which is not about this table alone ──────────────────
 * A table can pass all three and still be unplayable. The classes reachable at
 * a position are fixed by the ROSTER, not by this file — a striker can only be
 * a Creator or a Maverick (four of the five ST archetypes are Maverick), and an
 * AM only a Blitzer or a Creator. An earlier draft of this table left every
 * striker in the game on negative synergy under Counter, Direct AND Gegenpress,
 * so a counter-attacking side could not field a striker who suited it.
 *
 * Hence: for every (style, position) pair the BEST archetype available there
 * must score ≥ 0. Note ≥ 0, not > 0 — a zero is not a dead end, it means "this
 * role is fine here, it just isn't what the style is built around". Only a
 * negative best-available is a trap. `npm run verify:archetypes:tactics`
 * asserts this against `archetypesForPosition`, and it is the check no
 * table-only inspection can make.
 *
 * The shape that falls out: Creator and Maverick are the broad, low-peak
 * classes that fit most systems adequately; Blitzer and Enforcer are the sharp
 * specialists that are excellent in their plan and a liability outside it.
 * That reads correctly — a playmaker slots into anything, a destroyer does not.
 *
 * Band is ±15, inside `tuning.synergyCap` (0.20), so nothing here is clipped.
 */
const CLASS_STYLE_ROW: Record<ArchetypeClass, [number, number, number, number, number, number]> = {
  //           Poss  Cnt  Dir  Geg  PTB  Wing     sum
  Creator:  [   15,  -5,  -10,   0,   0,    0 ], //  0
  Engine:   [    0,  -5,   -5,  15,  -5,    0 ], //  0
  Enforcer: [  -10,   5,    5,  -5,  15,  -10 ], //  0
  Blitzer:  [  -10,  15,   15,   0,  -5,  -15 ], //  0
  Maverick: [    0,   0,    0,  -5, -10,   15 ], //  0
};

/**
 * The styles a class genuinely plays well — derived from the row above rather
 * than authored a second time.
 *
 * The old `CLASS_SPECS.favoredStyles` (deleted with `archetypeclass.ts` in
 * v1.78) was a hand-written
 * copy of this fact, and the two had already drifted: it named Possession for
 * the Maverick, whose style row scored it below the Creator's. One table is the
 * authority; a class "favours" a style when its row is positive there.
 */
export const CLASS_FAVORED_STYLES: Record<ArchetypeClass, Style[]> = lookup(
  ARCHETYPE_CLASS_ORDER.map((cls) => [
    cls,
    STYLE_ORDER.filter((_, i) => CLASS_STYLE_ROW[cls][i] > 0),
  ])
) as Record<ArchetypeClass, Style[]>;

/**
 * The class×style table as a lookup, for the Tactics Help guide (v1.80).
 *
 * The guide teaches this system, and a guide that restated the numbers in JSX
 * would be a second copy of the balance table free to drift from the one the
 * engine reads — the exact failure `CLASS_FAVORED_STYLES` exists to document.
 * Exposing the authored row instead means the page is a VIEW of the rule.
 *
 * The value is the percentage swing the class earns under that style, i.e. what
 * `styleSynergy` becomes before the engine's `synergyCap` clamp (nothing here is
 * near the cap — see the band note above).
 */
export function classStyleBonus(cls: ArchetypeClass, style: Style): number {
  const i = STYLE_ORDER.indexOf(style);
  return i < 0 ? 0 : CLASS_STYLE_ROW[cls][i];
}

/** The six styles in the order the balance table is authored in — so the Help
 * guide's columns and the table's columns are the same list, not two. */
export const STYLE_TABLE_ORDER: readonly Style[] = STYLE_ORDER;

// ── Instruction preferences: the ARCHETYPE half of the loop (v1.78) ────────
//
// The table above says what KIND of footballer suits a STYLE. This says what
// THIS ROLE wants from the five advanced dials — and it is the half that makes
// an archetype matter rather than collapsing into its class. A Sniper and a Ram
// are both Maverick strikers with identical style synergy; here they diverge on
// every axis, because they are opposite footballers.
//
// ── This table must never name an attribute ───────────────────────────────
// "Can these players physically DO what the instructions ask" is
// `tacticfit.ts`'s question, answered from the 35 attributes at team level.
// This one is pure identity: it reads an enum, it is per-player, and every
// value is authored prose you can quote in the UI ("the Sniper wants it hit
// early behind a high line"). If you find yourself wanting an attribute here,
// the thing you want already exists in `tacticfit.ts`. There is deliberately no
// import from `attributes.ts` on this path.
//
// ── The balance rule ──────────────────────────────────────────────────────
// EVERY NAMED AXIS MUST CARRY BOTH A `likes` AND A `dislikes`.
//
// This is not a style guide, it is the fairness guarantee. A row that names a
// like without a matching dislike is structurally advantaged: measured over the
// 405 possible setups, an early draft had the Maverick scoring positive on 51%
// of them and Razor on 56% while Creator sat at 22% — a silent power gap nobody
// authoring by feel would have spotted. With the rule applied every row's mean
// score over the whole instruction space is exactly 0, and %positive equals
// %negative. No archetype gains from this system merely by existing, and the
// layer is net-neutral across a mixed world by construction.

/** What one role wants from one dial. Both fields are required in practice —
 * see the balance rule above, which the dev assertion enforces. */
export interface AxisPref<T extends string> {
  likes?: T[];
  dislikes?: T[];
}

/**
 * A role's preferences across the five advanced dials.
 *
 * An omitted axis means genuinely indifferent, and contributes nothing in
 * either direction — a keeper has no opinion on attacking width. Most rows name
 * two or three axes, which is what keeps the table readable.
 */
export interface InstructionPrefs {
  tempo?: AxisPref<Tempo>;
  width?: AxisPref<Width>;
  press?: AxisPref<Press>;
  line?: AxisPref<DefLine>;
  focus?: AxisPref<Focus>;
}

/** The five dials as resolved values. Separate from `Tactic` so the scoring
 * function takes settled enums and never has to know that a v2 save may omit
 * them. */
export interface InstructionView {
  tempo: Tempo;
  width: Width;
  press: Press;
  line: DefLine;
  focus: Focus;
}

/**
 * The class default — what every archetype of a class wants unless it says
 * otherwise.
 *
 * These are the sentences the class blurbs already make: an Engine wants to
 * run, an Enforcer wants the play in front of him. Authoring them once here is
 * what keeps the override table to the roles that genuinely differ.
 */
const CLASS_INSTRUCTIONS: Record<ArchetypeClass, InstructionPrefs> = {
  // Time on the ball, and space to use it. Being made to chase ruins them.
  Creator: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  // Ground to cover. A deep line and a low press give them nothing to do.
  Engine: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
  // The play in front of them. A high line asks them to turn and run.
  Enforcer: {
    line: { likes: ["Deep"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  // Space in behind, hit early. A slow narrow build-up strands them.
  Blitzer: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
  },
  // The ball at their feet, and licence. Rigid patterns blunt them.
  Maverick: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    focus: { likes: ["Wide"], dislikes: ["Central"] },
  },
};

/** The class's default dial preferences, for the Help guide (v1.80). Read-only
 * view of the table above — see the note on `classStyleBonus`. */
export function classInstructionPrefs(cls: ArchetypeClass): InstructionPrefs {
  return CLASS_INSTRUCTIONS[cls];
}

/**
 * The per-archetype rows.
 *
 * A row here REPLACES its class default outright rather than merging into it.
 * Whole-object replacement means one lookup is always the whole answer — with a
 * deep merge you would need both tables in your head plus a precedence rule for
 * "the class dislikes Slow but the archetype likes it", and nobody remembers
 * that six months later. Repeating a line the class already said is the price
 * of never having to hold two tables at once.
 *
 * All 45 are authored explicitly. That is more than the ~19 the design
 * envisaged, and it is deliberate: the audit found the class defaults left
 * whole position groups sharing an identical row, which is exactly the blandness
 * this system exists to remove. Every role now states its own case, and
 * `CLASS_INSTRUCTIONS` remains the documented fallback for any archetype a mod
 * adds without one.
 *
 * Rows may legitimately coincide ACROSS positions — a Wall (GK) and a Stopper
 * (CB) want the same things and a manager never chooses between them. Two
 * archetypes sharing a row AND a position would be a real bug, and the verify
 * script checks for exactly that.
 */
const ARCHETYPE_INSTRUCTIONS: Record<string, InstructionPrefs> = {
  // ── Goalkeepers ──────────────────────────────────────────────────────────
  // A keeper's tactical life is the defensive line in front of him, plus how
  // much of the pitch the press leaves him to cover.
  wall: { line: { likes: ["Deep"], dislikes: ["High"] }, press: { likes: ["Low"], dislikes: ["High"] } },
  vanguard: { line: { likes: ["High"], dislikes: ["Deep"] }, press: { likes: ["High"], dislikes: ["Low"] } },
  initiator: { tempo: { likes: ["Slow"], dislikes: ["High"] }, line: { likes: ["Deep"], dislikes: ["High"] } },
  general: { line: { likes: ["Deep"], dislikes: ["High"] }, width: { likes: ["Narrow"], dislikes: ["Wide"] } },
  // The balanced keeper: no extreme suits him, which IS his identity rather
  // than an absence of one — he is the safe pair of hands in a steady setup.
  guardian: { press: { likes: ["Medium"], dislikes: ["High"] }, line: { likes: ["Standard"], dislikes: ["High"] } },

  // ── Centre backs ─────────────────────────────────────────────────────────
  enforcer: { line: { likes: ["Deep"], dislikes: ["High"] }, press: { likes: ["Low"], dislikes: ["High"] } },
  architect: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    line: { likes: ["Deep"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  // The one centre back who wants a high line: he defends the space, not the box.
  interceptor: { line: { likes: ["High"], dislikes: ["Deep"] }, press: { likes: ["High"], dislikes: ["Low"] } },
  tower: { line: { likes: ["Deep"], dislikes: ["High"] }, width: { likes: ["Narrow"], dislikes: ["Wide"] } },
  sentinel: { line: { likes: ["Deep"], dislikes: ["High"] }, tempo: { likes: ["Slow"], dislikes: ["High"] } },

  // ── Full backs ───────────────────────────────────────────────────────────
  // Motor overlaps and Constructor tucks in — the two full backs pull in
  // opposite directions on width, which is the whole point of the pair.
  engine: {
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    focus: { likes: ["Wide"], dislikes: ["Central"] },
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
  // Anchor locks down the flank 1v1: a wide shape isolates him against a winger.
  anchor: {
    line: { likes: ["Deep"], dislikes: ["High"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  constructor: {
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
    tempo: { likes: ["Slow"], dislikes: ["High"] },
  } as InstructionPrefs, // `constructor` is an Object.prototype key — see `lookup`
  dynamo: {
    press: { likes: ["High"], dislikes: ["Low"] },
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
  },
  // The stay-at-home full back: structure over adventure.
  protector: {
    line: { likes: ["Deep"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
    tempo: { likes: ["Slow"], dislikes: ["High"] },
  },

  // ── Defensive midfield ───────────────────────────────────────────────────
  destroyer: { press: { likes: ["High"], dislikes: ["Low"] }, line: { likes: ["Deep"], dislikes: ["High"] } },
  metronome: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
    line: { likes: ["Deep"], dislikes: ["High"] },
  },
  iron_lung: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
  // The one Maverick who WANTS a high press — wriggling out of one is his
  // entire identity, so the class default (which flees pressure) is wrong here.
  escapist: {
    press: { likes: ["High"], dislikes: ["Low"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    tempo: { likes: ["Slow"], dislikes: ["High"] },
  },
  shield: {
    line: { likes: ["Deep"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
  },

  // ── Central midfield ─────────────────────────────────────────────────────
  workhorse: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
  maestro: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  dribbler: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  infiltrator: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  // Covers ground between both boxes: he wants a standard shape to run in.
  engine_room: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    width: { likes: ["Standard"], dislikes: ["Narrow"] },
  },

  // ── Attacking midfield ───────────────────────────────────────────────────
  visionary: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    press: { likes: ["Low"], dislikes: ["High"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  phantom: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  marksman: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  illusionist: {
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  catalyst: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },

  // ── Wide midfield ────────────────────────────────────────────────────────
  provider: {
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    focus: { likes: ["Wide"], dislikes: ["Central"] },
  },
  conductor: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  marathoner: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    press: { likes: ["High"], dislikes: ["Low"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
  },
  // Cuts in off the flank, so he is the wide man who wants the ball central.
  inside_invader: {
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
    press: { likes: ["High"], dislikes: ["Low"] },
  },
  specialist: {
    tempo: { likes: ["Standard"], dislikes: ["Slow"] },
    width: { likes: ["Standard"], dislikes: ["Narrow"] },
  },

  // ── Wingers ──────────────────────────────────────────────────────────────
  // Razor cuts inside onto his strong foot; Provider hugs the line. Opposite
  // answers to the same question, which is what makes the winger pick a choice.
  razor: {
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
    tempo: { likes: ["High"], dislikes: ["Slow"] },
  },
  speedster: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
  virtuoso: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    focus: { likes: ["Wide"], dislikes: ["Central"] },
  },
  architect_winger: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    focus: { likes: ["Wide"], dislikes: ["Central"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  // Flair, scoring and crossing at once — he wants the ball spread around
  // rather than funnelled down one channel.
  complete_winger: {
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    focus: { likes: ["Mixed"], dislikes: ["Central"] },
    tempo: { likes: ["Standard"], dislikes: ["Slow"] },
  },

  // ── Strikers ─────────────────────────────────────────────────────────────
  // Ram and Sniper are the headline pair: same class, same position, opposite
  // on all four axes. They agree in sign on only 16% of the 405 setups.
  battering_ram: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    width: { likes: ["Wide"], dislikes: ["Narrow"] },
    line: { likes: ["Deep"], dislikes: ["High"] },
  },
  sniper: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
    width: { likes: ["Narrow"], dislikes: ["Wide"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
  },
  decoy: {
    tempo: { likes: ["Slow"], dislikes: ["High"] },
    focus: { likes: ["Central"], dislikes: ["Wide"] },
    press: { likes: ["Low"], dislikes: ["High"] },
  },
  bullet: {
    tempo: { likes: ["High"], dislikes: ["Slow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
    press: { likes: ["High"], dislikes: ["Low"] },
  },
  // The universal finisher: no extreme suits him, which is the identity — he is
  // the striker who works in any setup rather than the best one in a single plan.
  apex_predator: {
    tempo: { likes: ["Standard"], dislikes: ["Slow"] },
    width: { likes: ["Standard"], dislikes: ["Narrow"] },
    line: { likes: ["High"], dislikes: ["Deep"] },
  },
};

/**
 * How well a role's wants are met by the setup, as a signed −1..1 score.
 *
 * Counted per AXIS THE ROLE NAMES, not per dial: an archetype that names three
 * axes and gets all three scores 1.0, and so does one that names a single axis
 * and gets it. Dividing by five instead would make a one-axis keeper
 * structurally incapable of earning what a four-axis wing back can, which is a
 * power gap disguised as arithmetic.
 *
 * An axis the role is indifferent to contributes nothing in either direction.
 */
export function instructionFitScore(prefs: InstructionPrefs, t: InstructionView): number {
  let sum = 0;
  let axes = 0;
  const axis = <T extends string>(p: AxisPref<T> | undefined, v: T) => {
    if (!p) return;
    axes++;
    if (p.likes?.includes(v)) sum += 1;
    else if (p.dislikes?.includes(v)) sum -= 1;
  };
  axis(prefs.tempo, t.tempo);
  axis(prefs.width, t.width);
  axis(prefs.press, t.press);
  axis(prefs.line, t.line);
  axis(prefs.focus, t.focus);
  return axes > 0 ? sum / axes : 0;
}

/** The dials a role wants, as English — "a high tempo and a high line".
 * Shared by the assistant's tooltip and the player profile so the two can never
 * describe the same archetype differently. */
export function describePrefs(prefs: InstructionPrefs): string {
  const parts: string[] = [];
  const say = (p: AxisPref<string> | undefined, noun: string) => {
    const like = p?.likes?.[0];
    if (like) parts.push(`${/^[AEIOU]/.test(like) ? "an" : "a"} ${like.toLowerCase()} ${noun}`);
  };
  say(prefs.tempo, "tempo");
  say(prefs.width, "width");
  say(prefs.press, "press");
  say(prefs.line, "defensive line");
  say(prefs.focus, "focus");
  if (parts.length === 0) return "nothing in particular";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Per-class defaults for the goal model and the aging curve.
 *
 * `scorerWeight`/`assistWeight` are relative — the engine normalises them — so
 * only the ratios matter. `paceReliance` (0..1) is how much of the player's
 * game rests on athleticism, and so how early and hard he declines. */
const CLASS_TRAITS: Record<
  ArchetypeClass,
  { scorerWeight: number; assistWeight: number; paceReliance: number; heightCm: [number, number] }
> = {
  Creator:  { scorerWeight: 0.55, assistWeight: 1.30, paceReliance: 0.25, heightCm: [180, 6] },
  Engine:   { scorerWeight: 0.60, assistWeight: 0.85, paceReliance: 0.55, heightCm: [181, 6] },
  Enforcer: { scorerWeight: 0.25, assistWeight: 0.30, paceReliance: 0.35, heightCm: [186, 6] },
  Blitzer:  { scorerWeight: 1.40, assistWeight: 0.70, paceReliance: 0.70, heightCm: [180, 6] },
  Maverick: { scorerWeight: 1.10, assistWeight: 1.00, paceReliance: 0.50, heightCm: [180, 6] },
};

/**
 * The per-archetype exceptions.
 *
 * Only roles whose job differs materially from their class average appear here;
 * everything omitted takes the class row unchanged. Keepers are the clearest
 * case — they are spread across all five classes for tactical variety but none
 * of them scores goals — followed by the aerial/physical roles, which are tall,
 * and the pure finishers, which are not their class's average scorer.
 */
interface ArchetypeOverride {
  scorerWeight?: number;
  assistWeight?: number;
  paceReliance?: number;
  heightCm?: [number, number];
}

const ARCHETYPE_OVERRIDE: Record<string, ArchetypeOverride> = {
  // Goalkeepers: never the scorer, rarely the assister, and tall.
  wall:       { scorerWeight: 0.01, assistWeight: 0.01, paceReliance: 0.10, heightCm: [191, 4] },
  vanguard:   { scorerWeight: 0.01, assistWeight: 0.05, paceReliance: 0.30, heightCm: [188, 4] },
  initiator:  { scorerWeight: 0.01, assistWeight: 0.08, paceReliance: 0.15, heightCm: [189, 4] },
  general:    { scorerWeight: 0.01, assistWeight: 0.02, paceReliance: 0.15, heightCm: [192, 4] },
  guardian:   { scorerWeight: 0.01, assistWeight: 0.03, paceReliance: 0.20, heightCm: [189, 4] },

  // Centre backs: aerial threat from set pieces, but no open-play goal share.
  enforcer:   { scorerWeight: 0.30, heightCm: [188, 5] },
  tower:      { scorerWeight: 0.40, heightCm: [193, 4] },
  architect:  { assistWeight: 0.70, heightCm: [186, 5] },
  interceptor:{ heightCm: [186, 5] },
  sentinel:   { heightCm: [187, 5] },

  // Full backs: the assist end of the pitch, not the scoring end.
  engine:     { scorerWeight: 0.30, assistWeight: 1.10, heightCm: [178, 5] },
  anchor:     { scorerWeight: 0.15, assistWeight: 0.40, heightCm: [180, 5] },
  // `constructor` is Object.prototype's own key, so TypeScript checks this
  // property against THAT rather than against the index signature and the height
  // tuple widens to number[]. The explicit annotation pins it back. (The same
  // key is why every lookup table in this file has a null prototype — see
  // `lookup` below.)
  constructor: { scorerWeight: 0.20, assistWeight: 1.00, heightCm: [178, 5] } as ArchetypeOverride,
  dynamo:     { scorerWeight: 0.25, assistWeight: 0.90, heightCm: [179, 5] },
  protector:  { scorerWeight: 0.15, assistWeight: 0.45, heightCm: [181, 5] },

  // Holding midfield: screens, not scorers.
  destroyer:  { scorerWeight: 0.30, assistWeight: 0.35, heightCm: [185, 5] },
  metronome:  { scorerWeight: 0.40, assistWeight: 1.15, paceReliance: 0.15 },
  iron_lung:  { scorerWeight: 0.40 },
  escapist:   { scorerWeight: 0.45, assistWeight: 0.90 },
  shield:     { scorerWeight: 0.25, assistWeight: 0.40, heightCm: [184, 5] },

  // Wide + attacking roles that beat their class average one way or the other.
  provider:   { scorerWeight: 0.55, assistWeight: 1.60, heightCm: [177, 5] },
  conductor:  { assistWeight: 1.45, heightCm: [176, 5] },
  marathoner: { scorerWeight: 0.50, assistWeight: 0.95 },
  virtuoso:   { scorerWeight: 1.20, assistWeight: 1.20, heightCm: [175, 5] },
  architect_winger: { assistWeight: 1.55, heightCm: [176, 5] },
  speedster:  { paceReliance: 0.85, heightCm: [176, 5] },
  razor:      { scorerWeight: 1.55 },

  // Strikers: the sharp end.
  battering_ram: { scorerWeight: 1.60, assistWeight: 0.55, paceReliance: 0.25, heightCm: [191, 4] },
  sniper:     { scorerWeight: 2.00, assistWeight: 0.35, paceReliance: 0.40, heightCm: [179, 5] },
  decoy:      { scorerWeight: 1.00, assistWeight: 1.35, paceReliance: 0.30, heightCm: [178, 5] },
  bullet:     { scorerWeight: 1.75, assistWeight: 0.45, paceReliance: 0.90, heightCm: [180, 5] },
  apex_predator: { scorerWeight: 1.90, assistWeight: 0.70, heightCm: [183, 5] },
};

/** Goal commentary per class — the flavour the old roster carried per archetype.
 * Keyed by class because the line describes HOW the goal was scored, and that is
 * a function of the kind of player, not of his exact role. Keepers get their own
 * line via the override below, since "the keeper has scored" is its own event. */
const CLASS_GOAL_FLAVOR: Record<ArchetypeClass, string[]> = {
  Creator: [
    "{p} curls one into the far corner — a goal of real quality.",
    "{p} picks his spot from the edge of the box.",
    "{p} steps inside and bends it beyond the keeper.",
  ],
  Engine: [
    "{p} arrives late in the box and buries it!",
    "{p} keeps running and gets his reward — {t} lead the way.",
    "{p} bundles it home after a surging run from deep.",
  ],
  Enforcer: [
    "{p} rises highest and heads it home!",
    "{p} forces it over the line from the set piece.",
    "{p} powers a header past the keeper.",
  ],
  Blitzer: [
    "{p} is in behind — and finishes it coolly!",
    "{p} races clear and slots it past the keeper.",
    "{p} lashes it into the roof of the net!",
  ],
  Maverick: [
    "{p} produces something out of nothing — what a finish!",
    "{p} beats his man and tucks it away.",
    "{p} improvises brilliantly to score.",
  ],
};

/** Goalkeepers, whichever class they belong to, score in only one register. */
const GK_GOAL_FLAVOR = ["{p} scores?! A goalkeeper on the scoresheet — extraordinary scenes!"];

const GK_PLAN_POS = "GK";

/** Is this archetype a goalkeeper's? Read off the plan's position set, so the
 * table stays the authority and nothing here names an archetype. */
function isGkArchetype(a: Archetype): boolean {
  return TRAINING_PLAN_MAP[a.planId]?.planPos === GK_PLAN_POS;
}

/** Everything the engine and worldgen need about an archetype, resolved from
 * the class row plus any per-archetype override. */
export interface ArchetypeProfile {
  /** Per-style multipliers; the engine clamps each to 1 ± tuning.synergyCap. */
  styleSynergy: Record<Style, number>;
  /** Relative chance of being the scorer / assister on a goal (engine-normalised). */
  scorerWeight: number;
  assistWeight: number;
  /** 0..1 — pace-reliant archetypes decline earlier and harder (§5 aging). */
  paceReliance: number;
  /** Typical adult height band in cm: [mean, standard deviation]. */
  heightCm: [number, number];
  /** Flavour templates for goals: {p}=player, {a}=assister, {t}=team. */
  goalFlavor: string[];
  /** The 0..1 per-attribute emphasis worldgen and development shape a line from
   * — the archetype's own training plan weights. */
  attrProfile: Attributes;
  /** What this role wants from the five advanced dials (v1.78). Resolved from
   * the class default plus any per-archetype row, so the engine reads one field
   * rather than doing a lookup-with-fallback on every rating call. */
  instructionPrefs: InstructionPrefs;
}

/** The row above as multipliers, keyed by style. Built by walking
 * `STYLE_ORDER` rather than destructuring the tuple, so adding a style means
 * editing the order list and the rows — never this function. */
function styleSynergyOf(cls: ArchetypeClass): Record<Style, number> {
  const row = CLASS_STYLE_ROW[cls];
  const out = {} as Record<Style, number>;
  STYLE_ORDER.forEach((style, i) => {
    out[style] = 1 + row[i] / 100;
  });
  return out;
}

/**
 * The resolved profile for every archetype, built once at module load.
 *
 * `attrProfile` is the archetype's training-plan weights verbatim: a plan
 * already declares 1.0 for its four primaries, 0.6 for its four secondaries and
 * 0.2 for everything else, which is precisely the 0..1 emphasis worldgen's
 * spread and development's distribution want. Deriving it rather than authoring
 * it is what guarantees generation and identity agree — a player generated from
 * the `st_poacher` weights reads as the Sniper, because the Sniper IS the
 * `st_poacher` archetype.
 */
export const ARCHETYPE_PROFILE: Record<string, ArchetypeProfile> = lookup(
  ARCHETYPE_ROSTER.map((a) => {
    const base = CLASS_TRAITS[a.cls];
    const over = ARCHETYPE_OVERRIDE[a.id] ?? {};
    const plan = TRAINING_PLAN_MAP[a.planId];
    return [
      a.id,
      {
        styleSynergy: styleSynergyOf(a.cls),
        scorerWeight: over.scorerWeight ?? base.scorerWeight,
        assistWeight: over.assistWeight ?? base.assistWeight,
        paceReliance: over.paceReliance ?? base.paceReliance,
        heightCm: over.heightCm ?? base.heightCm,
        goalFlavor: isGkArchetype(a) ? GK_GOAL_FLAVOR : CLASS_GOAL_FLAVOR[a.cls],
        // The plan table is the single source of the emphasis. A missing plan is
        // impossible (the dev assertion at the bottom enforces the 1:1 mapping)
        // but a flat profile is the safe fallback for a mod file that breaks it.
        attrProfile: (plan?.weights ?? flatProfile()) as unknown as Attributes,
        // Resolved once here rather than per rating call. A row replaces its
        // class default outright — see the note on ARCHETYPE_INSTRUCTIONS.
        instructionPrefs: ARCHETYPE_INSTRUCTIONS[a.id] ?? CLASS_INSTRUCTIONS[a.cls],
      } satisfies ArchetypeProfile,
    ];
  })
);

function flatProfile(): Record<AttrKey, number> {
  const out = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) out[k] = OTHER_SHARE;
  return out;
}

/** Fallback profile for a player whose archetype can't be resolved (a mod file,
 * a corrupted save). Neutral in every respect, so the engine never branches. */
export const NEUTRAL_ARCHETYPE_PROFILE: ArchetypeProfile = {
  styleSynergy: { Possession: 1, Counter: 1, Direct: 1, Gegenpress: 1, ParkTheBus: 1, WingPlay: 1 },
  scorerWeight: 0.6,
  assistWeight: 0.6,
  paceReliance: 0.4,
  heightCm: [180, 6],
  goalFlavor: ["{p} scores!"],
  attrProfile: flatProfile() as unknown as Attributes,
  // No preferences at all — `instructionFitScore` returns 0, which is a ×1.0
  // multiplier. The neutral case falls out of the data rather than needing a
  // branch in the engine.
  instructionPrefs: {},
};

/**
 * The profile for a player, resolved from the archetype his attributes earn.
 *
 * This is the entry point worldgen, development and the match engine all call.
 * It takes the archetype directly rather than a player, because callers differ
 * in whether they already have one resolved.
 */
export function profileOf(archetype: Archetype | undefined): ArchetypeProfile {
  if (!archetype) return NEUTRAL_ARCHETYPE_PROFILE;
  return ARCHETYPE_PROFILE[archetype.id] ?? NEUTRAL_ARCHETYPE_PROFILE;
}

/** The profile a player's CURRENT attributes earn him. The convenience form of
 * `profileOf(deriveArchetype(...))`, which is what most callers want. */
export function profileForAttrs(attrs: Record<AttrKey, number>, pos: Pos): ArchetypeProfile {
  return profileOf(deriveArchetype(attrs, pos));
}

/**
 * Shape a full attribute line to a role at a target rating — the editor's
 * "shape to archetype" button.
 *
 * The same spread `worldgen.deriveAttrs` applies, minus the jitter, so an
 * authored player and a generated one of the same rating and archetype read
 * alike. `planId` names the archetype to shape toward; omitted, the position's
 * first plan is used, which is the "auto" path's fallback.
 */
export function shapeAttrsToArchetype(
  pos: Pos,
  planId: string | undefined,
  targetOverall: number
): Attributes {
  const plan =
    (planId ? TRAINING_PLAN_MAP[planId] : undefined) ?? plansForPosition(pos)[0] ?? defaultPlanFor(pos);
  const profile = plan.weights;
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;
  const shaped = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW; // 1.0 = signature attribute
    shaped[k] = Math.max(1, Math.min(99, Math.round(targetOverall * (0.55 + 0.48 * rel))));
  }
  // Leave the top-weighted attributes room to absorb the fit without pinning at
  // 99 — the same pre-compensation `deriveAttrs` applies.
  for (const k of keyAttrsFor(pos, 4)) {
    shaped[k] = Math.max(1, Math.round(shaped[k] - targetOverall * 0.06));
  }
  return fitAttrsToOverall(shaped, pos, targetOverall);
}

// ── Deriving an archetype from attributes ────────────────────────────────────

/**
 * How strongly a player matches one plan's attribute profile.
 *
 * The score is how far the plan's OWN attributes stand above the player's
 * baseline — his mean attribute — weighted by the plan's tier shares. It is a
 * measure of SHAPE, not of level.
 *
 * Measuring shape is the whole trick. The obvious scoring (a weighted average
 * over all 35 attributes) does not work: every plan weights every attribute,
 * and the 27 attributes in the "other" tier at 0.2 share swamp the four
 * primaries at 1.0. Every archetype then scores within a point or two of the
 * others, the balanced archetype — whose profile is nearest a flat average — wins
 * almost every time, and a specialist's identity never surfaces. Subtracting
 * the player's own mean removes that common term, so what remains is only what
 * makes this plan different from the others.
 *
 * Anchoring on the player's own mean also makes the comparison fair across
 * quality: a League Two defender is judged on the shape of HIS attribute line,
 * not against a Premier League one. The same reasoning `tacticfit.ts` anchors
 * on, for the same reason.
 *
 * Positive means the plan's attributes are a genuine strength of his; near zero
 * means he is no more suited to this plan than to any other.
 */
export function planMatchScore(attrs: Record<AttrKey, number>, plan: TrainingPlanDef): number {
  let mean = 0;
  for (const k of ATTR_KEYS) mean += attrs[k] ?? 0;
  mean /= ATTR_KEYS.length;

  // Tier shares minus the flat "other" baseline: only the primaries (0.8) and
  // secondaries (0.4) carry signal, and the 27 background attributes drop out
  // entirely rather than diluting it.
  let sum = 0;
  let weight = 0;
  for (const k of ATTR_KEYS) {
    const w = plan.weights[k] - OTHER_SHARE;
    if (w <= 0) continue;
    sum += ((attrs[k] ?? 0) - mean) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/** An archetype match, with the score that earned it — for the UI's "next identity". */
export interface ArchetypeMatch {
  archetype: Archetype;
  score: number;
}

/**
 * The average tier share each attribute carries across a position's five plans.
 *
 * This is what a plan is measured AGAINST. Every balanced plan is built from its
 * position's most common attributes, so it overlaps its four specialists almost
 * completely — measured across the shipped table, all eight of a balanced plan's
 * targets also appear in at least one specialist, at every position. Scored on
 * raw shape, the balanced plan therefore cannot lose: whatever the player is
 * good at, it already claims a share of, and it collects credit from all four
 * specialisms at once. A ball-playing centre back came out as The Sentinel, and
 * every keeper came out as The Guardian.
 *
 * Subtracting the positional mean fixes that by asking a sharper question: not
 * "is he good at what this plan trains" but "is he good at what makes this plan
 * DIFFERENT from its siblings". An attribute all five plans want carries no
 * signal about which of them he is, and drops out. The balanced plan is left
 * with almost nothing of its own — which is correct, and is exactly why it wins
 * only when no specialism fits, rather than by default.
 *
 * Memoised per position: the plan table is static, so this is computed once.
 */
const DISTINCTIVE_WEIGHTS = new Map<string, Record<AttrKey, number>>();

function distinctiveWeights(pos: Pos): Record<AttrKey, number> {
  const planPos = planPosOf(pos);
  const cached = DISTINCTIVE_WEIGHTS.get(planPos);
  if (cached) return cached;

  const plans = plansForPosition(pos);
  const mean = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) {
    let s = 0;
    for (const p of plans) s += p.weights[k];
    mean[k] = plans.length > 0 ? s / plans.length : 0;
  }
  DISTINCTIVE_WEIGHTS.set(planPos, mean);
  return mean;
}

/**
 * How distinctively a player matches one plan, among the five at his position.
 *
 * Same shape measure as `planMatchScore`, but each attribute is weighted by how
 * much MORE this plan wants it than its siblings do — so the score reflects the
 * identity the plan uniquely stands for.
 */
function distinctiveScore(
  attrs: Record<AttrKey, number>,
  plan: TrainingPlanDef,
  mean: Record<AttrKey, number>
): number {
  let attrMean = 0;
  for (const k of ATTR_KEYS) attrMean += attrs[k] ?? 0;
  attrMean /= ATTR_KEYS.length;

  let sum = 0;
  let weight = 0;
  for (const k of ATTR_KEYS) {
    const w = plan.weights[k] - mean[k];
    if (w <= 0) continue;
    sum += ((attrs[k] ?? 0) - attrMean) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Rank every archetype available at `pos` by how well the attributes fit it.
 *
 * Returned strongest-first, so `[0]` is the earned archetype and `[1]` is the
 * identity he is closest to shifting into.
 */
export function rankArchetypes(attrs: Record<AttrKey, number>, pos: Pos): ArchetypeMatch[] {
  const mean = distinctiveWeights(pos);
  const out: ArchetypeMatch[] = [];
  for (const archetype of archetypesForPosition(pos)) {
    const plan = TRAINING_PLAN_MAP[archetype.planId];
    if (!plan) continue;
    out.push({ archetype, score: distinctiveScore(attrs, plan, mean) });
  }
  // Ties break toward the earlier archetype in the table, which is stable across
  // runs — the plan table's own order, specialisations before balanced.
  return out.sort((a, b) => b.score - a.score);
}

/**
 * How much better the leading archetype must score than the incumbent before the
 * player actually changes identity.
 *
 * Without this, a player sitting between two profiles would flip archetype on
 * every rounding-level attribute tick, and his class — and so his side's
 * tactical modifiers — would flicker season to season. The margin makes the
 * identity sticky: it changes when training has genuinely moved him, not when
 * one point of Agility crossed a line.
 */
export const ARCHETYPE_SWITCH_MARGIN = 1.5;

/**
 * How clearly a specialism must show before it displaces the balanced archetype.
 *
 * Scored distinctively, a balanced plan has almost no weight of its own (that is
 * the point — it stands for nothing in particular), so it would otherwise never
 * win and the balanced archetypes would be unreachable. Instead the leading
 * SPECIALIST must clear this bar, in attribute points above the player's own
 * mean, to claim him; a genuinely well-rounded player clears nothing and is
 * correctly read as balanced.
 *
 * In attribute points, so it reads directly: a specialist needs its distinctive
 * attributes sitting this far above the player's own average before that counts
 * as an identity rather than noise.
 *
 * Calibrated against a generated world rather than guessed. Across the shipped
 * English database the leading specialist score runs p10≈7.6, p50≈11.4,
 * p90≈15.5, so a threshold in the single digits claims essentially everyone: at
 * 3 the balanced archetypes were literally unreachable (0.0% of 2,152 players),
 * leaving four of the 45 as dead data. 8 puts roughly one player in eight on a
 * balanced archetype — a real minority who genuinely have no standout specialism —
 * and evens the class split, which matters because a class's share of the world
 * decides how easy its tactical bonus is to field.
 */
export const SPECIALISM_THRESHOLD = 8;

/**
 * The archetype a player has earned.
 *
 * `currentId` is his existing archetype, if any: passing it in applies the
 * hysteresis margin above, so an established identity is only displaced by a
 * clearly better fit. Omit it for a fresh read (a newly generated player, or the
 * UI asking "what would he be").
 *
 * Pure and deterministic — the same attribute line always gives the same answer.
 */
export function deriveArchetype(
  attrs: Record<AttrKey, number>,
  pos: Pos,
  currentId?: string
): Archetype | undefined {
  const ranked = rankArchetypes(attrs, pos);
  if (ranked.length === 0) return undefined;

  // The balanced archetype is the one whose plan is its position's default — the
  // last in the set. It stands for no specialism, so it wins by DEFAULT rather
  // than by score: a player only leaves it when a specialism genuinely shows.
  const balancedId = ARCHETYPE_BY_PLAN[defaultPlanFor(pos).id]?.id;
  const leader = ranked.find((r) => r.archetype.id !== balancedId);
  const best =
    leader && leader.score >= SPECIALISM_THRESHOLD
      ? leader
      : ranked.find((r) => r.archetype.id === balancedId) ?? ranked[0];

  if (!currentId || currentId === best.archetype.id) return best.archetype;

  const incumbent = ranked.find((r) => r.archetype.id === currentId);
  // An incumbent that isn't in this position's set at all (he was retrained to a
  // new position) has no claim — take the new best outright.
  if (!incumbent) return best.archetype;
  return best.score >= incumbent.score + ARCHETYPE_SWITCH_MARGIN ? best.archetype : incumbent.archetype;
}

// ── Class tallies ─────────────────────────────────────────────────────────

/** An empty per-class tally. */
export function emptyClassCount(): Record<ArchetypeClass, number> {
  return { Creator: 0, Engine: 0, Enforcer: 0, Blitzer: 0, Maverick: 0 };
}

/** Count archetypes by class — the XI's class mix, for the Tactics strip.
 * Moved here in v1.78 when `archetypeclass.ts` was deleted; it is the one thing
 * from that module the UI still wants, and it is a fact about the roster rather
 * than about any tactical effect. */
export function tallyClasses(classes: (ArchetypeClass | undefined)[]): Record<ArchetypeClass, number> {
  const counts = emptyClassCount();
  for (const c of classes) if (c) counts[c]++;
  return counts;
}

if (process.env.NODE_ENV !== "production") {
  // Every archetype must name a real plan, and every plan must have exactly one
  // archetype — the 1:1 mapping is the whole design, so a drift is a bug.
  const planIds = new Set(Object.keys(TRAINING_PLAN_MAP));
  for (const p of ARCHETYPE_ROSTER) {
    if (!planIds.has(p.planId)) throw new Error(`Archetype "${p.id}" names unknown plan "${p.planId}"`);
  }
  if (ARCHETYPE_BY_PLAN && Object.keys(ARCHETYPE_BY_PLAN).length !== ARCHETYPE_ROSTER.length) {
    throw new Error("Two archetypes share a training plan — the mapping must be 1:1");
  }
  for (const planId of planIds) {
    if (!ARCHETYPE_BY_PLAN[planId]) throw new Error(`Training plan "${planId}" has no archetype`);
  }
  const ids = new Set(ARCHETYPE_ROSTER.map((p) => p.id));
  if (ids.size !== ARCHETYPE_ROSTER.length) throw new Error("Duplicate archetype id");
  const names = new Set(ARCHETYPE_ROSTER.map((p) => p.name));
  if (names.size !== ARCHETYPE_ROSTER.length) throw new Error("Duplicate archetype name");
  // The icon path is derived from the name, so a name that isn't a legal, plain
  // filename would produce a URL that silently 404s in the browser.
  for (const p of ARCHETYPE_ROSTER) {
    if (!/^[A-Za-z][A-Za-z ]*$/.test(p.name)) {
      throw new Error(`Archetype name "${p.name}" can't be an icon filename`);
    }
  }
  // An override keyed on a typo'd id would silently never apply — the archetype
  // would quietly take its class average and nothing would ever report it.
  for (const id of Object.keys(ARCHETYPE_OVERRIDE)) {
    if (!ARCHETYPE_MAP[id]) throw new Error(`Archetype override names unknown archetype "${id}"`);
  }
  // Every archetype must resolve to a profile with a real plan-derived emphasis;
  // a flat one means the 1:1 mapping broke without the checks above catching it.
  for (const p of ARCHETYPE_ROSTER) {
    const prof = ARCHETYPE_PROFILE[p.id];
    if (!prof) throw new Error(`Archetype "${p.id}" has no resolved profile`);
    const spread = Math.max(...ATTR_KEYS.map((k) => prof.attrProfile[k]));
    if (!(spread > OTHER_SHARE)) {
      throw new Error(`Archetype "${p.id}" has a flat attribute profile — plan weights missing`);
    }
  }

  // ── The style table's three fairness rules (v1.78) ───────────────────────
  // Cheap enough to run at module load, and a violation is the kind of bug that
  // would otherwise only show up as "everyone builds Engines" ten hours into a
  // save. The (style, position) buildability rule needs the roster cross-check
  // and lives in `npm run verify:archetypes:tactics`.
  for (const cls of ARCHETYPE_CLASS_ORDER) {
    const sum = CLASS_STYLE_ROW[cls].reduce((a, b) => a + b, 0);
    if (Math.abs(sum) > 1) {
      throw new Error(`Class "${cls}" style row sums to ${sum}, not 0 — it is worth more than its peers for existing`);
    }
  }
  for (const cls of ARCHETYPE_CLASS_ORDER) {
    const wins = STYLE_ORDER.some((_, i) => {
      const v = CLASS_STYLE_ROW[cls][i];
      return ARCHETYPE_CLASS_ORDER.every((o) => o === cls || CLASS_STYLE_ROW[o][i] < v);
    });
    if (!wins) throw new Error(`Class "${cls}" is not the strict best at any style — nobody would build around it`);
  }
  for (const a of ARCHETYPE_CLASS_ORDER) {
    for (const b of ARCHETYPE_CLASS_ORDER) {
      if (a === b) continue;
      const ge = CLASS_STYLE_ROW[b].every((v, i) => v >= CLASS_STYLE_ROW[a][i]);
      const gt = CLASS_STYLE_ROW[b].some((v, i) => v > CLASS_STYLE_ROW[a][i]);
      if (ge && gt) throw new Error(`Class "${a}" is dominated by "${b}" — strictly worse at every style`);
    }
  }

  // ── The instruction table's balance rule (v1.78) ─────────────────────────
  // Every named axis needs BOTH a like and a dislike, or the row is
  // structurally advantaged — see the long note on ARCHETYPE_INSTRUCTIONS. This
  // is the cheap structural half; the verify script proves the consequence
  // (mean score exactly 0 across all 405 setups).
  for (const id of Object.keys(ARCHETYPE_INSTRUCTIONS)) {
    if (!ARCHETYPE_MAP[id]) throw new Error(`Instruction row names unknown archetype "${id}"`);
  }
  for (const p of ARCHETYPE_ROSTER) {
    const prefs = ARCHETYPE_PROFILE[p.id]?.instructionPrefs ?? {};
    for (const [axis, pref] of Object.entries(prefs) as [string, AxisPref<string>][]) {
      if (!pref.likes?.length || !pref.dislikes?.length) {
        throw new Error(
          `Archetype "${p.id}" names "${axis}" without both a like and a dislike — unbalanced rows skew the whole system`
        );
      }
    }
  }
}

// Re-exported so callers that only need the tier shares don't reach into the
// training table for them.
export { PRIMARY_SHARE, SECONDARY_SHARE };
