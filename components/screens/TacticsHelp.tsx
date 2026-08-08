"use client";

/**
 * The Tactics Help tab (v1.80) — the manual for team building.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The identity system is the deepest thing in the game and, until now, the least
 * explained: the Tactics page shows a manager his grade, his ▲▼ marks and his
 * blueprint, but never the RULES those come from. A player could see that his
 * Sniper dislikes the current setup without ever learning that archetypes have
 * classes, that classes answer the style question and archetypes answer the dial
 * question, or that the two land on the same multiplier.
 *
 * ── The one rule this file obeys ───────────────────────────────────────────
 * IT RESTATES NOTHING. Every number on this page is read out of the same config
 * the engine reads — `classStyleBonus` for the style grid, `ARCHETYPE_PROFILE`
 * for the per-role dial preferences, `TUNING` for the swing bands and the style
 * shapes. A guide with its own copy of the balance table would be a guide free
 * to be wrong, and it would go wrong the first time anyone retuned anything.
 * That is the same reason `lib/assistant.ts` exists for the Tactics readout.
 *
 * So: prose is authored here, facts are derived. If you find yourself typing a
 * percentage into this file, it belongs in `tuning.ts` or `archetype.ts`.
 */

import { useMemo, useState } from "react";
import type { Style } from "@/lib/types";
import {
  ARCHETYPE_CLASS_BLURB,
  ARCHETYPE_CLASS_COLOR,
  ARCHETYPE_CLASS_ORDER,
  ARCHETYPE_PROFILE,
  ARCHETYPE_ROSTER,
  archetypesForPosition,
  classInstructionPrefs,
  classStyleBonus,
  describePrefs,
  STYLE_TABLE_ORDER,
  type Archetype,
  type ArchetypeClass,
  type InstructionPrefs,
} from "@/lib/config/archetype";
import { ATTR_META, type AttrKey } from "@/lib/config/attributes";
import { suggestRoles } from "@/lib/rolesuggest";
import { getFormation, styleLabel } from "@/lib/config/formations";
import { POS_ORDER } from "@/lib/config/positions";
import { TRAINING_PLAN_MAP } from "@/lib/config/training";
import { TUNING } from "@/lib/config/tuning";
import { ArchetypeIcon, Card, ClassDot, Section } from "../ui";


// ── Small presentational helpers ───────────────────────────────────────────

/** A signed percentage, the way every other tactical surface renders one. */
function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

/** Tone for a signed number: green up, red down, muted at zero. */
function toneOf(n: number): string {
  return n > 0 ? "text-win" : n < 0 ? "text-loss" : "text-faint";
}

/** A lettered step in a walkthrough — the visual spine of the "how to build a
 * side" sections, so a five-step process reads as five steps. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="display mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold-lo/50 bg-gold-lo/10 text-[11px] font-bold text-gold">
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="display block text-[13px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-dim">{children}</span>
      </span>
    </li>
  );
}

/** A named class, drawn the way it is drawn everywhere else. */
function ClassName({ cls }: { cls: ArchetypeClass }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <ClassDot cls={cls} size={7} />
      <span style={{ color: ARCHETYPE_CLASS_COLOR[cls] }}>{cls}</span>
    </span>
  );
}

/** A collapsible chapter. The guide is long by nature — a manager comes here
 * with ONE question — so everything past the first chapter starts folded and the
 * page opens as a table of contents rather than a wall. */
function Chapter({
  id,
  title,
  lede,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`help-${id}`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
      >
        <span
          className={`mt-1 shrink-0 text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="display block text-[15px] font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-faint">{lede}</span>
        </span>
      </button>
      {open && (
        <div id={`help-${id}`} className="border-t border-line/50 px-4 py-4">
          {children}
        </div>
      )}
    </Card>
  );
}

// ── The dial preferences of a role, as chips ───────────────────────────────

const AXIS_LABEL: { key: keyof InstructionPrefs; label: string }[] = [
  { key: "tempo", label: "Tempo" },
  { key: "width", label: "Width" },
  { key: "press", label: "Press" },
  { key: "line", label: "Line" },
  { key: "focus", label: "Focus" },
];

/** Every axis a role has an opinion on, as ✓liked / ✗disliked chips. An axis it
 * is silent about is omitted entirely — that silence is meaningful (it scores
 * nothing either way) and printing "no preference" five times would bury the
 * two or three lines that matter. */
function PrefChips({ prefs }: { prefs: InstructionPrefs }) {
  const rows = AXIS_LABEL.map(({ key, label }) => ({ label, pref: prefs[key] })).filter(
    (r) => r.pref && (r.pref.likes?.length || r.pref.dislikes?.length)
  );
  if (rows.length === 0) {
    return <span className="text-[11px] text-faint">No dial preferences — neutral whatever you set.</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {rows.map((r) => (
        <span key={r.label} className="flex items-baseline gap-1.5 text-[11px] whitespace-nowrap">
          <span className="uppercase tracking-widest text-faint">{r.label}</span>
          {r.pref!.likes?.map((v) => (
            <span key={`+${v}`} className="text-win">
              ✓{v}
            </span>
          ))}
          {r.pref!.dislikes?.map((v) => (
            <span key={`-${v}`} className="text-loss">
              ✗{v}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

// ── Chapter: how a side is built ───────────────────────────────────────────

function HowItWorks() {
  const synergy = Math.round(TUNING.synergyCap * 100);
  const swing = Math.round(TUNING.instructionFitSwing * 100);

  return (
    <div className="space-y-4">
      {/* The loop, as a diagram made of type. This is the single most important
          thing on the page: everything else is detail hanging off it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-md border border-gold-lo/40 bg-gold-lo/[0.06] px-3 py-3 text-[12px]">
        {["Training Plan", "Attributes", "Archetype", "Tactical effect"].map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-gold">→</span>}
            <span className="display font-semibold text-ink">{s}</span>
          </span>
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-dim">
        That arrow only points one way, and it is the whole game. You choose a{" "}
        <b className="text-ink">training plan</b> on the Development page. The plan shapes his{" "}
        <b className="text-ink">35 attributes</b> over seasons. Those attributes — nothing else —
        decide which <b className="text-ink">archetype</b> he reads as. And the archetype is what
        the match engine consults when it asks whether this player suits the way you have told the
        team to play.
      </p>
      <p className="text-[12px] leading-relaxed text-dim">
        An archetype is never assigned and never stored. You cannot pick one, and neither can a
        transfer: it is <em>earned</em>, re-derived from his attribute line every time it is shown.
        Train a defensive midfielder on passing for three seasons and he stops being a Destroyer and
        becomes a Metronome, because that is what his numbers now say he is.
      </p>

      <ol className="space-y-3">
        <Step n={1} title="Pick the players">
          Overall and position fit come first and dominate everything below. A 78 in his natural
          slot beats a 70 who happens to suit your style — identity is the tie-breaker between
          comparable players, not a substitute for quality.
        </Step>
        <Step n={2} title="Read their classes">
          Each of the 45 archetypes belongs to one of five <b className="text-ink">classes</b>. The
          class is what answers &ldquo;does this KIND of footballer suit this STYLE?&rdquo; — worth
          up to ±{synergy}% on the player&apos;s own rating.
        </Step>
        <Step n={3} title="Choose a style that matches the squad you have">
          Not the style you like. The grid below shows exactly which classes each style rewards. If
          your best eleven is four Enforcers and three Engines, Possession is fighting your squad.
        </Step>
        <Step n={4} title="Fine-tune the five dials">
          Tempo, width, press, defensive line and focus. These are read per{" "}
          <b className="text-ink">archetype</b>, not per class — worth up to ±{swing}% — which is
          where two strikers of the same class stop being interchangeable.
        </Step>
        <Step n={5} title="Check the Assistant">
          The Setup tab grades the side you actually picked and lists what it would sign. It reads
          the same tables this guide does, so it can never advise something the simulation
          won&apos;t honour.
        </Step>
      </ol>

      <div className="rounded-md border border-line bg-base/40 px-3 py-2.5">
        <div className="display text-[11px] uppercase tracking-widest text-faint">
          The one thing to remember
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-dim">
          Both layers multiply onto the <b className="text-ink">same number</b> — that player&apos;s
          effective rating — and effective rating is what feeds attack, midfield, defence and who
          scores. There is no separate &ldquo;synergy bonus&rdquo; applied somewhere else. A
          well-suited player is simply a better player for ninety minutes.
        </p>
      </div>
    </div>
  );
}

// ── Chapter: the five classes ──────────────────────────────────────────────

function Classes() {
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-dim">
        Five classes, nine archetypes each. The class is the tactical grouping — it is what the
        style question is asked of, and it is why the colour beside a player&apos;s name is worth
        learning. Two archetypes of the same class respond to a style identically; they diverge on
        the dials.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {ARCHETYPE_CLASS_ORDER.map((cls) => {
          const best = STYLE_TABLE_ORDER.filter(
            (s) => classStyleBonus(cls, s) === Math.max(...STYLE_TABLE_ORDER.map((x) => classStyleBonus(cls, x)))
          );
          const worst = STYLE_TABLE_ORDER.filter(
            (s) => classStyleBonus(cls, s) === Math.min(...STYLE_TABLE_ORDER.map((x) => classStyleBonus(cls, x)))
          );
          return (
            <div
              key={cls}
              className="rounded-md border border-line bg-base/30 px-3 py-2.5"
              style={{ borderLeft: `3px solid ${ARCHETYPE_CLASS_COLOR[cls]}` }}
            >
              <div className="display text-[13px] font-semibold" style={{ color: ARCHETYPE_CLASS_COLOR[cls] }}>
                {cls}
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-dim">{ARCHETYPE_CLASS_BLURB[cls]}</p>
              <div className="mt-2 space-y-0.5 text-[11px]">
                <div>
                  <span className="uppercase tracking-widest text-faint">Best in </span>
                  <span className="text-win">{best.map(styleLabel).join(", ")}</span>
                </div>
                <div>
                  <span className="uppercase tracking-widest text-faint">Struggles in </span>
                  <span className="text-loss">{worst.map(styleLabel).join(", ")}</span>
                </div>
                <div className="pt-1 text-faint">
                  Wants {describePrefs(classInstructionPrefs(cls))} by default.
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Every class row sums to zero across the six styles, and every class is the outright best
        pick in at least one of them. No class is stronger than another for existing — a class is
        only worth something because of what it suits. That is a balance guarantee the game asserts
        at startup, not an aspiration.
      </p>
    </div>
  );
}

// ── Chapter: the style × class grid ────────────────────────────────────────

function StyleGuide() {
  const shapes = TUNING.styleShape;

  /** Prose for what each style asks of a squad. The numeric half comes from the
   * table; this is the half a table can't say. */
  const HOW_TO_BUILD: Record<Style, string> = {
    Possession:
      "Build around passers. You want Creators through the spine — a ball-playing centre back, a deep-lying midfielder, a playmaking ten — and full backs who tuck in rather than overlap. Slow tempo and a low press give them the time the class is built on. Avoid stacking Blitzers: fast direct runners have nothing to run onto when the ball never goes long.",
    Counter:
      "Build around pace in the front three. Blitzers are the class this style exists for, backed by Enforcers who can win the ball deep and hit it early. Keep a deep line and a low press to invite pressure, then release. Creators suffer here — you are deliberately not giving them time on the ball.",
    Direct:
      "The same fast-transition plan as Counter with a higher starting point. Blitzers again, plus Enforcers to win the second ball. A target man up front gives the long pass somewhere to land. Creators are the wrong class: nothing is being built through midfield.",
    Gegenpress:
      "The Engine style, and the only one where a squad of runners is optimal. You need lungs everywhere — box-to-box midfielders, overlapping full backs, forwards who press. High press, high line, high tempo. It drains fitness far faster than anything else, so a deep bench is not optional here.",
    ParkTheBus:
      "Enforcers, and as many as your shape allows. Defensive-minded full backs, a screening midfielder, a centre back pairing that defends the box rather than the space. Deep line, low press. Expect to concede possession and very little else — this is the lowest-scoring setup in both directions.",
    WingPlay:
      "Mavericks on the flanks, and a shape that fields two of them. This is the one style that rewards improvisation over structure: 1v1 wingers, a crosser, a striker who attacks the ball in the box. Enforcers and Blitzers are both poor fits — one can't beat a man, the other wants the ball in behind rather than wide.",
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-dim">
        The grid is the whole style rule. Read down a column to see which classes a style rewards;
        read across a row to see where a class belongs. The number is the swing that class earns on
        every one of its players&apos; ratings under that style.
      </p>

      {/* The table scrolls in its own container — six styles plus a label column
          will not fit a phone, and the page body must never scroll sideways. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left text-[10px] uppercase tracking-widest text-faint">
                Class
              </th>
              {STYLE_TABLE_ORDER.map((s) => (
                <th
                  key={s}
                  className="px-2 py-1.5 text-center text-[10px] uppercase tracking-widest text-faint"
                >
                  {styleLabel(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ARCHETYPE_CLASS_ORDER.map((cls) => (
              <tr key={cls} className="border-t border-line/50">
                <td className="sticky left-0 z-10 bg-surface px-2 py-1.5 font-medium">
                  <ClassName cls={cls} />
                </td>
                {STYLE_TABLE_ORDER.map((s) => {
                  const v = classStyleBonus(cls, s);
                  return (
                    <td
                      key={s}
                      className={`px-2 py-1.5 text-center tnum font-semibold ${toneOf(v)}`}
                      style={
                        v !== 0
                          ? {
                              background:
                                v > 0
                                  ? `rgba(47,190,74,${Math.min(0.18, Math.abs(v) / 100)})`
                                  : `rgba(232,68,60,${Math.min(0.18, Math.abs(v) / 100)})`,
                            }
                          : undefined
                      }
                    >
                      {v === 0 ? "·" : pct(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        A <span className="text-faint">·</span> is not a dead end — it means the class is fine there,
        it just isn&apos;t what the style is built around. Only a negative is a genuine mismatch.
      </p>

      {/* Beyond the per-player synergy, each style bends the match itself. Read
          straight off TUNING so the page can never quote a stale shape. */}
      <div className="space-y-2">
        {STYLE_TABLE_ORDER.map((s) => {
          const shape = shapes[s];
          const effects: { label: string; v: number; goodUp: boolean }[] = [
            { label: "midfield", v: shape.midfield, goodUp: true },
            { label: "defence", v: shape.defense, goodUp: true },
            { label: "chances conceded", v: shape.oppChance, goodUp: false },
            { label: "fitness drain", v: shape.fitnessDrain, goodUp: false },
          ].filter((e) => Math.abs(e.v - 1) >= 0.005);
          const winners = ARCHETYPE_CLASS_ORDER.filter((c) => classStyleBonus(c, s) > 0);

          return (
            <div key={s} className="rounded-md border border-line bg-base/30 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="display text-[13px] font-semibold text-ink">{styleLabel(s)}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {winners.length > 0 ? (
                    winners.map((c) => <ClassName key={c} cls={c} />)
                  ) : (
                    <span className="text-faint">no class bonus</span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{HOW_TO_BUILD[s]}</p>
              {effects.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tnum">
                  {effects.map((e) => {
                    const delta = Math.round((e.v - 1) * 100);
                    const good = e.goodUp ? delta > 0 : delta < 0;
                    return (
                      <span key={e.label}>
                        <span className="text-faint">{e.label} </span>
                        <span className={good ? "text-win" : "text-loss"}>{pct(delta)}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {shape.wideBias > 0 && (
                <div className="mt-0.5 text-[11px] text-dim">
                  Goals and assists shift{" "}
                  <span className="tnum text-win">{pct(Math.round(shape.wideBias * 100))}</span> toward
                  wide players.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Chapter: the ideal XI for a style ──────────────────────────────────────

/**
 * The best side to build for each style of play (v1.87).
 *
 * The class × style grid one chapter up answers "does this KIND of player suit
 * this style". That is the rule, but it is not an answer to the question a
 * manager actually arrives with, which is "so who do I sign?" — turning a column
 * of five class numbers into eleven specific roles means holding the roster's
 * position reachability in your head, which is exactly the wiki-not-a-game
 * problem the Squad Blueprint exists to solve on the Tactics screen.
 *
 * So this chapter is that same blueprint, run for a style rather than for your
 * squad. It calls `squadBlueprint` — THE function the Tactics screen calls, with
 * an empty lineup so every slot reports its ideal — which is what guarantees the
 * XI named here is the one the ✓/~/✗ marks will grade you against. Restating a
 * hand-picked "possession XI" in this file would be a second opinion free to
 * disagree with the first.
 *
 * The dials are derived too, not authored: for each axis the setting is the one
 * whose value the ideal XI's own roles most prefer, scored with the same
 * `instructionFitScore` the engine multiplies onto a rating. That is why a
 * recommendation here can never contradict the ▲▼ marks on the Setup tab.
 */

/** The shape each style is shown in. A blueprint is per-FORMATION — the slots
 * are what the roles hang off — so naming a style's ideal XI means naming the
 * shape it is ideal in. These are the shapes each style's prose in the chapter
 * above already describes: WingPlay needs two wingers, ParkTheBus a back five,
 * Gegenpress the pressing 4-3-3. */
const STYLE_SHAPE: Record<Style, string> = {
  Possession: "433",
  Counter: "4231",
  Direct: "442",
  Gegenpress: "433",
  ParkTheBus: "532",
  WingPlay: "4231",
};

/**
 * The dial settings this XI wants, derived rather than authored.
 *
 * For each axis, every setting the eleven ideal roles actually NAME is scored
 * with the same ±1 tally `instructionFitScore` averages — liked +1, disliked −1
 * — and the winner is the setting the side as a whole most wants. Deriving the
 * candidate settings from the roles' own `likes`/`dislikes` rather than from a
 * list of enum values is deliberate: it keeps this file free of a third copy of
 * the option lists (Tactics.tsx and verify-archetype-tactics.ts each hold one),
 * so a new setting on an axis needs no edit here to be considered.
 *
 * A net of zero means the XI genuinely has no collective opinion, which is
 * reported as "Any" — claiming a preference nobody holds would be the exact
 * kind of invented fact this file's header rule forbids.
 */
function bestDials(ideals: Archetype[]): { label: string; value: string }[] {
  return AXIS_LABEL.map(({ key, label }) => {
    const tally = new Map<string, number>();
    for (const a of ideals) {
      const pref = ARCHETYPE_PROFILE[a.id].instructionPrefs[key];
      if (!pref) continue;
      for (const v of pref.likes ?? []) tally.set(v, (tally.get(v) ?? 0) + 1);
      for (const v of pref.dislikes ?? []) tally.set(v, (tally.get(v) ?? 0) - 1);
    }
    let best: string | undefined;
    let bestScore = 0;
    for (const [v, score] of tally) {
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return { label, value: best ?? "Any" };
  });
}

function StyleBuilds() {
  const [style, setStyle] = useState<Style>("Possession");

  const build = useMemo(() => {
    const formation = getFormation(STYLE_SHAPE[style]);
    // v2.2: `suggestRoles` is what remains of the blueprint — the ROLE question
    // ("who should I sign for this style") without the grading half, which is
    // deleted along with the Squad Blueprint panel it used to feed.
    const suggested = suggestRoles(
      formation.slots.map((s) => ({ id: s.id, pos: s.pos, x: s.x })),
      { formationId: formation.id, mentality: "Balanced", style },
      TUNING.instructionFitSwing
    );
    const roleFor = new Map(suggested.map((s) => [s.slotId, s.role]));
    const rows = formation.slots.flatMap((s) => {
      const role = roleFor.get(s.id);
      return role ? [{ slotId: s.id, label: s.label as string, role }] : [];
    });
    const ideals = rows.map((r) => r.role);
    // How the eleven break down by class — the bridge back to the grid above.
    const counts = ARCHETYPE_CLASS_ORDER.map((c) => ({
      cls: c,
      n: ideals.filter((a) => a.cls === c).length,
    })).filter((x) => x.n > 0);
    return { formation, rows, dials: bestDials(ideals), counts };
  }, [style]);

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-dim">
        The grid one chapter up gives the rule; this gives the team sheet. Pick a style and this is
        the best role at every position for it — the same suggestion the{" "}
        <b className="text-ink">Tactic Creator</b> fills in when you ask it to, produced by the same
        function, so what you read here is what it will propose.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-faint">Style</span>
        {STYLE_TABLE_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStyle(s)}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              style === s
                ? "border border-gold bg-hover text-gold"
                : "border border-line text-faint hover:text-ink"
            }`}
          >
            {styleLabel(s)}
          </button>
        ))}
      </div>

      {/* The shape, the class mix and the dials — the three things that turn a
          list of eleven names into an actual plan. */}
      <div className="rounded-md border border-line bg-base/30 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="display text-[13px] font-semibold text-ink">
            {styleLabel(style)} — {build.formation.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
            {build.counts.map(({ cls, n }) => (
              <span key={cls} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ClassDot cls={cls} size={7} />
                <span style={{ color: ARCHETYPE_CLASS_COLOR[cls] }}>{cls}</span>
                <span className="tnum font-semibold text-dim">×{n}</span>
              </span>
            ))}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">{build.formation.desc}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {build.dials.map(({ label, value }) => (
            <span key={label}>
              <span className="text-faint">{label} </span>
              <span className={value === "Any" ? "text-faint" : "text-ink"}>{value}</span>
            </span>
          ))}
        </div>
      </div>

      {/* The XI itself. One row per slot, in the formation's own slot order, so
          it reads goalkeeper-outward the way the pitch does. */}
      <Card className="divide-y divide-line/50">
        {build.rows.map((row) => (
          <div key={row.slotId} className="flex items-center gap-2.5 px-3 py-2">
            <span className="display w-8 shrink-0 text-[11px] font-bold text-faint">{row.label}</span>
            <ArchetypeIcon archetype={row.role} size={22} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="display text-[12.5px] font-semibold text-ink">{row.role.name}</span>
                <span
                  className="text-[9.5px] uppercase tracking-widest"
                  style={{ color: ARCHETYPE_CLASS_COLOR[row.role.cls] }}
                >
                  {row.role.cls}
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                {row.role.desc}
              </span>
            </span>
          </div>
        ))}
      </Card>

      <p className="text-[11px] leading-relaxed text-faint">
        These are the <em>best</em> roles, not the only workable ones. A role assigned in the Creator
        decides what <em>kind</em> of chances that slot manufactures, and the player you actually
        field decides how well he takes them — so a near miss within the same class costs little,
        while asking a target man to hit long shots costs a great deal. Treat this as the side to aim
        at over several windows, not eleven players to go and buy at once.
      </p>
    </div>
  );
}

// ── Chapter: the five dials ────────────────────────────────────────────────

function Instructions() {
  const swing = Math.round(TUNING.instructionFitSwing * 100);

  /** What each dial does to the match, and what to think about when setting it.
   * The engine-side numbers for these live on the Setup tab beside the controls
   * themselves; this is the squad-building half. */
  const DIALS: { label: string; what: string; build: string }[] = [
    {
      label: "Tempo",
      what: "How fast you move the ball. High tempo makes more chances for both sides and burns fitness; Slow controls the game and saves legs.",
      build:
        "Slow suits Creators and Mavericks — the players who need a touch before they decide. High suits Engines and Blitzers, who want the ball moving before a defence is set. Setting a high tempo with a midfield of playmakers is the most common way to make a good side worse.",
    },
    {
      label: "Width",
      what: "Where you attack from. Wide gets more out of full backs and wingers; Narrow funnels everything through the middle.",
      build:
        "Wide is the Maverick and Blitzer setting, and it is what an overlapping full back needs to be worth his place. Narrow suits tucked-in full backs, a target man and defensive centre backs who don't want to be dragged to the touchline.",
    },
    {
      label: "Press",
      what: "How aggressively you hunt the ball. A high press wins more of the midfield battle but tires players and leaves space behind.",
      build:
        "High press is Engine territory and almost nothing else — Creators and Enforcers both dislike it, for opposite reasons. If your spine isn't built to run, a low press is not the timid option, it is the correct one.",
    },
    {
      label: "Defensive Line",
      what: "How high the back line sits. High squeezes the pitch but can be beaten in behind; Deep is solid but concedes territory.",
      build:
        "This is the dial that most often splits a defence against itself. Most centre backs want it Deep; the sweeper-keeper and the covering centre back want it High. Field both and one of them is unhappy whatever you choose — which is a squad-building problem, not a tactics one.",
    },
    {
      label: "Focus",
      what: "Which channel your attacks favour. Biases who gets the ball in the final third.",
      build:
        "Pick a flank to feed one star winger, Wide to feed two, Central to feed a ten. Mavericks want the ball wide; a lockdown full back and a commanding keeper both want play kept central and away from their flank.",
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-dim">
        The five advanced dials are read per <b className="text-ink">archetype</b> — the specific
        role, not the class. This is where a Sniper and a Ram stop being &ldquo;two Maverick
        strikers&rdquo; and become two different footballers who want opposite things.
      </p>

      <div className="rounded-md border border-line bg-base/40 px-3 py-2.5 text-[12px] leading-relaxed text-dim">
        Every role names the axes it cares about and is silent on the rest. On each axis it names,
        your setting scores <span className="text-win">+1</span> if he likes it,{" "}
        <span className="text-loss">−1</span> if he dislikes it, 0 otherwise. Those are averaged
        over <em>the axes he names</em> — so a keeper with two opinions can earn just as much as a
        wing back with four — and the result moves his rating by up to ±{swing}%.
      </div>

      <div className="space-y-2">
        {DIALS.map((d) => (
          <div key={d.label} className="rounded-md border border-line bg-base/30 px-3 py-2.5">
            <div className="display text-[13px] font-semibold text-ink">{d.label}</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{d.what}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">{d.build}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Every role that names a liked setting on an axis also names a disliked one, so no archetype
        gains from this system merely by existing — averaged over all 405 possible setups, every
        role scores exactly zero. There is no universally correct set of dials to discover; there is
        only the set that fits the eleven you picked.
      </p>
    </div>
  );
}

// ── Chapter: the archetype browser ─────────────────────────────────────────

/**
 * The attributes that DERIVE an archetype.
 *
 * Read straight off the archetype's training plan, because that is literally
 * what `deriveArchetype` scores against: `distinctiveScore` weights every
 * attribute by how much more this plan wants it than its four siblings do, and
 * the tiers a plan authors are its four primaries (share 1.0) and four
 * secondaries (0.6). Everything else sits at the flat `OTHER_SHARE` baseline and
 * carries no signal about which archetype a player is, so it is correctly absent
 * here. Restating a hand-written attribute list per archetype would be 45 more
 * chances to disagree with the engine — see this file's header rule.
 */
function DerivedFrom({ planId }: { planId: string }) {
  const plan = TRAINING_PLAN_MAP[planId];
  if (!plan) return null;

  const chip = (k: AttrKey, core: boolean) => (
    <span
      key={k}
      title={`${ATTR_META[k].name} — ${core ? "core" : "supporting"}`}
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${
        core
          ? "border border-gold-lo/45 bg-gold-lo/10 text-gold"
          : "border border-line bg-raised text-dim"
      }`}
    >
      {ATTR_META[k].short}
    </span>
  );

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[9.5px] uppercase tracking-widest text-faint">Derived from</span>
      {plan.primary.map((k) => chip(k, true))}
      {plan.secondary.map((k) => chip(k, false))}
    </span>
  );
}

function Roster() {
  const [pos, setPos] = useState<"ALL" | (typeof POS_ORDER)[number]>("ALL");
  const [cls, setCls] = useState<"ALL" | ArchetypeClass>("ALL");

  const list = useMemo(() => {
    const base: Archetype[] = pos === "ALL" ? ARCHETYPE_ROSTER : archetypesForPosition(pos);
    return base.filter((a) => cls === "ALL" || a.cls === cls);
  }, [pos, cls]);

  const chip = (active: boolean) =>
    `rounded px-2 py-1 text-[11px] font-medium transition-colors ${
      active ? "border border-gold bg-hover text-gold" : "border border-line text-faint hover:text-ink"
    }`;

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-dim">
        All 45 roles, and what each one wants from the dials. Filter by the position you are trying
        to fill, or by the class you are trying to stack. The right-hand column names two real
        footballers each role is recognisably modelled on — illustration only, nothing in the
        simulation reads them.
      </p>
      <p className="text-[12px] leading-relaxed text-dim">
        <b className="text-ink">Derived from</b> lists the attributes that decide whether a player
        reads as this role — <span className="text-gold">gold</span> are its four core attributes,
        grey the four supporting ones. An archetype is never stored: it is scored off these against
        the four rival roles at the same position, so a player earns the one whose attributes stand
        out most against his own average. Every other attribute is neutral for this purpose.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-faint">Position</span>
        <button onClick={() => setPos("ALL")} className={chip(pos === "ALL")}>
          All
        </button>
        {POS_ORDER.map((p) => (
          <button key={p} onClick={() => setPos(p)} className={chip(pos === p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-faint">Class</span>
        <button onClick={() => setCls("ALL")} className={chip(cls === "ALL")}>
          All
        </button>
        {ARCHETYPE_CLASS_ORDER.map((c) => (
          <button
            key={c}
            onClick={() => setCls(c)}
            className={chip(cls === c)}
            style={cls === c ? undefined : { color: ARCHETYPE_CLASS_COLOR[c] }}
          >
            {c}
          </button>
        ))}
      </div>

      <Card className="divide-y divide-line/50">
        {list.map((a) => (
          <div key={a.id} className="flex flex-wrap gap-x-3 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap">
            <span className="mt-0.5 shrink-0">
              <ArchetypeIcon archetype={a} size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="display text-[13px] font-semibold text-ink">{a.name}</span>
                <span
                  className="text-[10px] uppercase tracking-widest"
                  style={{ color: ARCHETYPE_CLASS_COLOR[a.cls] }}
                >
                  {a.cls}
                </span>
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">{a.desc}</span>
              <DerivedFrom planId={a.planId} />
              <span className="mt-1.5 block">
                <PrefChips prefs={ARCHETYPE_PROFILE[a.id].instructionPrefs} />
              </span>
            </span>
            {/* The "plays like" column. On a phone there is no room for a second
                column, so it drops beneath the guide text rather than squeezing
                both — the names are the supporting detail, the dials are not. */}
            <span className="w-full shrink-0 border-t border-line/40 pt-1.5 sm:w-[168px] sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              <span className="block text-[9.5px] uppercase tracking-widest text-faint">Plays like</span>
              {a.examples.map((name) => (
                <span key={name} className="mt-0.5 block truncate text-[11.5px] leading-snug text-dim" title={name}>
                  {name}
                </span>
              ))}
            </span>
          </div>
        ))}
        {list.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-faint">
            No archetype is both a {cls} and reachable at {pos} — the roles available at a position
            are fixed, which is itself worth knowing when you plan a style.
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Chapter: what the engine does with all of it ───────────────────────────

function EngineGuide() {
  const synergy = Math.round(TUNING.synergyCap * 100);
  const swing = Math.round(TUNING.instructionFitSwing * 100);
  const home = Math.round((TUNING.homeAdvantage - 1) * 100);

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-dim">
        A match is six fifteen-minute segments. In each one the engine works out both sides&apos;
        attack, midfield and defence, turns those into chances, and turns chances into goals. Every
        one of those numbers is built from the same per-player quantity:
      </p>

      <div className="overflow-x-auto rounded-md border border-gold-lo/40 bg-gold-lo/[0.06] px-3 py-3">
        <div className="display flex min-w-max items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold">
          <span className="text-gold">effective rating</span>
          <span className="text-faint">=</span>
          <span className="text-ink">overall</span>
          {[
            "position fit",
            "style synergy",
            "instruction fit",
            "form",
            "fitness",
            "coaching",
          ].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="text-faint">×</span>
              <span className="text-ink">{t}</span>
            </span>
          ))}
        </div>
      </div>

      <ul className="space-y-2 text-[12px] leading-relaxed text-dim">
        <li>
          <b className="text-ink">Position fit</b> — playing a man out of position cuts his rating,
          hard. It is the largest single penalty on this list and the easiest to avoid.
        </li>
        <li>
          <b className="text-ink">Style synergy</b> — his class against your style, up to ±{synergy}%.
        </li>
        <li>
          <b className="text-ink">Instruction fit</b> — his archetype against your five dials, up to
          ±{swing}%.
        </li>
        <li>
          <b className="text-ink">Form and fitness</b> — a tired player is a worse player in the same
          shirt, which is what makes substitutions and squad depth matter rather than being
          bookkeeping.
        </li>
        <li>
          <b className="text-ink">Coaching</b> — your staff, applied to the whole side.
        </li>
      </ul>

      <p className="text-[12px] leading-relaxed text-dim">
        Those ratings are pooled by area of the pitch. Midfield decides who sees more of the ball
        and so who gets more chances; attack against the opponent&apos;s defence decides how good
        each chance is. Playing at home is worth about {pct(home)}. Mentality raises or lowers chance
        volume for <em>both</em> sides at once — attacking football is not free.
      </p>

      <p className="text-[12px] leading-relaxed text-dim">
        Who scores is a weighted draw among the players on the pitch, and the weights come from the
        archetype too: a Blitzer is far likelier to be the scorer, a Creator far likelier to be the
        assister. So the identity system decides not only whether you win, but who your top scorer
        turns out to be.
      </p>

      <div className="rounded-md border border-line bg-base/40 px-3 py-2.5">
        <div className="display text-[11px] uppercase tracking-widest text-faint">
          What isn&apos;t shown anywhere
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-dim">
          Styles and mentalities also counter each other directly, and that matrix is deliberately
          hidden — from this page too. Reading the opposition and guessing is the point of it. It is
          a gentle effect: a good matchup is an edge, never a result.
        </p>
      </div>
    </div>
  );
}

// ── Chapter: common mistakes ───────────────────────────────────────────────

function Pitfalls() {
  const PITFALLS: { wrong: string; right: string }[] = [
    {
      wrong: "Picking a style first, then trying to sign into it.",
      right:
        "Read the squad you already have, pick the style it is closest to, and let transfers move you toward the style you want over seasons. A mismatched style costs you every week; a squad rebuild takes one.",
    },
    {
      wrong: "Chasing synergy over quality.",
      right:
        "The whole identity layer is bounded — a perfectly-suited player gains a fraction of what a genuinely better player brings. Sign the better footballer, then set the tactics around him.",
    },
    {
      wrong: "Assuming a class is a position.",
      right:
        "It isn't. There are Creator centre backs and Enforcer keepers. And the classes reachable at a position are fixed by the role roster — you cannot field an Engine striker, so a Gegenpress side has to accept its forwards will not be the ones gaining from it.",
    },
    {
      wrong: "Setting every dial to the aggressive option.",
      right:
        "High tempo, high press and a high line are not free upgrades. They cost fitness and they suit exactly two of the five classes. A Deep line is the correct setting for most defences in the game.",
    },
    {
      wrong: "Training a player toward the archetype you want him to have.",
      right:
        "That works, but slowly, and it is measured in seasons — the attributes have to actually move first. Growth also reads his training plan rather than his current archetype, so a plan change takes effect immediately even though the identity lags behind it.",
    },
    {
      wrong: "Ignoring the bench.",
      right:
        "Substitutes are drawn in bench order and fitness drops all match. Gegenpress in particular is unplayable without depth — it drains fitness far faster than any other style.",
    },
  ];

  return (
    <div className="space-y-2">
      {PITFALLS.map((p) => (
        <div key={p.wrong} className="rounded-md border border-line bg-base/30 px-3 py-2.5">
          <div className="flex gap-2 text-[12px]">
            <span className="shrink-0 text-loss">✗</span>
            <span className="font-medium text-ink">{p.wrong}</span>
          </div>
          <div className="mt-1 flex gap-2 text-[11.5px] leading-relaxed">
            <span className="shrink-0 text-win">✓</span>
            <span className="text-dim">{p.right}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── The tab itself ─────────────────────────────────────────────────────────

const CHAPTERS = [
  {
    id: "loop",
    title: "How team building works",
    lede: "The one loop everything else hangs off — and the five steps to building a side.",
    body: <HowItWorks />,
  },
  {
    id: "classes",
    title: "The five archetype classes",
    lede: "What each class is, what it thrives in, and what it wants by default.",
    body: <Classes />,
  },
  {
    id: "styles",
    title: "Building for each style of play",
    lede: "The full class × style grid, plus how to assemble a squad for all six.",
    body: <StyleGuide />,
  },
  {
    id: "builds",
    title: "The best side for each style",
    lede: "The ideal XI, role by role, for all six styles — and the dials it wants.",
    body: <StyleBuilds />,
  },
  {
    id: "dials",
    title: "The advanced instructions",
    lede: "The five dials, what they do to a match, and which roles want which settings.",
    body: <Instructions />,
  },
  {
    id: "roster",
    title: "All 45 archetypes",
    lede: "Every role, filterable by position and class, with its dial preferences.",
    body: <Roster />,
  },
  {
    id: "engine",
    title: "How it reaches the match engine",
    lede: "What a rating is made of, and how ratings become chances and goals.",
    body: <EngineGuide />,
  },
  {
    id: "pitfalls",
    title: "Common mistakes",
    lede: "Six things that look like good management and aren't.",
    body: <Pitfalls />,
  },
];

export default function TacticsHelp() {
  // The first chapter opens by default and the rest are folded: the page is a
  // reference, and a reader arrives with one question, not seven.
  const [open, setOpen] = useState<Record<string, boolean>>({ loop: true });
  const allOpen = CHAPTERS.every((c) => open[c.id]);

  return (
    <Section
      title="Guide"
      right={
        <button
          onClick={() =>
            setOpen(allOpen ? {} : Object.fromEntries(CHAPTERS.map((c) => [c.id, true])))
          }
          className="text-[11px] text-faint underline underline-offset-2 hover:text-ink"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      }
    >
      {/* Capped at a readable measure rather than run to the full page width —
          this is long-form prose and a 1600px line is unreadable. Left-aligned
          rather than centred so it lines up with the Section heading and the
          gold thread above it. */}
      <div className="max-w-4xl space-y-2">
        <p className="mb-4 text-[12px] leading-relaxed text-faint">
          Everything on this page is read from the same tables the match engine uses, so nothing
          here can quietly go out of date with the simulation.
        </p>
        {CHAPTERS.map((c) => (
          <Chapter
            key={c.id}
            id={c.id}
            title={c.title}
            lede={c.lede}
            open={!!open[c.id]}
            onToggle={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
          >
            {c.body}
          </Chapter>
        ))}
      </div>
    </Section>
  );
}
