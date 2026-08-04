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

// ── Stored form (v1.92) ─────────────────────────────────────────────────────
// A compressed upload is stored EXACTLY as it arrived — base64 of the gzip
// bytes, under a `gz:` marker — and served straight back in that form. The
// function never inflates it.
//
// That is the whole point. Metered transfer is billed on both the browser →
// function hop and the function → KV hop, so decompressing here to store JSON
// would throw away half the saving and add the CPU cost of inflating tens of
// megabytes on every autosave. It also means the route does no parsing on the
// hot path: the save is opaque bytes to it.
//
// The cost is that the server can no longer read the payload to derive the
// metadata for the save list, so the client sends `meta` alongside — see PUT.
// Uncompressed uploads (a browser without CompressionStream, or a save written
// before v1.92) keep the original JSON path, so both forms coexist forever and
// no existing cloud save is stranded.
const GZ_PREFIX = "gz:";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const g = guard(req);
  if (g instanceof NextResponse) return g;
  const { name } = await params;
  try {
    const raw = await kvGet(kSave(g.owner, name));
    if (!raw) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (raw.startsWith(GZ_PREFIX)) {
      // Hand back the stored gzip bytes untouched; the client inflates them.
      const bytes = Buffer.from(raw.slice(GZ_PREFIX.length), "base64");
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream", "x-fl-encoding": "gzip" },
      });
    }
    // Pre-v1.92 plain JSON: already `{"state":…}`-less, so wrap it as the client
    // expects without parsing and re-serialising a multi-megabyte object.
    return new NextResponse(`{"state":${raw}}`, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Cloud read failed" }, { status: 502 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const g = guard(req);
  if (g instanceof NextResponse) return g;
  const { name } = await params;
  try {
    if (req.headers.get("x-fl-encoding") === "gzip") {
      const bytes = Buffer.from(await req.arrayBuffer());
      if (!bytes.length) return NextResponse.json({ error: "Bad save payload" }, { status: 400 });
      // The metadata rides in a header rather than in the compressed body: the
      // save list has to show a manager, club and season without the server ever
      // inflating the save. Malformed or missing meta is not fatal — a save with
      // a thin listing is far better than a lost save.
      let meta: SaveMeta | null = null;
      try {
        const h = req.headers.get("x-fl-meta");
        if (h) meta = JSON.parse(Buffer.from(h, "base64").toString("utf8")) as SaveMeta;
      } catch {
        meta = null;
      }
      await kvSet(kSave(g.owner, name), GZ_PREFIX + bytes.toString("base64"));
      await kvSet(
        kMeta(g.owner, name),
        JSON.stringify({
          saveName: name,
          managerName: meta?.managerName ?? "?",
          teamName: meta?.teamName ?? "?",
          season: meta?.season ?? 1,
          savedAt: Date.now(),
        } satisfies SaveMeta)
      );
      await kvSAdd(kIndex(g.owner), name);
      return NextResponse.json({ ok: true });
    }

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
