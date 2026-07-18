import { NextResponse } from "next/server";
import { kvConfigured, kvSMembers, kvGet } from "@/lib/server/kv";
import { ownerFrom, kMeta, kIndex } from "@/lib/server/owner";
import type { SaveMeta } from "@/lib/save";

// GET /api/saves — list one player's cloud saves (metadata only), newest first.
export async function GET(req: Request) {
  if (!kvConfigured()) return NextResponse.json({ enabled: false, saves: [] }, { status: 501 });
  const owner = ownerFrom(req);
  if (!owner) return NextResponse.json({ error: "Unknown owner" }, { status: 403 });

  try {
    const names = await kvSMembers(kIndex(owner));
    const metas: SaveMeta[] = [];
    for (const name of names) {
      const raw = await kvGet(kMeta(owner, name));
      if (raw) {
        try {
          metas.push(JSON.parse(raw) as SaveMeta);
        } catch {
          /* skip a corrupt meta row */
        }
      }
    }
    metas.sort((a, b) => b.savedAt - a.savedAt);
    return NextResponse.json({ saves: metas });
  } catch {
    return NextResponse.json({ error: "Cloud read failed" }, { status: 502 });
  }
}
