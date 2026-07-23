"use client";

// End-of-season contract round (§10, v1.51).
//
// The dead week between the awards and END SEASON is where the club settles its
// own expiring deals. Every player whose contract runs out this summer gets one
// row: agree new terms, or let him walk on a free. Nothing is applied until the
// rollover — the wage bill only moves when the new season actually starts — so a
// decision here is a commitment, not an immediate transaction.
//
// This exists because the old behaviour released the lot silently at the
// rollover and told the manager afterwards. The whole point of the screen is
// that losing a player has to be a choice.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { ExpiringContract, PlayerBio } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { wageDemandWithClause, maxLengthFor } from "@/lib/contracts";
import { formatMoney } from "@/lib/value";
import { GhostButton, GoldButton, Modal, Ovr, PosBadge, displayFullName } from "../ui";
import ReleaseClauseField from "./ReleaseClauseField";

export default function ContractRoundModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const resolve = useGame((s) => s.resolveContract);
  const res = game.contractResolution;

  // The row currently being negotiated, if any. Renewals open an inline terms
  // panel rather than a second modal — stacking dialogs over a list the manager
  // is working through would lose their place in it.
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!res) return [];
    return res.items
      .map((item) => ({ item, p: game.players[item.playerId] }))
      .filter((r): r is { item: ExpiringContract; p: PlayerBio } => !!r.p && !r.p.retired);
  }, [res, game]);

  if (!res || !rows.length) return null;

  const undecided = rows.filter((r) => r.item.decision === "undecided").length;
  const wageBill = game.teams[game.userTeamId].playerIds
    .map((id) => game.players[id])
    .reduce((n, p) => n + (p?.contract?.wage ?? 0), 0);

  return (
    <Modal title="Contracts — end of season" onClose={onClose} size="lg">
      <p className="mb-4 text-sm leading-relaxed text-dim">
        {rows.length === 1 ? "One player is" : `${rows.length} players are`} out of contract this summer.
        Agree new terms or let them leave on a free. Nothing changes until the season rolls over —
        <span className="text-ink"> anyone still undecided at END SEASON walks away for nothing.</span>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-line bg-raised px-3 py-2 text-xs">
        <span className="text-faint">
          Undecided <span className={`tnum font-semibold ${undecided ? "text-gold" : "text-ink"}`}>{undecided}</span>
        </span>
        <span className="text-faint">
          Current wage bill <span className="tnum font-semibold text-ink">{formatMoney(wageBill)}/wk</span>
        </span>
      </div>

      <div className="space-y-2">
        {rows.map(({ item, p }) => (
          <ContractRow
            key={p.id}
            p={p}
            item={item}
            editing={editing === p.id}
            onEdit={() => setEditing(editing === p.id ? null : p.id)}
            onDecide={(decision, terms) => {
              resolve(p.id, decision, terms);
              setEditing(null);
            }}
          />
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <GoldButton onClick={onClose} className="!py-1.5">
          {undecided ? "COME BACK TO THIS" : "DONE"}
        </GoldButton>
      </div>
    </Modal>
  );
}

/** One expiring deal: the player, what he's on now, and the two ways out. */
function ContractRow({
  p,
  item,
  editing,
  onEdit,
  onDecide,
}: {
  p: PlayerBio;
  item: ExpiringContract;
  editing: boolean;
  onEdit: () => void;
  onDecide: (decision: "renew" | "release", terms?: { wage: number; years: number; releaseClause?: number }) => void;
}) {
  const decided = item.decision !== "undecided";
  // A settled row dims down so the eye goes straight to what's left to do.
  const tone =
    item.decision === "renew"
      ? "border-win/40 bg-win/5"
      : item.decision === "release"
        ? "border-loss/30 bg-loss/5"
        : "border-line bg-raised";

  return (
    <div className={`rounded-md border px-3 py-2.5 transition-colors ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Ovr value={p.overall} size="sm" />
        <PosBadge pos={p.positions[0]} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{displayFullName(p)}</div>
          <div className="text-[11px] text-faint">
            {p.age}y · {item.academy ? "Academy" : "Senior squad"}
            {p.contract ? ` · on ${formatMoney(p.contract.wage)}/wk` : ""}
          </div>
        </div>

        {decided ? (
          <div className="flex items-center gap-2">
            <span className={`display text-xs font-semibold ${item.decision === "renew" ? "text-win" : "text-loss"}`}>
              {item.decision === "renew"
                ? item.terms
                  ? `RE-SIGNED · ${formatMoney(item.terms.wage)}/wk · ${item.terms.years}yr`
                  : "RE-SIGNED"
                : "LEAVING ON A FREE"}
            </span>
            <button className="text-[11px] text-faint underline hover:text-dim" onClick={onEdit}>
              change
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="display rounded-md border border-gold-lo/50 px-3 py-1.5 text-xs font-bold tracking-wider text-gold hover:bg-hover"
            >
              OFFER TERMS
            </button>
            <button
              onClick={() => onDecide("release")}
              className="display rounded-md border border-line px-3 py-1.5 text-xs font-semibold tracking-wide text-dim hover:border-loss/50 hover:text-loss"
            >
              LET HIM GO
            </button>
          </div>
        )}
      </div>

      {editing && <TermsPanel p={p} item={item} onDecide={onDecide} onCancel={onEdit} />}
    </div>
  );
}

/** The inline negotiation for one renewal. Mirrors ContractModal's model — wage,
 * length, optional release clause, weighed against the player's demand — but
 * commits a DECISION rather than a contract, since nothing applies until the
 * rollover. */
function TermsPanel({
  p,
  item,
  onDecide,
  onCancel,
}: {
  p: PlayerBio;
  item: ExpiringContract;
  onDecide: (decision: "renew" | "release", terms?: { wage: number; years: number; releaseClause?: number }) => void;
  onCancel: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const negotiate = useGame((s) => s.negotiateContract);

  const [clause, setClause] = useState<number | null>(item.terms?.releaseClause ?? p.contract?.releaseClause ?? null);
  const demand = useMemo(() => wageDemandWithClause(game, p, clause ?? undefined, TUNING), [game, p, clause]);
  const maxYears = maxLengthFor(p, TUNING);
  const [wage, setWage] = useState(item.terms?.wage ?? demand);
  const [years, setYears] = useState(item.terms?.years ?? Math.min(TUNING.contractRenewYearsDefault, maxYears));
  const [feedback, setFeedback] = useState<string | null>(null);

  const submit = () => {
    const verdict = negotiate(p.id, wage, years, clause ?? undefined);
    if (verdict.kind === "accepted") {
      onDecide("renew", { wage, years, releaseClause: clause ?? undefined });
      return;
    }
    setFeedback(verdict.message);
    if (verdict.kind === "countered") setWage(verdict.wage);
  };

  return (
    <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[140px] flex-1">
          <span className="mb-1 block text-[11px] uppercase tracking-widest text-faint">Weekly wage</span>
          <input
            type="number"
            value={wage}
            min={500}
            step={500}
            onChange={(e) => setWage(Math.max(0, Number(e.target.value)))}
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 tnum text-sm focus:border-gold focus:outline-none"
          />
        </label>
        <div className="flex-1">
          <span className="mb-1 block text-[11px] uppercase tracking-widest text-faint">Length</span>
          <div className="flex gap-1">
            {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
              <button
                key={y}
                onClick={() => setYears(y)}
                className={`display flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
                  years === y ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
                }`}
              >
                {y}y
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-faint">
        <span>He&apos;s looking for around {formatMoney(demand)}/wk.</span>
        <button className="hover:text-dim" onClick={() => setWage(demand)}>
          Match demand
        </button>
      </div>

      <ReleaseClauseField
        p={p}
        clause={clause}
        onChange={(next) => {
          if (wage === demand) setWage(wageDemandWithClause(game, p, next ?? undefined, TUNING));
          setClause(next);
        }}
      />

      {feedback && <div className="rounded-md border border-line bg-surface p-2.5 text-xs text-dim">{feedback}</div>}

      <div className="flex justify-end gap-2">
        <GhostButton onClick={onCancel} className="!py-1 !text-xs">
          Cancel
        </GhostButton>
        <GoldButton onClick={submit} className="!py-1 !text-xs">
          OFFER {formatMoney(wage)}/wk
        </GoldButton>
      </div>
    </div>
  );
}
