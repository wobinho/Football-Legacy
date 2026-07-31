"use client";

// Facilities & Staff (v1.74) — the club's physical plant and its backroom.
//
// Training Facilities and Development Staff used to be two tabs on the
// Development page, which put them in the wrong place: Development is about
// individual players and where their growth is going, while these two are about
// the CLUB — what it has built and who it employs. They also had nothing to do
// with each other beyond both feeding the growth curve.
//
// v1.74: they are now two TABS of this page rather than two stacked sections.
// Stacking them meant the twelve facility cards always pushed the backroom below
// the fold, so "who do I employ" was a scroll rather than a click — and the two
// are alternatives you compare (build the centre, or hire the coach?), not a
// sequence you read top to bottom.
//
// v1.77: BOTH tabs are now placeholders. The facility panel joins the staff
// panel in being parked while the two are redesigned together — they are the
// same decision ("what does the club invest in?") and reworking one without the
// other would only have to be undone. `FacilitiesTab` is deliberately left in
// the tree, unreferenced, for that work to start from: the upgrade levels it
// edits are still live in the save and still feed the growth and recovery
// curves, so this is a hidden UI, not a removed feature.

import { useState } from "react";
// `StaffPanel` and `FacilitiesPanel` are intentionally still in the tree but no
// longer imported — both tabs are placeholders while the two are redesigned
// together, and those panels are what that work will start from.
import { Tabs } from "../ui";

type Tab = "facilities" | "staff";

export default function FacilitiesScreen() {
  const [tab, setTab] = useState<Tab>("facilities");
  return (
    <div>
      <Tabs
        tabs={[
          { id: "facilities", label: "Facilities" },
          { id: "staff", label: "Staff" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "facilities" ? <FacilitiesPlaceholder /> : <StaffTab />}
    </div>
  );
}

/** The shared "work in progress" panel both tabs currently show. One component
 * so the two read as the same deliberate state rather than two near-copies. */
function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-raised px-6 py-16 text-center">
      <div className="mb-3 text-3xl" aria-hidden>
        🚧
      </div>
      <div className="display gold-text mb-2 text-lg font-bold uppercase tracking-widest">{title}</div>
      <p className="max-w-md text-sm leading-relaxed text-faint">{children}</p>
    </div>
  );
}

/**
 * Staff — parked (v1.76).
 *
 * The hiring panel is pulled while the backroom is redesigned. It is a
 * placeholder rather than a removed tab on purpose: the staff a club employs
 * still feed the growth curve and the recovery rate under the hood, so the page
 * has to keep saying the feature exists and is coming back, not quietly
 * disappear and read as though it never did.
 */
function StaffTab() {
  return (
    <ComingSoon title="Backroom Staff">
      Hiring and managing your coaching and medical staff is still being built. It&apos;ll land in a
      future update — until then, your club&apos;s facilities carry the development work.
    </ComingSoon>
  );
}

/**
 * Facilities — parked (v1.77), for the same reason as Staff.
 *
 * The twelve upgrade cards are pulled while facilities and the backroom are
 * redesigned as one system. Every level a club has already bought is untouched
 * in the save and still feeds development, recovery and intake — this hides the
 * spending UI, it does not reset anything.
 */
function FacilitiesPlaceholder() {
  return (
    <ComingSoon title="Club Facilities">
      Building and upgrading your training ground is being reworked alongside the backroom staff.
      Any facilities you have already built are still running and still developing your squad — you
      just can&apos;t invest in new ones until this lands.
    </ComingSoon>
  );
}
