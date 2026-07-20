"use client";

// Player Profile — a popup overlay (§15.8): Bio tab + Career tab, mirroring the
// hot/cold data split. Opened from anywhere via viewPlayer(id); it floats over
// the current screen rather than navigating away.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { getArchetype } from "@/lib/config/archetypes";
import { POS_LABELS, posColors } from "@/lib/config/positions";
import { formatHeight, formatMoney } from "@/lib/value";
import { yearsLeft } from "@/lib/contracts";
import { seasonGrowth } from "@/lib/development";
import { optimalTrainingPlan, plansForPosition, resolveTrainingPlan } from "@/lib/config/training";
import { MAX_KIT_NUMBER, MIN_KIT_NUMBER, squadNumbersFor } from "@/lib/kitnumbers";
import { ArchetypeIcon, AttrGrid, Card, ConfirmButton, Crest, Flag, FitnessBar, FormChip, GhostButton, GoldButton, GrowthBadge, Ovr, PosBadge, PotentialBadge, Section, Tabs, TraitChip } from "../ui";
import ContractModal from "./ContractModal";

export default function PlayerProfileModal() {
  const game = useGame((s) => s.game);
  useGame((s) => s.rev);
  const id = useGame((s) => s.selectedPlayerId);
  const close = useGame((s) => s.closePlayer);
  const setTrainingPlan = useGame((s) => s.setTrainingPlan);
  const autoAssignPlan = useGame((s) => s.autoAssignTrainingPlan);
  const toggleTransferList = useGame((s) => s.toggleTransferList);
  const toggleLoan = useGame((s) => s.academyToggleLoan);
  const releaseSenior = useGame((s) => s.releaseSenior);
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
            className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${primaryColor.bg}22`, border: `1px solid ${primaryColor.bg}` }}
          >
            <Ovr value={p.overall} size="lg" />
            {/* This season's movement, tucked under the rating so the big number
                stays the focus (v19). */}
            {seasonGrowth(p) !== 0 && (
              <span className="absolute -bottom-2 rounded-sm border border-line bg-surface px-1">
                <GrowthBadge delta={seasonGrowth(p)} size="sm" />
              </span>
            )}
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
              <span title={p.heightCm ? `${p.heightCm} cm` : undefined}>{formatHeight(p.heightCm)}</span>
              <span className="text-faint">·</span>
              <span>{p.nationality}</span>
              {typeof p.kitNumber === "number" && (
                <>
                  <span className="text-faint">·</span>
                  <span className="display tnum font-semibold text-ink" title="Shirt number">
                    #{p.kitNumber}
                  </span>
                </>
              )}
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

          {/* Shirt number (v15) — re-assignable, swapping with the incumbent */}
          {isUserOwned && <KitNumberPanel playerId={p.id} />}

          {/* Training plan (§5 v8) — a development focus for the user's own players */}
          {isUserOwned && (
            <Section title="Training Plan">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                {(() => {
                  const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
                  const best = optimalTrainingPlan(p);
                  const isOptimal = plan.id === best.id;
                  return (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="display flex items-center gap-2 font-semibold text-ink">
                          {plan.name}
                          {isOptimal && (
                            <span className="display rounded-sm border border-win/40 px-1.5 py-0.5 text-[10px] font-semibold text-win">
                              OPTIMAL
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] leading-relaxed text-faint">
                          {plan.blurb}
                          {!isOptimal && (
                            <>
                              {" "}
                              <span className="text-gold">Recommended: {best.name}.</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
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
                        <GhostButton
                          onClick={() => autoAssignPlan(p.id)}
                          disabled={isOptimal}
                          className="!py-1.5 text-xs"
                        >
                          AUTO
                        </GhostButton>
                      </div>
                    </>
                  );
                })()}
              </Card>
            </Section>
          )}

          {/* Squad actions (v14) — the three ways a player leaves, or is made
              available to leave. Listing is a visibility flag, not a queue: it
              tells other clubs he's gettable and offers follow. */}
          {isUserSenior && (
            <Section title="Actions">
              <Card className="divide-y divide-line/50">
                {(() => {
                  const listed = game.transferList.includes(p.id);
                  const loanListed = game.academy.loanList.includes(p.id);
                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-ink">
                            Transfer list
                            {listed && <span className="ml-2 text-[10px] font-normal text-gold">LISTED</span>}
                          </div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            {listed
                              ? "Clubs know he's available — expect more offers, and at a keener price."
                              : "Let clubs know he can be bought. More offers come in, though they'll bid a little lower."}
                          </div>
                        </div>
                        <GhostButton onClick={() => toggleTransferList(p.id)} className="shrink-0 !py-1.5 text-xs">
                          {listed ? "REMOVE FROM LIST" : "ADD TO TRANSFER LIST"}
                        </GhostButton>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-ink">
                            Loan list
                            {loanListed && <span className="ml-2 text-[10px] font-normal text-win">LISTED</span>}
                          </div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            {loanListed
                              ? "Available for a season-long loan — a club may take him while a window is open."
                              : "Make him available for a season-long loan. He'll play regular football elsewhere and the minutes count toward his development."}
                          </div>
                        </div>
                        <GhostButton onClick={() => toggleLoan(p.id)} className="shrink-0 !py-1.5 text-xs">
                          {loanListed ? "REMOVE FROM LOAN LIST" : "ADD TO LOAN LIST"}
                        </GhostButton>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-loss">Release</div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            Tear up his contract. He leaves immediately as a free agent and you receive no fee — this
                            can&apos;t be undone.
                          </div>
                        </div>
                        <ConfirmButton
                          label="RELEASE"
                          confirmLabel={`Release ${p.name}?`}
                          tone="danger"
                          onConfirm={() => releaseSenior(p.id)}
                          className="shrink-0 !px-3 !py-1.5 text-xs"
                        />
                      </div>
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

/**
 * Shirt-number editor (v15). Typing a number another squad member already wears
 * SWAPS the two — which is what actually happens when a squad re-numbers, and
 * what a manager expects when they claim a taken shirt. The panel names the
 * current holder before you commit, so the swap is never a surprise.
 */
function KitNumberPanel({ playerId }: { playerId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const commit = useGame((s) => s.setKitNumber);
  const p = game.players[playerId];
  const [draft, setDraft] = useState<string>("");

  const current = p?.kitNumber;
  const taken = squadNumbersFor(game, playerId);
  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid =
    parsed !== null && Number.isInteger(parsed) && parsed >= MIN_KIT_NUMBER && parsed <= MAX_KIT_NUMBER;
  const holder = valid && parsed !== current ? taken.get(parsed!) : undefined;

  return (
    <Section title="Shirt Number">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-gold-lo/50 bg-raised">
            <span className="display tnum text-2xl font-bold text-gold">
              {typeof current === "number" ? current : "—"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="display font-semibold text-ink">Squad number</div>
            <div className="text-[12px] leading-relaxed text-faint">
              {holder ? (
                <>
                  <span className="text-gold">#{parsed}</span> is {holder}&apos;s — assigning it swaps their numbers.
                </>
              ) : (
                `Any number from ${MIN_KIT_NUMBER} to ${MAX_KIT_NUMBER}. Taking a teammate's number swaps the two.`
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder={typeof current === "number" ? String(current) : "#"}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                commit(playerId, parsed!);
                setDraft("");
              }
            }}
            className="w-16 rounded-md border border-line bg-raised px-2 py-1.5 text-center text-sm tnum text-ink focus:border-gold focus:outline-none"
            aria-label="New shirt number"
          />
          <GhostButton
            onClick={() => {
              if (!valid) return;
              commit(playerId, parsed!);
              setDraft("");
            }}
            disabled={!valid || parsed === current}
            className="!py-1.5 text-xs"
          >
            {holder ? "SWAP" : "ASSIGN"}
          </GhostButton>
        </div>
      </Card>
    </Section>
  );
}
