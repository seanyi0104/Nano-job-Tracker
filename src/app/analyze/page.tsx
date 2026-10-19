import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { EngineStatus } from "@/components/engine-status";
import { JdAnalyzeForm } from "@/components/jd-analyze-form";
import { JdAnalysisBrowser } from "@/components/jd-analysis-browser";
import type { AnalysisRecord } from "@/components/jd-analysis-browser";

export default async function AnalyzePage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const [profile, analyses] = await Promise.all([
    prisma.cvProfile.findUnique({
      where: { userId: user.id },
      select: { syncedAt: true },
    }),
    prisma.jdAnalysis.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Dates cross the server/client boundary as strings; the browser component
  // re-hydrates them for display.
  const records: AnalysisRecord[] = analyses.map((a) => ({
    id: a.id,
    company: a.company,
    role: a.role,
    rating: a.rating,
    matchScore: a.matchScore,
    analysisJson: a.analysisJson,
    model: a.model,
    createdAt: a.createdAt.toISOString(),
    editedAt: a.editedAt?.toISOString() ?? null,
    jdText: a.jdText,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <AppNav current="/analyze" />
          <EngineStatus />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Pre-application analysis
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Paste a JD. nanobot extracts the requirements, recalls your CV from
            memory, and returns matches, gaps, and a verdict — before you spend
            an application on it.
          </p>
        </div>

        {!profile?.syncedAt && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            No CV in nanobot memory yet.{" "}
            <Link href="/cv" className="font-medium underline">
              Add one first
            </Link>{" "}
            — analysis needs something to match against.
          </div>
        )}

        <details
          open={records.length === 0}
          className="mb-8 rounded-lg border bg-white p-4"
        >
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            {records.length > 0 ? "Analyze another JD" : "Paste a job description"}
          </summary>
          <div className="mt-4">
            <JdAnalyzeForm />
          </div>
        </details>

        {records.length > 0 ? (
          <JdAnalysisBrowser records={records} />
        ) : (
          <p className="text-sm text-gray-500">
            No analyses yet. Paste a JD above to create the first one.
          </p>
        )}
      </main>
    </div>
  );
}
