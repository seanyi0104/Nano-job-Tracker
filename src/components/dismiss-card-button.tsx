"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteApplicationsAction } from "@/actions/nanobot";

/**
 * Remove a card that is not a real application.
 *
 * Visible at rest, in the lightest grey that still reads. It was hover-only at
 * first, on the argument that false positives are rare and a delete control on
 * every card is clutter — but a control nobody can find is not restraint, it
 * is a missing feature. Someone looking at a wrong card has no reason to
 * suspect that hovering reveals the fix.
 *
 * It confirms in place rather than through a dialog: the whole action undoes
 * one wrong guess, and a modal costs more attention than the mistake did.
 */
export function DismissCardButton({
  ids,
  company,
}: {
  ids: string[];
  company: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    startTransition(async () => {
      await deleteApplicationsAction(ids);
      setConfirming(false);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-500">Not an application?</span>
        <button
          onClick={remove}
          disabled={pending}
          className="font-medium text-red-600 hover:underline disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-gray-500 hover:underline disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label={`Remove ${company}`}
      title="Not a real application — remove this card"
      className="rounded p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-red-600"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}
