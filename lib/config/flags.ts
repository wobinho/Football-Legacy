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

/** Full country name (as stored on leagues) → flag file basename. */
const COUNTRY_TO_FLAG: Record<string, string> = {
  England: "gb-eng",
  Scotland: "gb-sct",
  Wales: "gb-wls",
  "Northern Ireland": "gb-nir",
  Spain: "es",
  Italy: "it",
  Germany: "de",
  France: "fr",
  Netherlands: "nl",
  Brazil: "br",
  Argentina: "ar",
  Portugal: "pt",
  Belgium: "be",
  Sweden: "se",
  Nigeria: "ng",
  // Preset-database countries
  "United States": "us",
  USA: "us",
  Turkey: "tr",
  "Türkiye": "tr",
};

/** URL for a player's nationality flag, or null if unmapped. */
export function flagForNat(nat: string): string | null {
  const code = NAT_TO_FLAG[nat?.toUpperCase()];
  return code ? `/flags/${code}.svg` : null;
}

/** URL for a league/team country flag, or null if unmapped. */
export function flagForCountry(country: string): string | null {
  const code = COUNTRY_TO_FLAG[country];
  return code ? `/flags/${code}.svg` : null;
}
