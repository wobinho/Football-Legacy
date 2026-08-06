// Setting a club's visual identity (v1.96) — the rules half of the Identity
// panel. React never decides who may re-brand what.

import type { GameState } from "../types";
import { normaliseBadge, type BadgeSpec } from "./badge";
import { normaliseKitSet, type KitSet } from "./kit";

export interface ClubIdentityEdit {
  badge?: BadgeSpec;
  kits?: KitSet;
}

/** Whether a club is one the manager is RESPONSIBLE for — his own, or one the
 * GCN owns. The default authority for `setClubIdentity`, and the thing every
 * in-world consequence of a re-brand should keep asking. */
export const runsClub = (state: GameState, clubId: string): boolean =>
  clubId === state.userTeamId || (state.gcn?.clubIds.includes(clubId) ?? false);

/**
 * Store an authored crest and/or kit set on a club.
 *
 * Two authorities, and the distinction is the design (v1.97). By default only
 * the clubs the manager RUNS may be re-branded — his own and the GCN's — because
 * a rival's crest is that club's business and a world where every identity is
 * yours to set is one you have to opt out of rather than one you were given.
 *
 * `allowAny` waives that, and is what the Identity screen's "edit other clubs"
 * mode passes. It is a COSMETIC authority deliberately kept out of the default
 * path rather than folded into it: nothing in the simulation reads a badge or a
 * kit, so re-branding a rival changes no rule and cannot be an exploit — but it
 * is still a different act from managing your own club, and a caller has to say
 * so. Anything that ever gains a game consequence must gate on `runsClub`, not
 * on this having been reachable.
 *
 * Passing `undefined` for either half CLEARS it, which is how "reset to the
 * generated crest" is expressed: the field goes away and `badgeFor` derives one
 * again. That is deliberately not the same as storing a copy of the generated
 * spec — a cleared club follows the generator if the generator ever improves,
 * a stored one is frozen forever.
 */
export function setClubIdentity(
  state: GameState,
  clubId: string,
  edit: ClubIdentityEdit,
  opts?: { allowAny?: boolean }
): string | void {
  const club = state.teams[clubId];
  if (!club) return "Unknown club.";
  if (!opts?.allowAny && !runsClub(state, clubId)) return "You can only re-brand clubs you run.";

  if ("badge" in edit) {
    if (edit.badge) club.badge = normaliseBadge(edit.badge);
    else delete club.badge;
  }
  if ("kits" in edit) {
    if (edit.kits) club.kits = normaliseKitSet(edit.kits);
    else delete club.kits;
  }
}
