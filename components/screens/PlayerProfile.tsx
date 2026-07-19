"use client";

// Player Profile — a popup overlay (§15.8): Bio tab + Career tab, mirroring the
// hot/cold data split. Opened from anywhere via viewPlayer(id); it floats over
// the current screen rather than navigating away.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { getArchetype } from "@/lib/config/archetypes";
import { POS_LABELS, posColors } from "@/lib/config/positions";
import { formatMoney } from "@/lib/value";
import { yearsLeft } from "@/lib/contracts";
import { plansForPosition, resolveTrainingPlan } from "@/lib/config/training";
import { ArchetypeIcon, AttrGrid, Card, Crest, Flag, FitnessBar, FormChip, GoldButton, Ovr, PosBadge, PotentialBadge, Section, Tabs, TraitChip } from "../ui";
import ContractModal from "./ContractModal";

export default function PlayerProfileModal() {
  const game = useGame((s) => s.game);
  useGame((s) => s.rev);
  const id = useGame((s) => s.selectedPlayerId);
  const close = useGame((s) => s.closePlayer);
  const setTrainingPlan = useGame((s) => s.setTrainingPlan);
  const [tab, setTab] = useState<"bio" | "career">("bio");
  const [contractOpen, setContractOpen] = useState(false);

  // A scouted prospect isn't in the world yet — the report carries the player
  // object, handed in via viewProspect and read here as a read-only preview.
  const preview = useGame((s) => s.previewPlayer);
  const p = game && id ? (game.players[id] ?? (preview?.id === id ? preview : null)) : null;
  const isPreview = !!p && !!game && !game.players[p.id];
  if (!game || !p) return null;

  const club = p.clubId ? game.teams[p.clubId] : null;
  const userTeam = game.teams[game.userTeamId];
  // The user can set a training plan for any player on their books (senior or
  // academy), not on loan / retired.
  const isUserOwned =
    !isPreview &&
    !p.retired &&
    !p.loan &&
    (userTeam.playerIds.includes(p.id) || (userTeam.academyPlayerIds ?? []).includes(p.id));
  // Only the user's own senior players (not on loan) can be re-signed here.
  const isUserSenior =
    !isPreview &&
    p.clubId === game.userTeamId && game.teams[game.userTeamId].playerIds.includes(p.id) && !p.loan && !p.retired;
  const arch = getArchetype(p.archetypeId);
  const career = game.careers[p.id];
  const avgRating = p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "—";
  const primaryColor = posColors(p.positions[0]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8" onClick={close}>
      <div
        className="relative my-auto w-full max-w-3xl rounded-lg border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header card */}
        <div className="mb-5 flex flex-wrap items-center gap-5 rounded-lg border border-line bg-raised p-5">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${primaryColor.bg}22`, border: `1px solid ${primaryColor.bg}` }}
          >
            <Ovr value={p.overall} size="lg" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="display flex items-center gap-2.5 text-2xl font-bold leading-tight">
              <Flag nat={p.nationality} size={22} />
              {p.name}
              {p.retired && <span className="text-sm text-faint">RETIRED</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim">
              <PosBadge pos={p.positions[0]} />
              <span>{POS_LABELS[p.positions[0]]}</span>
              <span className="text-faint">·</span>
              <span>{p.age}y</span>
              <span className="text-faint">·</span>
              <span>{p.nationality}</span>
              {p.loan && (
                <span className="display rounded-sm border border-win/40 px-1.5 py-0.5 text-[10px] font-semibold text-win">
                  ON LOAN · {game.teams[p.loan.toClubId]?.name}
                </span>
              )}
              {p.academyClubId && (
                <span
                  className="display rounded-sm border border-gold-lo/40 px-1.5 py-0.5 text-[10px] font-semibold text-gold"
                  title={`Came through the ${game.teams[p.academyClubId]?.name ?? "?"} academy`}
                >
                  {game.teams[p.academyClubId]?.short ?? "?"} ACADEMY
                </span>
              )}
            </div>
            {p.traits.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {p.traits.map((t) => (
                  <TraitChip key={t} id={t} />
                ))}
              </div>
            )}
          </div>
          <div className="text-right">
            {club && (
              <div className="mb-1 flex items-center justify-end gap-2 text-sm">
                <Crest colors={club.colors} short={club.short} size={20} />
                <span>{club.name}</span>
              </div>
            )}
            <div className="display tnum text-xl font-semibold">{p.retired ? "—" : formatMoney(p.value)}</div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Market value</div>
            {!p.retired && (
              <div className="mt-1.5">
                <PotentialBadge game={game} p={p} />
                <div className="text-[10px] uppercase tracking-widest text-faint">Potential</div>
              </div>
            )}
          </div>
          <button
            onClick={close}
            className="absolute right-6 top-6 hidden text-faint hover:text-ink sm:block"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <Tabs
          tabs={[
            { id: "bio", label: "Bio" },
            { id: "career", label: "Career" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "bio" ? (
          <>
          {/* Role — the archetype is the soul of the player (§1). It gets its own
              prominent section with a description and the positions he plays. */}
          <Section title="Role">
            <Card className="overflow-hidden">
              <div
                className="flex items-center gap-3 border-b border-gold-lo/30 px-4 py-3"
                style={{ background: "linear-gradient(90deg, var(--color-gold-lo, #6b5a2a)15, transparent)" }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gold-lo/60 bg-surface"
                >
                  <ArchetypeIcon archetypeId={p.archetypeId} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="display gold-text text-lg font-bold leading-tight">{arch.name}</div>
                  <div className="text-[11px] uppercase tracking-widest text-faint">Archetype</div>
                </div>
              </div>
              <p className="px-4 py-3 text-[13px] leading-relaxed text-dim">{arch.desc}</p>
              <div className="flex flex-wrap items-center gap-2 border-t border-line/50 px-4 py-3">
                <span className="mr-1 text-[11px] uppercase tracking-widest text-faint">Positions</span>
                {p.positions.map((pos, i) => (
                  <span key={pos} className="flex items-center gap-1.5">
                    <PosBadge pos={pos} />
                    <span className="text-[12px] text-dim">
                      {POS_LABELS[pos]}
                      {i === 0 && p.positions.length > 1 && <span className="ml-1 text-[10px] text-faint">(primary)</span>}
                    </span>
                    {i < p.positions.length - 1 && <span className="ml-1 text-faint">·</span>}
                  </span>
                ))}
                {p.positions.length === 1 && (
                  <span className="text-[11px] text-faint">Specialist — plays one position.</span>
                )}
              </div>
            </Card>
          </Section>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Section title="Attributes">
              <AttrGrid p={p} />
            </Section>
            <Section title="This Season">
              <Card className="divide-y divide-line/50 text-sm">
                {[
                  ["Condition", <FitnessBar key="f" value={p.fitness} showValue />],
                  ["Form", <FormChip key="fo" form={p.form} />],
                  ["Appearances", <span key="a" className="tnum">{p.stats.apps}</span>],
                  ["Goals", <span key="g" className="tnum">{p.stats.goals}</span>],
                  ["Assists", <span key="as" className="tnum">{p.stats.assists}</span>],
                  ["Avg rating", <span key="r" className="display tnum">{avgRating}</span>],
                  ...(p.youthStats && p.youthStats.apps > 0
                    ? [[
                        p.loan ? "On loan" : "U21 league",
                        <span key="y" className="tnum text-dim">
                          {p.youthStats.apps} apps · {p.youthStats.goals}g · {(p.youthStats.ratingSum / p.youthStats.apps).toFixed(2)}
                        </span>,
                      ] as [string, React.ReactNode]]
                    : []),
                ].map(([k, v], i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2">
                    <span className="text-faint">{k as string}</span>
                    {v}
                  </div>
                ))}
              </Card>
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                {arch.name}: shines in{" "}
                {Object.entries(arch.styleSynergy)
                  .filter(([, v]) => v > 1.02)
                  .map(([k]) => k)
                  .join(", ") || "any style"}
                .
              </p>
            </Section>
          </div>

          {/* Training plan (§5 v8) — a development focus for the user's own players */}
          {isUserOwned && (
            <Section title="Training Plan">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                {(() => {
                  const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
                  return (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="display font-semibold text-ink">{plan.name}</div>
                        <div className="text-[12px] leading-relaxed text-faint">{plan.blurb}</div>
                      </div>
                      <select
                        value={plan.id}
                        onChange={(e) => setTrainingPlan(p.id, e.target.value)}
                        className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                      >
                        {plansForPosition(p.positions[0]).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </>
                  );
                })()}
              </Card>
            </Section>
          )}

          {/* Contract (§10 v5) — wage, length, and a re-sign path for own players */}
          {(p.contract || isUserSenior) && (
            <Section title="Contract">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                {p.contract ? (
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-faint">Weekly wage</div>
                      <div className="display tnum font-semibold">{formatMoney(p.contract.wage)}/wk</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-faint">Runs until</div>
                      <div className="display tnum font-semibold">
                        end of S{p.contract.expirySeason}
                        {(() => {
                          const yl = yearsLeft(game, p);
                          return <span className={`ml-2 text-xs font-normal ${yl <= 1 ? "text-loss" : "text-faint"}`}>{yl <= 1 ? "final year" : `${yl} yrs left`}</span>;
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-dim">Academy player — no professional contract until promoted.</span>
                )}
                {isUserSenior && (
                  <GoldButton onClick={() => setContractOpen(true)} className="!py-1.5 text-xs">
                    {p.contract && yearsLeft(game, p) <= 1 ? "RE-SIGN (URGENT)" : "OFFER NEW DEAL"}
                  </GoldButton>
                )}
              </Card>
            </Section>
          )}
          </>
        ) : (
          <div className="space-y-6">
            <Section title="Season by Season">
              {!career?.seasons.length ? (
                <div className="text-sm text-faint">First season in progress — history is written at the season&apos;s end.</div>
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-widest text-faint">
                        <th className="px-3 py-2 text-left">Season</th>
                        <th className="px-2 py-2 text-left">Club</th>
                        <th className="px-2 py-2 text-left">Competition</th>
                        <th className="w-12 px-2 py-2 text-center">Apps</th>
                        <th className="w-10 px-2 py-2 text-center">G</th>
                        <th className="w-10 px-2 py-2 text-center">A</th>
                        <th className="w-14 px-2 py-2 text-right">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.seasons.slice().reverse().map((row, i) => (
                        <tr key={i} className="border-b border-line/50 last:border-0">
                          <td className="px-3 py-1.5 tnum text-dim">S{row.season}</td>
                          <td className="px-2 py-1.5">{row.clubName}</td>
                          <td className="px-2 py-1.5 text-dim">{row.competition}</td>
                          <td className="px-2 py-1.5 text-center tnum">{row.apps}</td>
                          <td className="px-2 py-1.5 text-center tnum">{row.goals}</td>
                          <td className="px-2 py-1.5 text-center tnum">{row.assists}</td>
                          <td className={`px-2 py-1.5 text-right tnum ${row.avgRating >= 7.2 ? "gold-text font-semibold" : ""}`}>
                            {row.avgRating ? row.avgRating.toFixed(2) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </Section>
            <Section title="Transfer History">
              {!career?.transfers.length ? (
                <div className="text-sm text-faint">No transfers recorded.</div>
              ) : (
                <Card className="divide-y divide-line/50 text-sm">
                  {career.transfers.slice().reverse().map((t, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <span className="text-dim">
                        S{t.season} · {t.from} → <span className="text-ink">{t.to}</span>
                      </span>
                      <span className="tnum">{t.fee > 0 ? formatMoney(t.fee) : "Free"}</span>
                    </div>
                  ))}
                </Card>
              )}
            </Section>
          </div>
        )}

        {contractOpen && <ContractModal p={p} onClose={() => setContractOpen(false)} />}
      </div>
    </div>
  );
}
