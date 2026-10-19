"use client";

import { useTransition } from "react";
import { updateApplicationStatus } from "@/actions/applications";
import { APPLICATION_STATUSES } from "@/lib/types";
import type { ApplicationStatus } from "@/lib/types";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: "Applied",
  OA: "Online Assessment",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
};

interface StatusSelectProps {
  applicationId: string;
  currentStatus: ApplicationStatus;
}

export function StatusSelect({ applicationId, currentStatus }: StatusSelectProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={currentStatus}
      disabled={isPending}
      onChange={(e) => {
        startTransition(async () => {
          await updateApplicationStatus(applicationId, e.target.value);
        });
      }}
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
    >
      {APPLICATION_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABELS[status]}
        </option>
      ))}
    </select>
  );
}
