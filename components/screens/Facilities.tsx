"use client";

// Facilities & Staff (v1.72) — the club's physical plant and its backroom.
//
// Training Facilities and Development Staff used to be two tabs on the
// Development page, which put them in the wrong place: Development is about
// individual players and where their growth is going, while these two are about
// the CLUB — what it has built and who it employs. They also had nothing to do
// with each other beyond both feeding the growth curve.
//
// Both sections are placeholders for now, exactly as the two Development tabs
// were (v1.67): the systems behind them are mid-rework. The page exists so the
// navigation and information architecture are settled before the features land —
// the sections below are where each one will render.

import { Card, Section } from "../ui";

export default function FacilitiesScreen() {
  return (
    <div className="space-y-6">
      <Section title="Facilities">
        <WorkInProgress
          icon="🏗️"
          title="Facilities"
          blurb="The grounds the club owns and what they do for it — the training complex, the medical department, and the rest of the physical plant."
        />
      </Section>

      <Section title="Staff">
        <WorkInProgress
          icon="👔"
          title="Staff"
          blurb="The backroom the manager hires around them — coaching, medical, recruitment, and the departments they run."
        />
      </Section>
    </div>
  );
}

/** Placeholder body for a section whose system is mid-rework. Mirrors the
 * placeholder the Development page uses, so the two read as the same state of
 * work rather than as two different kinds of empty. */
function WorkInProgress({ icon, title, blurb }: { icon: string; title: string; blurb: string }) {
  return (
    <Card className="p-8 text-center">
      <div className="text-3xl">{icon}</div>
      <div className="mt-3 font-display text-lg uppercase tracking-wide">{title}</div>
      <div className="gold-thread mx-auto my-3 w-24" />
      <p className="mx-auto max-w-md text-[12px] leading-snug text-faint">{blurb}</p>
      <p className="mx-auto mt-3 max-w-sm text-[12px] leading-snug text-faint">
        Work in progress — this section is being built and is unavailable for now.
      </p>
    </Card>
  );
}
