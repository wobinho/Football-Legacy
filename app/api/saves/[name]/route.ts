import { NextResponse } from "next/server";
import { kvConfigured, kvGet, kvSet, kvDel, kvSAdd, kvSRem } from "@/lib/server/kv";
import { ownerFrom, kSave, kMeta, kIndex } from "@/lib/server/owner";
import type { GameState } from "@/lib/types";
import type { SaveMeta } from "@/lib/save";

// Per-save cloud operations, namespaced under the player's game-key id.
//   GET    /api/saves/:name  → the full GameState
//   PUT    /api/saves/:name  → upsert { state }
//   DELETE /api/saves/:name  → remove the save

function guard(req: Request): { owner: string } | NextResponse {
  if (!kvConfigured()) return NextResponse.json({ enabled: false }, { status: 501 });
  const owner = ownerFrom(req);
  if (!owner) return NextResponse.json({ error: "Unknown owner" }, { status: 403 });
  return { owner };
}

function metaOf(state: GameState): SaveMeta {
  return {
    saveName: state.saveName,
    managerName: state.managerName,
    teamName: state.teams[state.userTeamId]?.name ?? "?",
    season: state.season,
    savedAt: Date.now(),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const g = guard(req);
  if (g instanceof NextResponse) return g;
  const { name } = await params;
  try {
    const raw = await kvGet(kSave(g.owner, name));
    if (!raw) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ state: JSON.parse(raw) as GameState });
  } catch {
    return NextResponse.json({ error: "Cloud read failed" }, { status: 502 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const g = guard(req);
  if (g instanceof NextResponse) return g;
  const { name } = await params;
  try {
    const body = (await req.json()) as { state?: GameState };
    const state = body.state;
    if (!state || !state.players || !state.teams || state.saveName !== name) {
      return NextResponse.json({ error: "Bad save payload" }, { status: 400 });
    }
    await kvSet(kSave(g.owner, name), JSON.stringify(state));
    await kvSet(kMeta(g.owner, name), JSON.stringify(metaOf(state)));
    await kvSAdd(kIndex(g.owner), name);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cloud write failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const g = guard(req);
  if (g instanceof NextResponse) return g;
  const { name } = await params;
  try {
    await kvDel(kSave(g.owner, name));
    await kvDel(kMeta(g.owner, name));
    await kvSRem(kIndex(g.owner), name);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cloud delete failed" }, { status: 502 });
  }
}
