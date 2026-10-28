import type { JdAnalysis, Rating, Severity } from "@/lib/nanobot/schemas";

export const RATING_COLORS: Record<Rating, string> = {
  S: "bg-emerald-100 text-emerald-800",
  A: "bg-blue-100 text-blue-800",
  B: "bg-amber-100 text-amber-800",
  C: "bg-gray-100 text-gray-600",
};

const RATING_HINTS: Record<Rating, string> = {
  S: "Strong match — apply first",
  A: "Good match — worth applying",
  B: "Partial match — prep before applying",
  C: "Weak match — low expected value",
};

const SEVERITY_COLORS: Record<Severity, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-600",
};

export function RatingBadge({
  rating,
  score,
}: {
  rating: Rating;
  score?: number;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${RATING_COLORS[rating]}`}
      title={RATING_HINTS[rating]}
    >
      {rating}
      {score !== undefined && (
        <span className="font-normal opacity-70">{score}</span>
      )}
    </span>
  );
}

export function JdAnalysisView({
  analysis,
  analyzedAt,
  model,
  stale,
  onReanalyze,
  reanalyzing,
}: {
  analysis: JdAnalysis;
  analyzedAt?: Date;
  model?: string;
  /** Built on a CV other than the one saved now. */
  stale?: boolean;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}) {
  return (
    <div className="space-y-5 rounded-lg border bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900">
              {analysis.company}
            </h3>
            <RatingBadge rating={analysis.rating} />
          </div>
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {analysis.role}
          </p>
        </div>
        <ScoreDial score={analysis.matchScore} />
      </div>

      <p className="rounded-md bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800">
        {analysis.verdict}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-700">
            Matches ({analysis.matches.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {analysis.matches.map((m, i) => (
              <li key={i} className="rounded-md border border-emerald-100 bg-emerald-50/50 p-3">
                <p className="text-sm font-medium text-gray-800">{m.point}</p>
                <p className="mt-0.5 text-xs text-gray-600">{m.evidence}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700">
            Gaps ({analysis.gaps.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {analysis.gaps.map((g, i) => (
              <li key={i} className="rounded-md border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">{g.gap}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${SEVERITY_COLORS[g.severity]}`}
                  >
                    {g.severity}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{g.mitigation}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {analysis.keywords.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700">
            Keywords to mirror in your CV
          </h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.keywords.map((k, i) => (
              <span
                key={i}
                className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.suggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700">Before you apply</h4>
          <ul className="mt-2 list-inside list-decimal space-y-1 text-sm text-gray-600">
            {analysis.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {(analyzedAt || model) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-3 text-xs text-gray-400">
          <span>
            Analyzed by nanobot{model ? ` (${model})` : ""}
            {analyzedAt
              ? ` · ${analyzedAt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
          {/* Quiet on purpose. An older CV makes the analysis suspect, but
              re-running is the user's call: many analyses have served their
              purpose and are not worth paying for again after every CV edit. */}
          {stale && (
            <>
              <span className="text-red-400">· Based on an older CV</span>
              {onReanalyze && (
                <button
                  onClick={onReanalyze}
                  disabled={reanalyzing}
                  className="rounded border border-red-200 px-1.5 py-0.5 font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                >
                  {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "text-emerald-600"
      : score >= 70
        ? "text-blue-600"
        : score >= 50
          ? "text-amber-600"
          : "text-gray-500";

  return (
    <div className="shrink-0 text-right">
      <div className={`text-2xl font-bold leading-none ${tone}`}>{score}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
        match
      </div>
    </div>
  );
}
