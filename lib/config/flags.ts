// Nationality / country → flag asset mapping. Pure data.
//
// Players store a 3-letter nationality code (ENG, ESP, …); leagues store a
// country name ("England", "Spain", …). Flag SVGs live in /public/flags and are
// named by 2-letter ISO code (es.svg, it.svg) with a handful of GB sub-flags
// (gb-eng, gb-sct, gb-wls). This module is the single lookup both use so the
// engine/UI never hard-code a filename.
//
// Codes follow the FIFA/football convention (ALG, NED, POR, …), which differs
// from ISO in many cases — the tables below translate to the ISO flag basename.
// Every entry here is verified against an SVG that exists in /public/flags.

/** 3-letter nationality code → flag file basename (no extension). */
const NAT_TO_FLAG: Record<string, string> = {
  // Home nations & their sub-flags
  ENG: "gb-eng",
  SCO: "gb-sct",
  WAL: "gb-wls",
  NIR: "gb-nir",
  // Europe
  ESP: "es",
  ITA: "it",
  GER: "de",
  FRA: "fr",
  NED: "nl",
  POR: "pt",
  BEL: "be",
  SWE: "se",
  DEN: "dk",
  NOR: "no",
  POL: "pl",
  CRO: "hr",
  SUI: "ch",
  AUT: "at",
  TUR: "tr",
  GRE: "gr",
  RUS: "ru",
  UKR: "ua",
  IRL: "ie",
  SRB: "rs",
  CZE: "cz",
  SVK: "sk",
  HUN: "hu",
  ROU: "ro",
  BUL: "bg",
  SVN: "si",
  ISL: "is",
  FIN: "fi",
  ALB: "al",
  ARM: "am",
  AZE: "az",
  BIH: "ba",
  BLR: "by",
  CYP: "cy",
  EST: "ee",
  GEO: "ge",
  KVX: "xk", // Kosovo
  LTU: "lt",
  LUX: "lu",
  LVA: "lv",
  MDA: "md",
  MKD: "mk", // North Macedonia
  MNE: "me",
  // Africa
  NGA: "ng",
  SEN: "sn",
  GHA: "gh",
  CIV: "ci",
  CMR: "cm",
  MAR: "ma",
  EGY: "eg",
  ALG: "dz", // Algeria
  TUN: "tn",
  ANG: "ao", // Angola
  BDI: "bi", // Burundi
  BEN: "bj", // Benin
  BFA: "bf", // Burkina Faso
  CGO: "cg", // Congo
  COD: "cd", // DR Congo
  COM: "km", // Comoros
  CPV: "cv", // Cape Verde
  CTA: "cf", // Central African Republic
  EQG: "gq", // Equatorial Guinea
  ETH: "et",
  GAB: "ga",
  GAM: "gm", // Gambia
  GNB: "gw", // Guinea-Bissau
  GUI: "gn", // Guinea
  KEN: "ke",
  LBY: "ly", // Libya
  MAD: "mg", // Madagascar
  MLI: "ml",
  MOZ: "mz", // Mozambique
  MTN: "mr", // Mauritania
  NIG: "ne", // Niger
  RSA: "za", // South Africa
  SLE: "sl", // Sierra Leone
  SOM: "so",
  TAN: "tz", // Tanzania
  TOG: "tg",
  UGA: "ug",
  ZAM: "zm", // Zambia
  ZIM: "zw", // Zimbabwe
  CHA: "td", // Chad
  // Americas
  BRA: "br",
  ARG: "ar",
  USA: "us",
  MEX: "mx",
  CAN: "ca",
  COL: "co",
  URU: "uy",
  CHI: "cl", // Chile
  PER: "pe",
  ECU: "ec",
  BOL: "bo",
  PAR: "py",
  VEN: "ve",
  CRC: "cr", // Costa Rica
  HON: "hn", // Honduras
  PAN: "pa",
  GUA: "gt", // Guatemala
  SLV: "sv", // El Salvador
  DOM: "do", // Dominican Republic
  JAM: "jm",
  TRI: "tt", // Trinidad and Tobago
  HAI: "ht",
  ATG: "ag", // Antigua and Barbuda
  GRN: "gd", // Grenada
  GUY: "gy",
  LCA: "lc", // Saint Lucia
  PUR: "pr", // Puerto Rico
  STV: "vc", // Saint Vincent and the Grenadines
  SUR: "sr", // Suriname
  CUW: "cw", // Curaçao
  GLP: "gp", // Guadeloupe
  GUF: "gf", // French Guiana
  MTQ: "mq", // Martinique
  // Asia & Oceania
  JPN: "jp",
  KOR: "kr",
  AUS: "au",
  CHN: "cn",
  IRN: "ir",
  IRQ: "iq",
  KSA: "sa", // Saudi Arabia
  ISR: "il",
  JOR: "jo",
  SYR: "sy",
  PLE: "ps", // Palestine
  IDN: "id",
  PHI: "ph", // Philippines
  NZL: "nz",
  UZB: "uz", // Uzbekistan
};

/** Full country name (as stored on leagues) → flag file basename.
 *
 * Every country the shipped databases can produce must appear here, under every
 * spelling it can arrive as: a preset's own `name` field (which follows the FC
 * source's conventions — "China PR", "Korea Republic", "Czechia") often differs
 * from the everyday name a generated league or a hand-authored club carries. A
 * name that misses this table renders no flag at all, which is what made the
 * country picker look half-finished, so both spellings are mapped side by side.
 *
 * Keys are matched case-insensitively and after trimming (see `flagForCountry`),
 * so casing/whitespace drift in a modded database can't knock a flag out. */
const COUNTRY_TO_FLAG: Record<string, string> = {
  // Home nations & their sub-flags
  England: "gb-eng",
  Scotland: "gb-sct",
  Wales: "gb-wls",
  "Northern Ireland": "gb-nir",
  "Republic of Ireland": "ie",
  Ireland: "ie",
  "United Kingdom": "gb",
  // Europe
  Spain: "es",
  Italy: "it",
  Germany: "de",
  France: "fr",
  Netherlands: "nl",
  Holland: "nl",
  Portugal: "pt",
  Belgium: "be",
  Sweden: "se",
  Norway: "no",
  Denmark: "dk",
  Finland: "fi",
  Iceland: "is",
  Poland: "pl",
  Austria: "at",
  Switzerland: "ch",
  Croatia: "hr",
  Serbia: "rs",
  Slovenia: "si",
  Slovakia: "sk",
  Czechia: "cz",
  "Czech Republic": "cz",
  Hungary: "hu",
  Romania: "ro",
  Bulgaria: "bg",
  Greece: "gr",
  Turkey: "tr",
  "Türkiye": "tr",
  Turkiye: "tr",
  Russia: "ru",
  Ukraine: "ua",
  Belarus: "by",
  Cyprus: "cy",
  Albania: "al",
  "Bosnia and Herzegovina": "ba",
  "North Macedonia": "mk",
  Montenegro: "me",
  Kosovo: "xk",
  Moldova: "md",
  Estonia: "ee",
  Latvia: "lv",
  Lithuania: "lt",
  Luxembourg: "lu",
  Malta: "mt",
  Georgia: "ge",
  Armenia: "am",
  Azerbaijan: "az",
  Kazakhstan: "kz",
  Israel: "il",
  // Americas
  Brazil: "br",
  Argentina: "ar",
  Uruguay: "uy",
  Paraguay: "py",
  Chile: "cl",
  Peru: "pe",
  Bolivia: "bo",
  Ecuador: "ec",
  Colombia: "co",
  Venezuela: "ve",
  Mexico: "mx",
  "United States": "us",
  "United States of America": "us",
  USA: "us",
  Canada: "ca",
  "Costa Rica": "cr",
  Honduras: "hn",
  Panama: "pa",
  Guatemala: "gt",
  Jamaica: "jm",
  // Africa
  Nigeria: "ng",
  Ghana: "gh",
  Senegal: "sn",
  "Ivory Coast": "ci",
  "Côte d'Ivoire": "ci",
  Cameroon: "cm",
  Morocco: "ma",
  Algeria: "dz",
  Tunisia: "tn",
  Egypt: "eg",
  "South Africa": "za",
  Kenya: "ke",
  // Asia & Oceania
  Japan: "jp",
  "South Korea": "kr",
  "Korea Republic": "kr",
  "Korea, South": "kr",
  "North Korea": "kp",
  "Korea DPR": "kp",
  China: "cn",
  "China PR": "cn",
  India: "in",
  Indonesia: "id",
  Thailand: "th",
  Vietnam: "vn",
  Malaysia: "my",
  Singapore: "sg",
  Philippines: "ph",
  Australia: "au",
  "New Zealand": "nz",
  "Saudi Arabia": "sa",
  "United Arab Emirates": "ae",
  UAE: "ae",
  Qatar: "qa",
  Kuwait: "kw",
  Bahrain: "bh",
  Oman: "om",
  Jordan: "jo",
  Iran: "ir",
  "Iran Islamic Republic": "ir",
  Iraq: "iq",
  Uzbekistan: "uz",
};

/** Case/whitespace-insensitive lookup table, built once from the map above. */
const COUNTRY_TO_FLAG_NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_TO_FLAG).map(([name, code]) => [name.trim().toLowerCase(), code])
);

/** 3-letter country code → flag basename, for the places that hold a database
 * code rather than a display name (the preset picker, save metadata). Falls back
 * through the nationality table, which already covers most codes. */
const COUNTRY_CODE_TO_FLAG: Record<string, string> = {
  UAE: "ae",
  KAZ: "kz",
  IND: "in",
  THA: "th",
  VIE: "vn",
  MAS: "my",
  SGP: "sg",
  QAT: "qa",
  KUW: "kw",
  BHR: "bh",
  OMA: "om",
  BUL: "bg",
};

/** URL for a player's nationality flag, or null if unmapped. */
export function flagForNat(nat: string): string | null {
  const code = NAT_TO_FLAG[nat?.toUpperCase()];
  return code ? `/flags/${code}.svg` : null;
}

/** URL for a league/team country flag, or null if unmapped.
 *
 * Accepts either a display name ("Korea Republic", "türkiye") or a 3-letter
 * database code ("KOR", "UAE") — the country picker holds codes while leagues
 * hold names, and both render the same chip. */
export function flagForCountry(country: string): string | null {
  if (!country) return null;
  const key = country.trim();
  const byName = COUNTRY_TO_FLAG_NORMALIZED[key.toLowerCase()];
  if (byName) return `/flags/${byName}.svg`;
  // A bare 3-letter code: our own table first, then the nationality codes (which
  // already cover ENG/ESP/BRA/… and share the football-code convention).
  if (key.length === 3) {
    const upper = key.toUpperCase();
    const code = COUNTRY_CODE_TO_FLAG[upper] ?? NAT_TO_FLAG[upper];
    if (code) return `/flags/${code}.svg`;
  }
  return null;
}
