"use client";

// The two "who gets him" choosers (v1.52).
//
// Listing a player used to be a visibility flag: tick a box, then wait and hope
// the weekly AI tick produced something. That reads as nothing happening, and it
// left the manager with no say in WHERE a player went. Both moves now resolve on
// the spot, the way the academy loan chooser has since v1.44 — the game works
// out which clubs would genuinely take him, and the manager picks one.
//
// Neither modal invents a market: the suitors come from `saleSuitors` /
// `academyLoanSuitors` in lib, which run the same needs/affordability model the
// AI applies to itself. The UI only renders the answer.

import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import { academyLoanSuitors } from "@/lib/academy";
import { saleSuitors } from "@/lib/transfers";
import { formatMoney } from "@/lib/value";
import { Card, CountryFlag, Crest, Flag, GoldButton, Modal, Ovr, PosBadge } from "../ui";

/** The player's identity line, shared by both choosers so the two modals read as
 * one feature rather than two screens that happen to be adjacent. */
function PlayerHeader({ playerId, blurb }: { playerId: string; blurb: string }) {
  const game = useGame((s) => s.game)!;
  const p = game.players[playerId];
  if (!p) return null;
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <PosBadge pos={p.positions[0]} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Flag nat={p.nationality} size={11} />
          <span className="truncate font-semibold text-ink">{p.name}</span>
          <span className="tnum text-sm text-dim">· {p.age}y</span>
          <Ovr value={p.overall} size="sm" />
        </div>
        <div className="text-[11px] text-faint">{blurb}</div>
      </div>
    </div>
  );
}

/**
 * "Sell Player": the clubs that would buy him today, and what each would pay.
 *
 * The list is ordered by money, because that is the decision — but each row also
 * says where he'd stand in that squad, so selling a young player to a club that
 * will actually play him is a legible choice against a bigger cheque elsewhere.
 */
export function SellPlayerModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sell = useGame((s) => s.sellPlayerTo);
  const p = game.players[playerId];
  // Deterministic per player/day, so the offers hold still while the modal is up.
  const suitors = useMemo(() => saleSuitors(game, playerId, TUNING), [game, playerId]);

  if (!p) return null;

  return (
    <Modal title="Sell Player" onClose={onClose}>
      <PlayerHeader
        playerId={playerId}
        blurb={`Clubs willing to buy him now. Valued at ${formatMoney(p.value)}.`}
      />

      {suitors.length === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-faint">
          No club can meet his price and wages right now — try again next window, or negotiate an
          incoming offer if one arrives.
        </Card>
      ) : (
        <div className="space-y-2">
          {suitors.map((s) => (
            <div
              key={s.clubId}
              className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
            >
              <Crest colors={s.colors} short={s.short} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{s.name}</div>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                  <CountryFlag country={s.country} size={10} className="shrink-0" />
                  <span className="truncate">
                    {s.leagueName} · needs a {s.needPos}
                  </span>
                </div>
              </div>
              <span
                className={`display shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${
                  s.role === "Key signing"
                    ? "border-gold-lo/60 text-gold"
                    : s.role === "Starter"
                      ? "border-win/40 text-win"
                      : "border-line text-dim"
                }`}
              >
                {s.role}
              </span>
              <span className="display tnum shrink-0 text-sm font-semibold text-ink">
                {formatMoney(s.fee)}
              </span>
              <GoldButton
                onClick={() => {
                  sell(playerId, s.clubId);
                  onClose();
                }}
                className="!py-1 text-xs"
              >
                Sell
              </GoldButton>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * "Send on Loan": the clubs that would take him for the season.
 *
 * The parent club keeps paying the wages, so no suitor is ever priced out — the
 * only thing that varies is FIT, and the role badge is the whole pitch. A club
 * that will start him every week is worth far more to a young player's
 * development than a bigger name that would rotate him.
 */
export function LoanOfferModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const send = useGame((s) => s.academySendLoan);
  const p = game.players[playerId];
  const suitors = useMemo(() => academyLoanSuitors(game, playerId, TUNING), [game, playerId]);

  if (!p) return null;

  return (
    <Modal title="Send on Loan" onClose={onClose}>
      <PlayerHeader
        playerId={playerId}
        blurb="Clubs that want him for regular football. You keep paying his wages."
      />

      {suitors.length === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-faint">
          No club is looking for a loanee like him right now — try again next window.
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {suitors.map((s) => (
              <div
                key={s.clubId}
                className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
              >
                <Crest colors={s.colors} short={s.short} size={30} />
                <div className="min-w-0 flex-1">
                  {/* Suitors come from every league in the world, so the country
                      flag is what separates a loan down the road from a loan
                      abroad at a glance. */}
                  <div className="truncate font-medium text-ink">{s.name}</div>
                  <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                    <CountryFlag country={s.country} size={10} className="shrink-0" />
                    <span className="truncate">
                      {s.leagueName} · Rep {s.reputation}
                    </span>
                  </div>
                </div>
                <span
                  className={`display shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${
                    s.role === "Regular starter" ? "border-win/40 text-win" : "border-line text-dim"
                  }`}
                >
                  {s.role}
                </span>
                <GoldButton
                  onClick={() => {
                    send(playerId, s.clubId);
                    onClose();
                  }}
                  className="!py-1 text-xs"
                >
                  Send
                </GoldButton>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            A loan is the substitute for first-team minutes: a club that will play him every week
            develops him almost as well as playing here would, and far better than a season on our
            bench. A rotation move is worth noticeably less.
          </p>
        </>
      )}
    </Modal>
  );
}
