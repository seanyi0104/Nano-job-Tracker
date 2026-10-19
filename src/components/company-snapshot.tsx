"use client";

import { PrepSection } from "./prep-section";
import { generateSnapshot } from "@/actions/prep";
import type { CompanySnapshot } from "@/lib/llm/schemas";

interface CompanySnapshotSectionProps {
  applicationId: string;
  snapshot: CompanySnapshot | null;
}

export function CompanySnapshotSection({
  applicationId,
  snapshot,
}: CompanySnapshotSectionProps) {
  return (
    <PrepSection
      title="Company Snapshot"
      hasContent={!!snapshot}
      onGenerate={async () => {
        await generateSnapshot(applicationId);
      }}
    >
      {snapshot ? (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Culture</h3>
            <p className="mt-1 text-sm text-gray-600">{snapshot.culture}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Core Values
            </h3>
            <div className="mt-1 flex flex-wrap gap-2">
              {snapshot.values.map((value, i) => (
                <span
                  key={i}
                  className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {value}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Engineering Focus
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {snapshot.engineeringFocus}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Interview Themes
            </h3>
            <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-600">
              {snapshot.interviewThemes.map((theme, i) => (
                <li key={i}>{theme}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          Click &quot;Generate&quot; to create a company research snapshot.
        </div>
      )}
    </PrepSection>
  );
}
