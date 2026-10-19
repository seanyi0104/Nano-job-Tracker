"use client";

import { useTransition } from "react";

interface PrepSectionProps {
  title: string;
  hasContent: boolean;
  onGenerate: () => Promise<void>;
  children: React.ReactNode;
}

export function PrepSection({
  title,
  hasContent,
  onGenerate,
  children,
}: PrepSectionProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <button
          onClick={() => startTransition(onGenerate)}
          disabled={isPending}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          {isPending ? "Generating..." : hasContent ? "Regenerate" : "Generate"}
        </button>
      </div>

      {isPending ? (
        <div className="space-y-3 rounded-lg border bg-white p-6">
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200" />
        </div>
      ) : (
        children
      )}
    </section>
  );
}
