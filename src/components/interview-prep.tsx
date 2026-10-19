"use client";

import { PrepSection } from "./prep-section";
import { generateInterviewPrepAction } from "@/actions/prep";
import type { InterviewPrep } from "@/lib/llm/schemas";

interface InterviewPrepSectionProps {
  applicationId: string;
  prep: InterviewPrep | null;
}

export function InterviewPrepSection({
  applicationId,
  prep,
}: InterviewPrepSectionProps) {
  return (
    <PrepSection
      title="Interview Preparation"
      hasContent={!!prep}
      onGenerate={async () => {
        await generateInterviewPrepAction(applicationId);
      }}
    >
      {prep ? (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Process Overview
            </h3>
            <p className="mt-1 text-sm text-gray-600">{prep.processOverview}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Interview Stages
            </h3>
            <div className="mt-2 space-y-2">
              {prep.stages.map((stage, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-md bg-gray-50 p-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {stage.name}
                    </p>
                    <p className="text-sm text-gray-600">{stage.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Preparation Checklist
            </h3>
            <ul className="mt-2 space-y-1.5">
              {prep.checklist.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-gray-600">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          Click &quot;Generate&quot; to create interview preparation materials.
        </div>
      )}
    </PrepSection>
  );
}
