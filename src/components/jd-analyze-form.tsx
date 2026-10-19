"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { analyzeJdAction } from "@/actions/nanobot";

interface JdAnalyzeFormProps {
  applicationId?: string;
  placeholder?: string;
  submitLabel?: string;
}

export function JdAnalyzeForm({
  applicationId,
  placeholder = "Paste the full job description here…",
  submitLabel = "Analyze with nanobot",
}: JdAnalyzeFormProps) {
  const [jdText, setJdText] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await analyzeJdAction({ jdText, applicationId });
      if (result.ok) {
        setJdText("");
        router.refresh();
      } else {
        setError({ message: result.error, code: result.code });
      }
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={jdText}
        onChange={(e) => setJdText(e.target.value)}
        disabled={isPending}
        rows={10}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 p-4 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={isPending || jdText.trim().length < 30}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {isPending ? "nanobot is thinking…" : submitLabel}
        </button>
        <span className="text-xs text-gray-400">
          DeepSeek · matched against the CV in nanobot&apos;s memory
        </span>
      </div>

      {isPending && (
        <div className="space-y-2 rounded-lg border bg-white p-6">
          <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error.message}</p>
          {error.code === "NO_CV" && (
            <Link
              href="/cv"
              className="mt-2 inline-block font-medium underline"
            >
              Go to My CV →
            </Link>
          )}
          {error.code === "OFFLINE" && (
            <p className="mt-2 text-xs text-red-600">
              Start the engine with{" "}
              <code className="rounded bg-red-100 px-1">nanobot serve</code>,
              then try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
