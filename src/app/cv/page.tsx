import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { CvForm } from "@/components/cv-form";
import { EngineStatus } from "@/components/engine-status";
import { StructuredCvSchema } from "@/lib/nanobot/cv-schema";
import type { StructuredCv } from "@/lib/nanobot/cv-schema";

// Per-user data from the local database: render on every request, never at
// build time. Demo mode reads no cookies, so without this Next would try to
// prerender the page, and `next build` on a fresh clone failed because the
// database did not exist yet.
export const dynamic = "force-dynamic";

export default async function CvPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const profile = await prisma.cvProfile.findUnique({
    where: { userId: user.id },
  });

  let structured: StructuredCv | null = null;
  if (profile?.structuredJson) {
    const parsed = StructuredCvSchema.safeParse(JSON.parse(profile.structuredJson));
    if (parsed.success) structured = parsed.data;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <AppNav current="/cv" />
          <EngineStatus />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My CV</h1>
          <p className="mt-1 text-sm text-gray-600">
            Upload a PDF or Word file to fill the fields, correct anything that
            came out wrong, then save. This CV is the one place your profile is
            defined — both JD analysis and email classification read from it.
          </p>
        </div>

        {profile?.syncError && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Last sync to nanobot failed: {profile.syncError}
          </div>
        )}

        <CvForm
          initial={structured}
          syncedAt={profile?.syncedAt?.toISOString() ?? null}
          syncError={profile?.syncError ?? null}
          sourceLabel={
            profile?.sourceName
              ? `${profile.sourceName}${profile.sourceAt ? ` · ${profile.sourceAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}`
              : null
          }
          hasUnstructuredCv={!structured && Boolean(profile?.content?.trim())}
        />

      </main>
    </div>
  );
}
