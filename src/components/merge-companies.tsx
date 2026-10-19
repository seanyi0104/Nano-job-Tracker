"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeCompaniesAction } from "@/actions/nanobot";

export interface MergeCandidate {
  key: string;
  label: string;
  roleCount: number;
  merged: boolean;
}

/**
 * Fold two company cards into one, on the user's say-so.
 *
 * The tracker already groups roles under a company, which handles the common
 * case — "数据分析师", "Data Analyst" and "Graduate Data Analyst" at one
 * employer all land on one card. What it cannot handle is the same employer
 * arriving under genuinely different names: PricewaterhouseCoopers and PwC,
 * or Meta and Facebook and 脸书. Deciding those are the same needs
 * knowledge of who you actually applied to, and a rule loose enough to infer
 * it would merge Google with Google Cloud for the next person.
 *
 * So it is manual — but manual in the right place. Asking someone to sort
 * fifteen hundred promotions by hand is a failure; asking them to confirm a
 * company pair three times in a job search is the only reliable way to get it
 * right. Tucked behind a summary line, because it is used rarely.
 */
export function MergeCompanies({
  companies,
}: {
  companies: MergeCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [into, setInto] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const mergedCount = companies.filter((c) => c.merged).length;

  function merge() {
    const alias = companies.find((c) => c.key === from);
    const canonical = companies.find((c) => c.key === into);
    if (!alias || !canonical) {
      setMessage("Pick both companies first.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await mergeCompaniesAction({
        aliasNormalized: alias.key,
        canonicalNormalized: canonical.key,
        canonicalLabel: canonical.label,
      });
      if (result.ok) {
        setMessage(`“${alias.label}” now shows under “${canonical.label}”.`);
        setFrom("");
        setInto("");
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }

  if (companies.length < 2) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left hover:bg-gray-50"
      >
        <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-semibold text-gray-900">
          Same company, different names?
        </span>
        <span className="text-xs text-gray-500">
          {mergedCount > 0
            ? `${mergedCount} already merged`
            : "Fold two cards into one"}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border bg-white p-4">
          <p className="text-xs text-gray-600">
            Cards already group roles under one employer. Use this when the same
            employer arrived under two different names — Meta and Facebook, or
            PricewaterhouseCoopers and PwC. Nothing is deleted: the merge is a
            display rule you can undo.
          </p>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={pending}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Fold this card…</option>
              {companies
                .filter((c) => c.key !== into)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({c.roleCount})
                  </option>
                ))}
            </select>

            <span className="text-gray-400">into</span>

            <select
              value={into}
              onChange={(e) => setInto(e.target.value)}
              disabled={pending}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">…this one</option>
              {companies
                .filter((c) => c.key !== from)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({c.roleCount})
                  </option>
                ))}
            </select>

            <button
              onClick={merge}
              disabled={pending || !from || !into}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {pending ? "Merging…" : "Merge"}
            </button>
          </div>

          {message && <p className="text-sm text-blue-800">{message}</p>}
        </div>
      )}
    </div>
  );
}
