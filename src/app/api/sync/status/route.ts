import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncState = await prisma.syncState.findUnique({
    where: { userId: user.id },
  });

  if (!syncState) {
    return NextResponse.json({
      status: "idle",
      phase: null,
      fetched: 0,
      total: 0,
      lastSyncedAt: null,
      windowStart: null,
      lastAction: null,
      lastError: null,
    });
  }

  return NextResponse.json({
    status: syncState.status,
    phase: syncState.progressPhase,
    fetched: syncState.progressFetched,
    total: syncState.progressTotal,
    lastSyncedAt: syncState.lastSyncedAt,
    windowStart: syncState.windowStart,
    lastAction: syncState.lastAction,
    lastError: syncState.lastError,
  });
}
