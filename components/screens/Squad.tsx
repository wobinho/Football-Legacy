"use client";

// Squad (§15.2): roster with fitness/form at a glance, sortable.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio } from "@/lib/types";
import { getArchetype } from "@/lib/config/archetypes";
import { POS_ORDER } from "@/lib/config/positions";
import { yearsLeft } from "@/lib/contracts";
import { formatMoney } from "@/lib/value";
import { ArchetypeIcon, FitnessBar, Flag, FormChip, Money, Ovr, PosBadge, Section } from "../ui";

type SortKey = "pos" | "name" | "age" | "overall" | "fitness" | "value" | "goals" | "apps" | "contract";

export default function SquadScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [sort, setSort] = useState<SortKey>("pos");
  const [desc, setDesc] = useState(false);

  const team = game.teams[game.userTeamId];
  const players = useMemo(() => {
    const list = team.playerIds.map((id) => game.players[id]).filter(Boolean);
    const dir = desc ? -1 : 1;
    const cmp: Record<SortKey, (a: PlayerBio, b: PlayerBio) => number> = {
      pos: (a, b) => POS_ORDER.indexOf(a.positions[0]) - POS_ORDER.indexOf(b.positions[0]) || b.overall - a.overall,
      name: (a, b) => a.name.localeCompare(b.name),
      age: (a, b) => a.age - b.age,
      overall: (a, b) => b.overall - a.overall,
      fitness: (a, b) => a.fitness - b.fitness,
      value: (a, b) => b.value - a.value,
      goals: (a, b) => b.stats.goals - a.stats.goals,
      apps: (a, b) => b.stats.apps - a.stats.apps,
      contract: (a, b) => yearsLeft(game, a) - yearsLeft(game, b) || (a.contract?.wage ?? 0) - (b.contract?.wage ?? 0),
    };
    return list.sort((a, b) => dir * cmp[sort](a, b));
  }, [team.playerIds, game.players, sort, desc, game]);

  const TH = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`cursor-pointer select-none px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-faint hover:text-dim ${className}`}
      onClick={() => {
        if (sort === k) setDesc(!desc);
        else {
          setSort(k);
          setDesc(false);
        }
      }}
    >
      {children}
      {sort === k && <span className="gold-text ml-1">{desc ? "▾" : "▴"}</span>}
    </th>
  );

  return (
    <Section
      title={`Squad — ${players.length} players`}
      right={
        <span className="text-xs text-faint">
          {[
            game.transferList.length ? `${game.transferList.length} transfer-listed` : "",
            game.academy.loanList.length ? `${game.academy.loanList.length} loan-listed` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      }
    >
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-line">
            <tr>
              <TH k="pos" className="text-left">Pos</TH>
              <TH k="name" className="text-left">Player</TH>
              <TH k="age">Age</TH>
              <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-widest text-faint">Archetype</th>
              <TH k="overall">Ovr</TH>
              <TH k="fitness" className="text-left">Fitness</TH>
              <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-faint">Form</th>
              <TH k="apps">Apps</TH>
              <TH k="goals">G / A</TH>
              <TH k="value" className="text-right">Value</TH>
              <TH k="contract" className="text-right">Contract</TH>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.id}
                onClick={() => viewPlayer(p.id)}
                className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-hover"
              >
                <td className="px-2 py-2">
                  <PosBadge pos={p.positions[0]} />
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <Flag nat={p.nationality} size={14} />
                    <span className="font-medium">{p.name}</span>
                    {game.transferList.includes(p.id) && <span className="text-[10px] text-gold">LISTED</span>}
                    {!p.loan && game.academy.loanList.includes(p.id) && (
                      <span className="text-[10px] text-win">LOAN-LISTED</span>
                    )}
                    {p.loan && <span className="text-[10px] text-win">ON LOAN · {game.teams[p.loan.toClubId]?.short}</span>}
                    {p.traits.length > 0 && <span className="text-[10px] text-faint">{"◆".repeat(p.traits.length)}</span>}
                  </span>
                </td>
                <td className="px-2 py-2 text-center tnum text-dim">{p.age}</td>
                <td className="px-2 py-2 text-[13px] text-dim">
                  <span className="flex items-center gap-1.5">
                    <ArchetypeIcon archetypeId={p.archetypeId} size={14} />
                    {getArchetype(p.archetypeId).name}
                  </span>
                </td>
                <td className="px-2 py-2 text-center">
                  <Ovr value={p.overall} size="sm" />
                </td>
                <td className="px-2 py-2">
                  <FitnessBar value={p.fitness} />
                </td>
                <td className="px-2 py-2 text-center">
                  <FormChip form={p.form} />
                </td>
                <td className="px-2 py-2 text-center tnum text-dim">{p.stats.apps}</td>
                <td className="px-2 py-2 text-center tnum text-dim">
                  {p.stats.goals} / {p.stats.assists}
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={p.value} className="text-dim" />
                </td>
                <td className="px-2 py-2 text-right">
                  {p.contract ? (
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span className="tnum text-dim">{formatMoney(p.contract.wage)}/wk</span>
                      {(() => {
                        const yl = yearsLeft(game, p);
                        return (
                          <span className={`tnum text-[10px] ${yl <= 1 ? "text-loss" : "text-faint"}`}>
                            {yl <= 1 ? "final year" : `${yl} yrs`}
                          </span>
                        );
                      })()}
                    </span>
                  ) : (
                    <span className="text-[10px] text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
