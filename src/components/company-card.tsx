import Link from "next/link";
import { DismissCardButton } from "./dismiss-card-button";
import type { ApplicationStatus } from "@/lib/types";

export interface CompanyRole {
  id: string;
  role: string;
  status: ApplicationStatus;
  appliedDate: Date | null;
  emailCount: number;
}

export interface CompanyGroup {
  key: string;
  company: string;
  /** True when this card is the result of a user-confirmed alias merge. */
  merged: boolean;
  status: ApplicationStatus;
  roles: CompanyRole[];
  emailCount: number;
}

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  APPLIED: "bg-blue-100 text-blue-800",
  OA: "bg-purple-100 text-purple-800",
  INTERVIEW: "bg-amber-100 text-amber-800",
  OFFER: "bg-green-100 text-green-800",
  REJECTED: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: "Applied",
  OA: "OA",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
};

/**
 * One card per company, roles nested inside.
 *
 * Extraction produces a separate application per role string, and the same job
 * legitimately arrives under several ("数据分析师", "Data Analyst", "Graduate
 * Data Analyst"), which turned one job into several cards. Merging those in
 * the data would mean deciding that two role names are synonyms — impossible
 * to do generically across languages, and a rule that merges Meta with
 * Facebook would also merge Google with Google Cloud for someone else.
 * Grouping at render time gets the readable dashboard with none of that risk,
 * and it matches how the search actually feels: you track a company, not a
 * string.
 */
export function CompanyCard({ group }: { group: CompanyGroup }) {
  const single = group.roles.length === 1;
  const only = group.roles[0];

  return (
    <div className="relative rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute right-1.5 top-1.5 z-10">
        <DismissCardButton
          ids={group.roles.map((r) => r.id)}
          company={group.company}
        />
      </div>
      {single ? (
        <Link href={`/applications/${only.id}`} className="block p-4">
          <CardHead group={group} />
          <CardMeta
            appliedDate={only.appliedDate}
            emailCount={group.emailCount}
          />
        </Link>
      ) : (
        <details className="group/details">
          <summary className="cursor-pointer list-none p-4">
            <CardHead group={group} />
            <CardMeta
              appliedDate={earliest(group.roles)}
              emailCount={group.emailCount}
              roleCount={group.roles.length}
            />
          </summary>
          <ul className="border-t">
            {group.roles.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/applications/${r.id}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-700">
                    {r.role}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[r.status]}`}
                  >
                    {STATUS_LABELS[r.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CardHead({ group }: { group: CompanyGroup }) {
  return (
    <div className="flex items-start justify-between">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-gray-900">{group.company}</h3>
        <p className="mt-0.5 truncate text-sm text-gray-600">
          {group.roles.length === 1
            ? group.roles[0].role
            : `${group.roles.length} roles`}
        </p>
      </div>
      <span
        className={`ml-2 mr-5 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[group.status]}`}
      >
        {STATUS_LABELS[group.status]}
      </span>
    </div>
  );
}

function CardMeta({
  appliedDate,
  emailCount,
  roleCount,
}: {
  appliedDate: Date | null;
  emailCount: number;
  roleCount?: number;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
      {appliedDate && (
        <span>
          {roleCount ? "First applied " : "Applied "}
          {appliedDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}
      <span>
        {emailCount} email{emailCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

function earliest(roles: CompanyRole[]): Date | null {
  const dates = roles
    .map((r) => r.appliedDate)
    .filter((d): d is Date => d !== null);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}
