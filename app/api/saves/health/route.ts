import { NextResponse } from "next/server";
import { kvConfigured } from "@/lib/server/kv";

// Cheap probe the client uses to decide whether cloud saves are available on
// this deployment. `enabled: false` means "no KV store configured" — the app
// then relies on local IndexedDB alone.
export async function GET() {
  return NextResponse.json({ enabled: kvConfigured() });
}
