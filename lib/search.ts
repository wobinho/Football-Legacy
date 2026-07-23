// ── Text search helpers ───────────────────────────────────────────────────
// Every name search in the game runs through here, so "Doue" finds "Doué" and
// "Sane" finds "Sané". The real-world databases carry properly-accented names
// (and full names with them), but a user typing into a search box is on a
// plain keyboard — matching only on the exact codepoints means the correct
// spelling is the one thing that fails to find the player.

/**
 * Fold a string to its searchable form: lowercased, accents stripped, trimmed.
 *
 * Uses NFD to split a letter from its combining marks, then drops the marks —
 * so "é" → "e", "ø" → "ø" (no decomposition exists, handled below), "ß" → "ss"
 * via the explicit table. The handful of letters Unicode can't decompose are
 * mapped by hand; everything else falls out of the normalisation for free.
 */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[łŁ]/g, "l")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ß]/g, "ss")
    .replace(/[þÞ]/g, "th")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .trim();
}

/**
 * Does `haystack` contain `needle`, ignoring case and accents? An empty needle
 * matches everything, which is what a blank search box should do.
 */
export function matchesText(haystack: string, needle: string): boolean {
  const q = foldText(needle);
  if (!q) return true;
  return foldText(haystack).includes(q);
}

/**
 * Does any of `haystacks` contain `needle`? The multi-field form every player
 * search wants: short name, full name, club, nationality — one query, several
 * places it might legitimately hit.
 */
export function matchesAny(haystacks: (string | undefined | null)[], needle: string): boolean {
  const q = foldText(needle);
  if (!q) return true;
  return haystacks.some((h) => (h ? foldText(h).includes(q) : false));
}

/**
 * Match a query against a player's identity: the abbreviated name a list shows
 * ("D. Doué") and the full name a database authored ("Désiré Doué"), if it has
 * one. Searching either form finds him, so a user can type the surname they
 * know without caring which form the screen happens to be rendering.
 */
export function matchesPlayerName(
  p: { name: string; fullName?: string },
  needle: string
): boolean {
  return matchesAny([p.name, p.fullName], needle);
}
