import { getSessionUser, isDemoMode } from "@/lib/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SignOutButton } from "@/components/sign-out-button";
import { TrackingControls } from "@/components/tracking-controls";
import { TimelinePanel } from "@/components/timeline-panel";
import { MergeCompanies } from "@/components/merge-companies";
import { CompanyCard } from "@/components/company-card";
import type { CompanyGroup } from "@/components/company-card";
import { AppNav } from "@/components/app-nav";
import { EngineStatus } from "@/components/engine-status";
import { OutcomeFunnel } from "@/components/outcome-funnel";
import { countStaleVerdicts } from "@/lib/cv/profile";
import { COMPANY_STATUS_RANK } from "@/lib/types";
import type { ApplicationStatus } from "@/lib/types";

/**
 * Four columns on screen, five statuses underneath.
 *
 * A job search has one question per stage: have they replied, are they talking
 * to me, did I get it, is it over. Online assessments, phone screens, take-home
 * tests and behavioural rounds are all the same answer to the second question —
 * splitting them gave a column that was empty most of the time and made the
 * board harder to read for no gain.
 *
 * Storage keeps OA distinct on purpose. The extractor can tell an assessment
 * invitation from an interview invitation, and throwing that away at write time
 * would be unrecoverable; folding it at render time is not.
 */
type Stage = "INTERVIEWING" | "APPLIED" | "OFFER" | "REJECTED";

const STAGE_OF: Record<ApplicationStatus, Stage> = {
  INTERVIEW: "INTERVIEWING",
  OA: "INTERVIEWING",
  APPLIED: "APPLIED",
  OFFER: "OFFER",
  REJECTED: "REJECTED",
};

// Live work first, settled outcomes after, dead last.
const STAGE_ORDER: Stage[] = ["INTERVIEWING", "APPLIED", "OFFER", "REJECTED"];

const STAGE_LABELS: Record<Stage, string> = {
  INTERVIEWING: "Interviewing",
  APPLIED: "Applied",
  OFFER: "Offers",
  REJECTED: "Rejected",
};

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const applications = await prisma.application.findMany({
    where: { userId: user.id },
    include: {
      _count: { select: { emails: true } },
    },
    orderBy: { lastEmailDate: "desc" },
  });

  const { stale, settled } = await countStaleVerdicts(user.id);

  // User-confirmed "these two names are the same employer". Applied at render
  // time, exactly like the role grouping below — the applications keep their
  // own company strings, so an unmerge is just deleting the row.
  const aliases = await prisma.companyAlias.findMany({
    where: { userId: user.id },
    select: { aliasNormalized: true, canonicalNormalized: true, canonicalLabel: true },
  });
  const aliasOf = new Map(aliases.map((a) => [a.aliasNormalized, a]));

  const syncState = await prisma.syncState.findUnique({
    where: { userId: user.id },
    select: { windowStart: true, lastSyncedAt: true },
  });

  // Every job-related email, not just the ones that became cards: the shape of
  // a search includes the mail that never turned into an application.
  const timelineEmails = await prisma.email.findMany({
    where: { userId: user.id, isJobRelated: true },
    orderBy: { internalDate: "asc" },
    select: {
      id: true,
      internalDate: true,
      subject: true,
      emailType: true,
      applicationId: true,
      application: { select: { company: true } },
    },
  });

  // Fold roles into companies for display only — the underlying applications
  // are untouched, so the funnel below still counts real applications.
  const byCompany = new Map<string, CompanyGroup>();
  for (const app of applications) {
    const status = app.status as ApplicationStatus;
    const alias = aliasOf.get(app.companyNormalized);
    const key = alias?.canonicalNormalized ?? app.companyNormalized;

    const group = byCompany.get(key) ?? {
      key,
      company: alias?.canonicalLabel ?? app.company,
      merged: Boolean(alias),
      status,
      roles: [],
      emailCount: 0,
    };

    group.roles.push({
      id: app.id,
      role: app.role,
      status,
      appliedDate: app.appliedDate,
      emailCount: app._count.emails,
    });
    group.emailCount += app._count.emails;
    if (COMPANY_STATUS_RANK[status] > COMPANY_STATUS_RANK[group.status]) {
      group.status = status;
    }
    // Prefer the longest spelling as the display name: "Acme (Australia)"
    // reads better than an abbreviation when both normalise to the same company.
    if (alias) group.merged = true;
    else if (app.company.length > group.company.length) {
      group.company = app.company;
    }

    byCompany.set(group.key, group);
  }
  const companies = [...byCompany.values()];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-gray-900">
              Nano-job-Tracker
            </h1>
            <AppNav current="/" />
          </div>
          <div className="flex items-center gap-4">
            <EngineStatus />
            {isDemoMode && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                Demo Mode
              </span>
            )}
            <span className="text-sm text-gray-600">{user.email}</span>
            {!isDemoMode && <SignOutButton />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <MergeCompanies
          companies={companies.map((g) => ({
            key: g.key,
            label: g.company,
            roleCount: g.roles.length,
            merged: g.merged,
          }))}
        />

        <TimelinePanel
          windowStart={syncState?.windowStart?.toISOString() ?? null}
          windowEnd={syncState?.lastSyncedAt?.toISOString() ?? null}
          events={timelineEmails.map((e) => ({
            id: e.id,
            at: e.internalDate.toISOString(),
            company: e.application?.company ?? "—",
            subject: e.subject,
            type: e.emailType ?? "other",
            applicationId: e.applicationId,
          }))}
        />

        {applications.length > 0 && (
          <div className="mb-6">
            <OutcomeFunnel
              statuses={applications.map((a) => a.status as ApplicationStatus)}
            />
            <p className="mt-2 text-xs text-gray-400">
              {applications.length} application
              {applications.length !== 1 ? "s" : ""} across {companies.length}{" "}
              {companies.length === 1 ? "company" : "companies"} — cards group by
              company, the counters above count applications.
            </p>
          </div>
        )}

        <div className="mb-6">
          {isDemoMode ? (
            <p className="text-xs text-gray-400">
              Demo mode: showing sample data. Configure Google OAuth in
              .env.local to sync your real Gmail (see README).
            </p>
          ) : (
            <TrackingControls staleCount={stale} settledCount={settled} />
          )}
        </div>

        {applications.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              Welcome, {user.name?.split(" ")[0]}!
            </h2>
            <p className="mt-2 max-w-sm text-sm text-gray-600">
              Sync your Gmail to automatically find job applications and build
              your interview prep dashboard.
            </p>
            <p className="mt-4 text-sm text-gray-600">
              Not applied anywhere yet? Start with a{" "}
              <a href="/analyze" className="font-medium text-blue-600 underline">
                pre-application JD analysis
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {STAGE_ORDER.map((stage) => {
              const groups = companies.filter(
                (g) => STAGE_OF[g.status] === stage
              );
              if (groups.length === 0) return null;

              return (
                <section key={stage}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                    {STAGE_LABELS[stage]} ({groups.length})
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {groups.map((group) => (
                      <CompanyCard key={group.key} group={group} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
