"use client";

import { useTransition } from "react";
import { deleteApplication } from "@/actions/applications";

export function DeleteButton({ applicationId }: { applicationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      onClick={() => {
        if (!confirm("Delete this application? This cannot be undone.")) return;
        startTransition(async () => {
          await deleteApplication(applicationId);
        });
      }}
      className="rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {isPending ? "Deleting..." : "Delete"}
    </button>
  );
}
