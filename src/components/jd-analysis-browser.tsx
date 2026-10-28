"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JdAnalysisView, RatingBadge } from "./jd-analysis-view";
import { JdAnalysisEditor } from "./jd-analysis-editor";
import {
  updateAnalysisAction,
  deleteAnalysisAction,
  reanalyzeJdAction,
} from "@/actions/nanobot";
import { JdAnalysisSchema } from "@/lib/nanobot/schemas";
import type { JdAnalysis, Rating } from "@/lib/nanobot/schemas";

export interface AnalysisRecord {
  id: string;
  company: string;
  role: string;
  rating: string;
  matchScore: number;
  analysisJson: string;
  model: string;
  createdAt: string;
  editedAt: string | null;
  jdText: string;
  /** Built on a CV other than the one saved now. */
  stale: boolean;
}

type Sort = "recent" | "score";

/**
 * Every analysis, grouped by company.
 *
 * This was a horizontal tab strip, one tab per analysis. It read fine at three
 * and could not survive thirty: tabs shrink until the labels are unreadable,
 * and someone who analysed four roles at the same employer got four tabs all
 * saying the same company name with nothing to tell them apart. Analyses
 * accumulate — that is the point of keeping them — so the list has to be built
 * for the hundredth one, not the third.
 *
 * Grouping by company mirrors the tracker's cards, so both halves of the
 * product answer "how am I doing with this employer" the same way. Search and
 * sort do the rest of the work a long list needs.
 */
export function JdAnalysisBrowser({ records }: { records: AnalysisRecord[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [openId, setOpenId] = useState<string | null>(records[0]?.id ?? null);
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(
    new Set()
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? records.filter(
          (r) =>
            r.company.toLowerCase().includes(q) ||
            r.role.toLowerCase().includes(q)
        )
      : records;

    const byCompany = new Map<string, AnalysisRecord[]>();
    for (const r of matched) {
      const list = byCompany.get(r.company) ?? [];
      list.push(r);
      byCompany.set(r.company, list);
    }

    const order = (a: AnalysisRecord, b: AnalysisRecord) =>
      sort === "score"
        ? b.matchScore - a.matchScore
        : Date.parse(b.createdAt) - Date.parse(a.createdAt);

    return [...byCompany.entries()]
      .map(([company, list]) => ({ company, list: [...list].sort(order) }))
      .sort((a, b) => order(a.list[0], b.list[0]));
  }, [records, query, sort]);

  if (records.length === 0) return null;

  const total = records.length;
  const shown = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company or role…"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm placeholder:text-gray-400"
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Sort</span>
          {(
            [
              ["recent", "Newest"],
              ["score", "Best match"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                sort === value
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        {query
          ? `${shown} of ${total} ${total === 1 ? "analysis" : "analyses"}`
          : `${total} ${total === 1 ? "analysis" : "analyses"} across ${groups.length} ${groups.length === 1 ? "company" : "companies"}`}
      </p>

      {groups.length === 0 && (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          Nothing matches “{query}”.
        </p>
      )}

      <div className="space-y-2">
        {groups.map((group) => {
          const isCollapsed = collapsedCompanies.has(group.company);
          const best = group.list.reduce((a, b) =>
            b.matchScore > a.matchScore ? b : a
          );

          return (
            <div
              key={group.company}
              className="overflow-hidden rounded-lg border bg-white"
            >
              <button
                onClick={() =>
                  setCollapsedCompanies((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.company)) next.delete(group.company);
                    else next.add(group.company);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="text-xs text-gray-400">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">
                  {group.company}
                </span>
                <RatingBadge
                  rating={best.rating as Rating}
                  score={best.matchScore}
                />
                <span className="shrink-0 text-xs text-gray-400">
                  {group.list.length}
                </span>
              </button>

              {!isCollapsed && (
                <ul className="border-t">
                  {group.list.map((r) => (
                    <AnalysisRow
                      key={r.id}
                      record={r}
                      open={openId === r.id}
                      onToggle={() =>
                        setOpenId((cur) => (cur === r.id ? null : r.id))
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AnalysisRow({
  record,
  open,
  onToggle,
}: {
  record: AnalysisRecord;
  open: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showJd, setShowJd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const parsed = parseAnalysis(record.analysisJson);

  function reanalyze() {
    setError(null);
    setReanalyzing(true);
    startTransition(async () => {
      const result = await reanalyzeJdAction(record.id);
      if (result.ok) router.refresh();
      else setError(result.error);
      setReanalyzing(false);
    });
  }

  function save(next: JdAnalysis) {
    setError(null);
    startTransition(async () => {
      const result = await updateAnalysisAction(record.id, next);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAnalysisAction(record.id);
      if (result.ok) router.refresh();
      else setError(result.error);
      setConfirmDelete(false);
    });
  }

  return (
    <li className="border-b last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50"
      >
        <RatingBadge
          rating={record.rating as Rating}
          score={record.matchScore}
        />
        <span className="min-w-0 flex-1 truncate text-gray-700">
          {record.role || "Untitled role"}
        </span>
        {record.editedAt && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            edited
          </span>
        )}
        <span className="shrink-0 text-xs text-gray-400">
          {new Date(record.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t bg-gray-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">
              {new Date(record.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <RowButton onClick={() => setShowJd((v) => !v)}>
                {showJd ? "Hide JD" : "View JD"}
              </RowButton>
              {!editing && (
                <>
                  <RowButton
                    onClick={() => setEditing(true)}
                    disabled={!parsed}
                  >
                    Edit
                  </RowButton>
                  <RowButton
                    onClick={() => setConfirmDelete(true)}
                    disabled={isPending}
                    danger
                  >
                    Delete
                  </RowButton>
                </>
              )}
            </div>
          </div>

          {confirmDelete && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-900">
                Delete this analysis for {record.company}? This cannot be undone.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={remove}
                  disabled={isPending}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showJd && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-white p-4 text-xs leading-relaxed text-gray-700">
              {record.jdText}
            </pre>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {!parsed ? (
            <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
              This analysis could not be read back (stored JSON no longer matches
              the expected shape). Re-run the JD to regenerate it.
            </div>
          ) : editing ? (
            <JdAnalysisEditor
              initial={parsed}
              saving={isPending}
              onCancel={() => setEditing(false)}
              onSave={save}
            />
          ) : (
            <JdAnalysisView
              analysis={parsed}
              analyzedAt={new Date(record.createdAt)}
              model={record.model}
              stale={record.stale}
              onReanalyze={reanalyze}
              reanalyzing={reanalyzing}
            />
          )}
        </div>
      )}
    </li>
  );
}

function RowButton({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 ${
        danger ? "text-red-600" : "text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function parseAnalysis(json: string): JdAnalysis | null {
  try {
    const result = JdAnalysisSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
