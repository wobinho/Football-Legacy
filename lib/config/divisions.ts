// ── Procedural lower divisions (v12) ──────────────────────────────────────
// A country's database may only author a top flight (most do — only England
// ships a real tier 2). To let a save run a 2- or 3-tier ladder with working
// promotion/relegation, the missing tiers are generated here: club names built
// from per-country town/suffix pools, reputations scaled down per tier, and
// colours drawn from a fixed palette.
//
// Pure data + deterministic construction, no engine logic. Given the same
// country code, tier and index the output is always identical, so a generated
// tier-3 club is as stable across saves as an authored one.

import type { ClubDef } from "./names";
import { mulberry32, deriveSeed, pick, type RNG } from "../rng";

/** Default tier names, indexed by tier (1-based). Used when the player doesn't
 * name a division at setup. Tier 1 always comes from the authored database. */
export const DEFAULT_TIER_NAMES = ["", "First Division", "Second Division", "Third Division", "Fourth Division"];

/** How many divisions deep a single country may go. Raised to 4 in v1.47: the
 * shipped English database authors the real four-tier pyramid (Premier League →
 * League Two), and a cap of 3 silently dropped the bottom division. */
export const MAX_DIVISION_DEPTH = 4;

/** Clubs per generated division. Matches the authored divisions' size, which
 * keeps a generated tier the same length of season as an authored one — since
 * v1.91 the calendar sizes itself to each division's club count, so an odd size
 * here would work, it would just make one tier's season longer than its
 * neighbours' for no reason. */
export const GENERATED_DIVISION_SIZE = 20;

/**
 * Below this many clubs, a division is topped up with generated sides (v1.72).
 *
 * Several shipped databases author only a token top flight — four or six real
 * clubs — because that is all the source CSV covers. A four-club league is not a
 * league: it plays a handful of fixtures, the table is meaningless, and the
 * transfer market has nowhere to go. Any authored division under this threshold
 * is filled out to `TOPPED_UP_DIVISION_SIZE` with procedurally generated clubs,
 * so every country is playable no matter how thin its database is.
 *
 * A division at or above the threshold is left exactly as authored — a real
 * 18-club league is never padded.
 */
export const MIN_AUTHORED_DIVISION_SIZE = 10;

/** What a topped-up division is filled out to. Even, and large enough for a
 * proper double round-robin, without pretending to be a full 20-club league. */
export const TOPPED_UP_DIVISION_SIZE = 16;

/** Reputation band per tier. Tier 1 clubs sit ~64–90 (authored); each step down
 * drops the band so a third-tier side is a genuine minnow and the ladder reads
 * as a real pyramid. */
const TIER_REP_BAND: Record<number, [number, number]> = {
  2: [44, 62],
  3: [28, 45],
  4: [18, 32],
};

/** Town/place-name pools per country. Generated clubs pair one of these with a
 * suffix, giving plausible lower-league names without new authored rosters. */
const TOWN_POOLS: Record<string, string[]> = {
  ENG: ["Barnsley", "Rochdale", "Carlisle", "Grimsby", "Exeter", "Shrewsbury", "Colchester", "Crewe", "Morecambe", "Yeovil", "Rotherham", "Walsall", "Gillingham", "Northampton", "Mansfield", "Tranmere", "Doncaster", "Wigan", "Burton", "Fleetwood", "Accrington", "Scunthorpe", "Chesterfield", "Halifax"],
  ESP: ["Alaves", "Elche", "Leganes", "Huesca", "Eibar", "Albacete", "Burgos", "Cartagena", "Ponferrada", "Lugo", "Mirandes", "Amorebieta", "Andorra", "Tenerife", "Oviedo", "Sporting Gijon", "Zaragoza", "Racing Santander", "Alcorcon", "Fuenlabrada", "Castellon", "Sabadell", "Logrones", "Ferrol"],
  ITA: ["Cremona", "Frosinone", "Benevento", "Ascoli", "Cosenza", "Perugia", "Ternana", "Reggiana", "Modena", "Pisa", "Spezia", "Cittadella", "Brescia", "Como", "Bari", "Palermo", "Catanzaro", "Lecco", "Feralpi", "Sudtirol", "Venezia", "Parma", "Pescara", "Avellino"],
  GER: ["Paderborn", "Sandhausen", "Aue", "Rostock", "Regensburg", "Karlsruhe", "Heidenheim", "Kiel", "Darmstadt", "Magdeburg", "Braunschweig", "Osnabruck", "Wehen", "Elversberg", "Ulm", "Munster", "Essen", "Dresden", "Saarbrucken", "Verl", "Unterhaching", "Aachen", "Duisburg", "Bielefeld"],
  FRA: ["Amiens", "Caen", "Dijon", "Guingamp", "Laval", "Niort", "Pau", "Rodez", "Valenciennes", "Grenoble", "Annecy", "Bastia", "Concarneau", "Quevilly", "Troyes", "Ajaccio", "Angers", "Bordeaux", "Dunkerque", "Martigues", "Red Star", "Clermont", "Nancy", "Sochaux"],
  NED: ["Cambuur", "Emmen", "Excelsior", "Roda", "Venlo", "Dordrecht", "Eindhoven", "Helmond", "Telstar", "Volendam", "Willem", "Almere", "Groningen", "Maastricht", "Oss", "Den Bosch", "Jong Ajax", "Vitesse", "Zwolle", "Deventer", "Breda", "Nijmegen", "Leeuwarden", "Utrecht"],
  POR: ["Chaves", "Feirense", "Leiria", "Mafra", "Nacional", "Penafiel", "Tondela", "Torreense", "Trofense", "Academico", "Belenenses", "Farense", "Estrela", "Oliveirense", "Varzim", "Vizela", "Moreirense", "Portimonense", "Rio Ave", "Santa Clara", "Covilha", "Alverca", "Marinhense", "Lusitano"],
  BRA: ["Guarani", "Ponte Preta", "Novorizontino", "Mirassol", "Ituano", "Chapecoense", "Criciuma", "Avai", "Brusque", "Londrina", "Operario", "Tombense", "Vila Nova", "Goianiense", "Sampaio", "Paysandu", "Remo", "Nautico", "Sport", "CRB", "ABC", "Botafogo SP", "Juventude", "Ceara"],
  ARG: ["Quilmes", "Ferro", "Almagro", "Chacarita", "Temperley", "Nueva Chicago", "Deportivo Moron", "San Martin", "Atlanta", "Estudiantes BA", "Guillermo Brown", "Alvarado", "Riestra", "Gimnasia Mendoza", "Chaco", "Mitre", "Agropecuario", "Guemes", "Defensores", "Tristan Suarez", "Flandria", "Colegiales", "Talleres RE", "Villa Dalmine"],
  SWE: ["Brommapojkarna", "Vasteras", "Orgryte", "Landskrona", "Trelleborg", "Utsikten", "Skovde", "Sandviken", "Oster", "Helsingborg", "Jonkoping", "Umea", "Dalkurd", "Norrby", "Falkenberg", "Orebro", "Varnamo", "Halmstad", "Sundsvall", "Kalmar", "Gefle", "Akropolis", "Sirius", "Degerfors"],
  NGA: ["Enyimba", "Kano Pillars", "Rangers", "Plateau", "Akwa", "Lobi", "Nasarawa", "Sunshine", "Warri", "Abia", "Katsina", "Gombe", "Bendel", "Bayelsa", "Doma", "Remo Stars", "Shooting", "Heartland", "Niger Tornadoes", "Kwara", "Sporting Lagos", "Ikorodu", "Dakkada", "El-Kanemi"],
};

/** Fallback pool for a country with no town list (custom uploads, new codes). */
const GENERIC_TOWNS = ["Northport", "Eastvale", "Westbrook", "Southfield", "Kingsbridge", "Redhill", "Stonebury", "Fairhaven", "Oakford", "Millbrook", "Ashworth", "Brookvale", "Highmoor", "Lakeside", "Ironhill", "Whitcombe", "Elmsworth", "Draycott", "Netherby", "Harrowgate", "Castleton", "Marshend", "Pinevale", "Thornwick"];

/** Suffixes paired with a town. Weighted toward humble lower-league flavour. */
const SUFFIXES = ["Town", "Rovers", "County", "United", "Athletic", "City", "Albion", "Wanderers", "Borough", "Rangers"];

/** Stadium name parts — a lower-division ground, not a bowl. */
const GROUND_WORDS = ["Park", "Road", "Lane", "Ground", "Field", "Meadow", "Terrace", "Green"];

/** Colour palette for generated crests: [primary, secondary] pairs. */
const PALETTES: [string, string][] = [
  ["#1b458f", "#ffffff"], ["#c8102e", "#ffffff"], ["#006341", "#ffffff"],
  ["#fdb913", "#231f20"], ["#5b2b82", "#ffffff"], ["#e35205", "#1c1c1c"],
  ["#00a3e0", "#0b1f3a"], ["#8b1a1a", "#f2d600"], ["#0b0c0f", "#c0c0c0"],
  ["#2e7d32", "#f5f5f5"], ["#7a263a", "#1bb1e7"], ["#004b87", "#e4002b"],
];

/** A short code for a club name — first three letters of the town, uppercased,
 * de-duplicated against codes already issued in the same division. */
function shortCodeFor(town: string, taken: Set<string>): string {
  const base = town.replace(/[^a-zA-Z]/g, "").toUpperCase();
  let code = base.slice(0, 3).padEnd(3, "X");
  if (!taken.has(code)) return code;
  // collide → walk later letters of the town, then digits
  for (let i = 3; i < base.length; i++) {
    const alt = (base.slice(0, 2) + base[i]).padEnd(3, "X");
    if (!taken.has(alt)) return alt;
  }
  for (let d = 2; d < 10; d++) {
    const alt = base.slice(0, 2).padEnd(2, "X") + d;
    if (!taken.has(alt)) return alt;
  }
  return code;
}

function repForTier(rng: RNG, tier: number, index: number, size: number): number {
  const [lo, hi] = TIER_REP_BAND[tier] ?? TIER_REP_BAND[3];
  // Spread reputations across the band by league position so a generated
  // division has a natural favourite-to-minnow gradient, plus a little jitter.
  const t = size <= 1 ? 0.5 : index / (size - 1);
  const base = hi - (hi - lo) * t;
  return Math.round(Math.max(1, Math.min(100, base + (rng() * 4 - 2))));
}

/**
 * Build one procedural division for a country. Deterministic in
 * (worldSeed, countryCode, tier) — the same inputs always yield the same clubs.
 *
 * `exclude` holds names already used by the country's authored divisions, so a
 * generated tier never duplicates a real club's name.
 */
export function generateDivisionClubs(
  worldSeed: number,
  countryCode: string,
  tier: number,
  exclude: Set<string>,
  size: number = GENERATED_DIVISION_SIZE
): ClubDef[] {
  const rng = mulberry32(deriveSeed(worldSeed, `division:${countryCode}:${tier}`));
  const towns = TOWN_POOLS[countryCode] ?? GENERIC_TOWNS;
  const clubs: ClubDef[] = [];
  const takenShorts = new Set<string>();
  const usedNames = new Set<string>();
  // Walk the town pool in a seeded order so each tier of the same country draws
  // a different slice and no town appears twice in one division.
  const order = towns
    .map((t) => ({ t, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  let cursor = 0;
  while (clubs.length < size) {
    const town = order[cursor % order.length];
    const suffix = pick(rng, SUFFIXES);
    // A second lap around the pool needs a different suffix to stay unique.
    const name = `${town} ${suffix}`;
    cursor++;
    if (usedNames.has(name) || exclude.has(name)) {
      if (cursor > order.length * SUFFIXES.length) break; // pool exhausted
      continue;
    }
    usedNames.add(name);
    const short = shortCodeFor(town, takenShorts);
    takenShorts.add(short);
    clubs.push({
      name,
      short,
      colors: pick(rng, PALETTES),
      rep: repForTier(rng, tier, clubs.length, size),
      stadium: `${town} ${pick(rng, GROUND_WORDS)}`,
    });
  }
  // Strongest first, so repForTier's gradient matches the array order.
  return clubs.sort((a, b) => b.rep - a.rep);
}

/**
 * Fill a thin authored division out to a playable size (v1.72).
 *
 * A database that ships only four or six clubs for a country can't sustain a
 * season — so the authored clubs are kept exactly as they are and the remainder
 * of a `TOPPED_UP_DIVISION_SIZE` field is generated around them.
 *
 * The generated sides are deliberately the WEAKER half: their reputations are
 * banded beneath the lowest authored club, so a country's real clubs stay its
 * genuine elite and the filler reads as the rest of a domestic league rather
 * than as rivals dropped in from nowhere. Deterministic in
 * (worldSeed, countryCode, tier), like `generateDivisionClubs`.
 *
 * Returns the input untouched when the division is already big enough, so this
 * is safe to call on every division unconditionally.
 */
export function topUpDivisionClubs(
  worldSeed: number,
  countryCode: string,
  tier: number,
  authored: ClubDef[],
  exclude: Set<string>,
  targetSize: number = TOPPED_UP_DIVISION_SIZE
): ClubDef[] {
  if (authored.length >= MIN_AUTHORED_DIVISION_SIZE) return authored;
  const need = targetSize - authored.length;
  if (need <= 0) return authored;

  const taken = new Set([...exclude, ...authored.map((c) => c.name)]);
  // Generated at the tier BELOW this one, then squeezed under the authored
  // clubs: filler in a top flight should look like a promoted side, not like a
  // peer of the country's champions.
  const filler = generateDivisionClubs(worldSeed, countryCode, tier + 1, taken, need);

  const authoredFloor = authored.length
    ? Math.min(...authored.map((c) => c.rep ?? 50))
    : (TIER_REP_BAND[tier] ?? TIER_REP_BAND[3])[1];
  // Sit the filler in a band directly beneath the weakest authored club, spread
  // so the padded half still has its own favourite-to-minnow gradient.
  const hi = Math.max(2, authoredFloor - 2);
  const lo = Math.max(1, Math.round(hi * 0.55));
  const scaled = filler.map((c, i) => ({
    ...c,
    rep: Math.round(hi - (hi - lo) * (filler.length <= 1 ? 0.5 : i / (filler.length - 1))),
  }));

  return [...authored, ...scaled].sort((a, b) => (b.rep ?? 0) - (a.rep ?? 0));
}
