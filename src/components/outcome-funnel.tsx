import { OUTCOMES, STATUS_TO_OUTCOME } from "@/lib/types";
import type { ApplicationStatus, Outcome } from "@/lib/types";

const OUTCOME_LABELS: Record<Outcome, string> = {
  PENDING: "Pending",
  SUCCESS: "Success",
  FAIL: "Fail",
};

const OUTCOME_STYLES: Record<Outcome, string> = {
  PENDING: "border-blue-200 bg-blue-50 text-blue-900",
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-900",
  FAIL: "border-gray-200 bg-gray-50 text-gray-700",
};

/**
 * The application lifecycle collapsed to Pending / Success / Fail, plus the
 * detailed statuses that feed each bucket.
 */
export function OutcomeFunnel({
  statuses,
}: {
  statuses: ApplicationStatus[];
}) {
  const counts = statuses.reduce<Record<Outcome, number>>(
    (acc, status) => {
      acc[STATUS_TO_OUTCOME[status]] += 1;
      return acc;
    },
    { PENDING: 0, SUCCESS: 0, FAIL: 0 }
  );

  const total = statuses.length;
  const decided = counts.SUCCESS + counts.FAIL;
  const successRate = decided > 0 ? Math.round((counts.SUCCESS / decided) * 100) : null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {OUTCOMES.map((outcome) => (
        <div
          key={outcome}
          className={`rounded-lg border p-4 ${OUTCOME_STYLES[outcome]}`}
        >
          <div className="text-2xl font-bold leading-none">
            {counts[outcome]}
          </div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wider opacity-70">
            {OUTCOME_LABELS[outcome]}
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-2xl font-bold leading-none text-gray-900">
          {successRate === null ? "—" : `${successRate}%`}
        </div>
        <div className="mt-1 text-xs font-medium uppercase tracking-wider text-gray-400">
          Success rate
        </div>
        <div className="mt-1 text-[10px] text-gray-400">
          {decided} of {total} decided
        </div>
      </div>
    </div>
  );
}
