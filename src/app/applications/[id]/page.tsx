import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { StatusSelect } from "@/components/status-select";
import { DeleteButton } from "@/components/delete-button";
import { CompanySnapshotSection } from "@/components/company-snapshot";
import { InterviewPrepSection } from "@/components/interview-prep";
import { BehavioralQuestionsSection } from "@/components/behavioral-questions";
import { CompanySnapshotSchema, InterviewPrepSchema } from "@/lib/llm/schemas";
import type { ApplicationStatus } from "@/lib/types";

const EMAIL_TYPE_LABELS: Record<string, string> = {
  applied: "Application",
  recruiter_outreach: "Recruiter",
  interview: "Interview",
  oa: "Online Assessment",
  rejection: "Rejection",
  offer: "Offer",
  other: "Other",
};

const EMAIL_TYPE_COLORS: Record<string, string> = {
  applied: "bg-blue-100 text-blue-700",
  recruiter_outreach: "bg-indigo-100 text-indigo-700",
  interview: "bg-amber-100 text-amber-700",
  oa: "bg-purple-100 text-purple-700",
  rejection: "bg-gray-100 text-gray-600",
  offer: "bg-green-100 text-green-700",
  other: "bg-gray-100 text-gray-600",
};

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");

  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
    include: {
      emails: { orderBy: { internalDate: "desc" } },
      prep: true,
      questions: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!application) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-8 rounded-xl border bg-white p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {application.company}
              </h1>
              <p className="mt-1 text-lg text-gray-600">{application.role}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusSelect
                applicationId={application.id}
                currentStatus={application.status as ApplicationStatus}
              />
              <DeleteButton applicationId={application.id} />
            </div>
          </div>

          <div className="mt-4 flex gap-4 text-sm text-gray-500">
            {application.appliedDate && (
              <span>
                Applied:{" "}
                {application.appliedDate.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
            <span>{application.emails.length} email{application.emails.length !== 1 ? "s" : ""}</span>
            {application.statusIsManual && (
              <span className="italic text-gray-400">(manually set)</span>
            )}
          </div>
        </div>

        <div className="space-y-6">

          <section>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Email Timeline
            </h2>
            {application.emails.length === 0 ? (
              <p className="text-sm text-gray-500">No emails linked yet.</p>
            ) : (
              <div className="space-y-3">
                {application.emails.map((email) => (
                  <div
                    key={email.id}
                    className="rounded-lg border bg-white p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">
                          {email.subject}
                        </p>
                        <p className="mt-0.5 text-sm text-gray-500">
                          From: {email.fromAddress}
                        </p>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        {email.emailType && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${EMAIL_TYPE_COLORS[email.emailType] ?? EMAIL_TYPE_COLORS.other}`}
                          >
                            {EMAIL_TYPE_LABELS[email.emailType] ?? email.emailType}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {email.internalDate.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                    {email.snippet && (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                        {email.snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <CompanySnapshotSection
            applicationId={application.id}
            snapshot={parseJson(application.prep?.snapshotJson, CompanySnapshotSchema)}
          />

          <InterviewPrepSection
            applicationId={application.id}
            prep={parseJson(application.prep?.interviewPrepJson, InterviewPrepSchema)}
          />

          <BehavioralQuestionsSection
            applicationId={application.id}
            questions={application.questions.map((q) => ({
              id: q.id,
              question: q.question,
              rationale: q.rationale,
              userAnswer: q.userAnswer,
            }))}
          />
        </div>
      </main>
    </div>
  );
}

function parseJson<T>(
  json: string | null | undefined,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } }
): T | null {
  if (!json) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? (parsed.data as T) : null;
  } catch {
    return null;
  }
}
