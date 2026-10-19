"use client";

import { useState } from "react";

/**
 * Surfaces the cost of a moving target: the CV defines what counts as a job
 * email, the CV changes, and every verdict reached before that change is now
 * an answer to a question nobody is asking any more. Rather than silently
 * re-running (expensive, on every edit) or silently ignoring it (a growing
 * blind spot), show the size of the gap and let the user close it.
 *
 * Dismissible, because a big CV rewrite is a normal event in a job search and
 * the old verdicts are meant to sit quietly afterwards. Re-judging them is
 * optional cleanup, not a chore the product should nag about — the work that
 * matters after a rewrite is Update, on the mail arriving next.
 *
 * It reports; it does not act. It used to carry its own re-judge button, which
 * meant two controls ran the same operation with different scopes — this one
 * swept every stale verdict, the panel below let you choose a range — and
 * nothing on screen said which was which. The Re-judge control sits directly
 * underneath, so a second way in bought nothing but another thing to read.
 */
export function StaleProfileBanner({
  staleCount,
  settledCount,
}: {
  staleCount: number;
  settledCount: number;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (staleCount === 0 || dismissed) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm text-blue-900">
        Your CV has changed since <strong>{staleCount.toLocaleString()}</strong>{" "}
        {staleCount === 1 ? "email was" : "emails were"} ruled out — an
        application that now matches your target could still be sitting in the
        rejected pile.
        {settledCount > 0 && (
          <>
            {" "}
            Another {settledCount.toLocaleString()} were bulk mail and stay
            settled; a new CV does not make a promotion worth re-reading.
          </>
        )}
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="mt-2 text-xs font-medium text-blue-700 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
