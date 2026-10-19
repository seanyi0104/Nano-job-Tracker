"use client";

import { useState } from "react";
import { RATING_ENUM, SEVERITY_ENUM } from "@/lib/nanobot/schemas";
import type { JdAnalysis, Rating, Severity } from "@/lib/nanobot/schemas";

interface JdAnalysisEditorProps {
  initial: JdAnalysis;
  onCancel: () => void;
  onSave: (analysis: JdAnalysis) => void;
  saving: boolean;
}

/**
 * Field-level editor for an analysis. The agent works from the JD text alone;
 * the user knows the rest (a referral, a recruiter conversation, that a listed
 * "requirement" is really a nice-to-have), so every field is correctable.
 */
export function JdAnalysisEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: JdAnalysisEditorProps) {
  const [draft, setDraft] = useState<JdAnalysis>(initial);

  const set = <K extends keyof JdAnalysis>(key: K, value: JdAnalysis[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-5 rounded-lg border border-blue-200 bg-white p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company">
          <input
            value={draft.company}
            onChange={(e) => set("company", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Role">
          <input
            value={draft.role}
            onChange={(e) => set("role", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Rating">
          <select
            value={draft.rating}
            onChange={(e) => set("rating", e.target.value as Rating)}
            className={inputClass}
          >
            {RATING_ENUM.options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Match score (0-100)">
          <input
            type="number"
            min={0}
            max={100}
            value={draft.matchScore}
            onChange={(e) =>
              set("matchScore", Math.max(0, Math.min(100, Number(e.target.value) || 0)))
            }
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Verdict">
        <textarea
          value={draft.verdict}
          onChange={(e) => set("verdict", e.target.value)}
          rows={2}
          className={inputClass}
        />
      </Field>

      <ListEditor
        label="Matches"
        items={draft.matches}
        onChange={(matches) => set("matches", matches)}
        blank={{ point: "", evidence: "" }}
        render={(item, update) => (
          <>
            <input
              value={item.point}
              onChange={(e) => update({ ...item, point: e.target.value })}
              placeholder="What the JD asks for that you have"
              className={inputClass}
            />
            <input
              value={item.evidence}
              onChange={(e) => update({ ...item, evidence: e.target.value })}
              placeholder="Evidence from your CV"
              className={`${inputClass} mt-1 text-xs`}
            />
          </>
        )}
      />

      <ListEditor
        label="Gaps"
        items={draft.gaps}
        onChange={(gaps) => set("gaps", gaps)}
        blank={{ gap: "", severity: "medium" as Severity, mitigation: "" }}
        render={(item, update) => (
          <>
            <div className="flex gap-2">
              <input
                value={item.gap}
                onChange={(e) => update({ ...item, gap: e.target.value })}
                placeholder="What is missing"
                className={`${inputClass} flex-1`}
              />
              <select
                value={item.severity}
                onChange={(e) =>
                  update({ ...item, severity: e.target.value as Severity })
                }
                className={`${inputClass} w-28 shrink-0`}
              >
                {SEVERITY_ENUM.options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={item.mitigation}
              onChange={(e) => update({ ...item, mitigation: e.target.value })}
              placeholder="How to close it"
              className={`${inputClass} mt-1 text-xs`}
            />
          </>
        )}
      />

      <Field label="Keywords (comma separated)">
        <input
          value={draft.keywords.join(", ")}
          onChange={(e) =>
            set(
              "keywords",
              e.target.value.split(",").map((k) => k.trim()).filter(Boolean)
            )
          }
          className={inputClass}
        />
      </Field>

      <Field label="Before you apply (one per line)">
        <textarea
          value={draft.suggestions.join("\n")}
          onChange={(e) =>
            set("suggestions", e.target.value.split("\n").filter((s) => s.trim()))
          }
          rows={4}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-2 border-t pt-4">
        <button
          onClick={() => onSave(draft)}
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ListEditor<T>({
  label,
  items,
  onChange,
  blank,
  render,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  render: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <button
          onClick={() => onChange([...items, blank])}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-md border border-gray-200 p-2">
            {render(item, (next) =>
              onChange(items.map((x, j) => (j === i ? next : x)))
            )}
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="mt-1 text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-gray-400">None — use “Add”.</p>
        )}
      </div>
    </div>
  );
}
