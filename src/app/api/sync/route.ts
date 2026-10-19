import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/gmail/sync";

const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  const syncState = await prisma.syncState.findUnique({ where: { userId } });

  if (syncState?.status === "running") {
    const isStale =
      Date.now() - syncState.updatedAt.getTime() > STALE_THRESHOLD_MS;
    if (!isStale) {
      return NextResponse.json(
        { error: "Sync already in progress" },
        { status: 409 }
      );
    }
  }

  runSync(userId, { action: "update" }).catch((err) => {
    console.error("Sync failed unexpectedly:", err);
  });

  return NextResponse.json({ status: "started" }, { status: 202 });
}
