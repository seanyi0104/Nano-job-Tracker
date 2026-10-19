"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  parseCvUploadAction,
  parseStoredCvAction,
  saveStructuredCvAction,
} from "@/actions/nanobot";
import { EMPTY_CV } from "@/lib/nanobot/cv-schema";
import type {
  CvEducation,
  CvExperience,
  CvProject,
  StructuredCv,
} from "@/lib/nanobot/cv-schema";

interface CvFormProps {
  initial: StructuredCv | null;
  /** Filename (or "Entered by hand") the saved fields came from. */
  sourceLabel: string | null;
  /** True when a CV exists as plain text but has never been structured. */
  hasUnstructuredCv: boolean;
  /** When this CV last reached nanobot's memory, ISO, or null if never. */
  syncedAt: string | null;
  /**
   * Set when the last save reached the database but not nanobot — the engine
   * was offline. The fields then match the database but not the agent's
   * memory, so the form is clean yet not settled.
   */
  syncError: string | null;
}

/**
 * Field-level CV editor. A CV is edited constantly and in small increments —
 * one bullet, one date, one new project — so the unit of editing is a field,
 * not a wall of text. Saving re-renders the whole CV to Markdown and pushes
 * that to nanobot, keeping the agent's memory the single source of truth.
 */
export function CvForm({
  initial,
  sourceLabel,
  hasUnstructuredCv,
  syncedAt,
  syncError,
}: CvFormProps) {
  const [cv, setCv] = useState<StructuredCv>(initial ?? EMPTY_CV);
  const [dirty, setDirty] = useState(false);
  // Tracks the document the fields on screen came from, before it is saved.
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    { tone: "ok" | "error" | "info"; message: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // What each consumer holds, stated separately. A save writes the database
  // first and nanobot second, so the two can disagree: with the engine offline
  // the database has the new CV and the agent's memory the old one. A single
  // shared tick used to show both as done after exactly that failure — and
  // because the form was clean, Save stayed disabled, so the only way to retry
  // was a dummy edit. Any edit clears all of this, because at that moment
  // neither consumer holds what is on screen.
  const clean = !dirty && !isPending;
  const inDatabase = clean && Boolean(syncedAt || syncError);
  const inMemory = clean && Boolean(syncedAt) && !syncError;
  const memoryBehind = clean && Boolean(syncError);

  function update(next: StructuredCv) {
    setCv(next);
    setDirty(true);
  }

  function onUpload(file: File) {
    setFeedback({ tone: "info", message: `Reading ${file.name} …` });
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      const result = await parseCvUploadAction(form);
      if (result.ok) {
        setCv(result.data.cv);
        setDirty(true);
        setPendingSource(result.data.sourceName);
        setFeedback({
          tone: "ok",
          message: `Parsed ${result.data.sourceName} into fields. Check them, fix anything wrong, then save.`,
        });
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function parseStored() {
    setFeedback({ tone: "info", message: "Parsing your stored CV text …" });
    startTransition(async () => {
      const result = await parseStoredCvAction();
      if (result.ok) {
        setCv(result.data.cv);
        setDirty(true);
        setPendingSource("Parsed from stored text");
        setFeedback({
          tone: "ok",
          message: "Your existing CV is now in fields. Check them, then save.",
        });
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
    });
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveStructuredCvAction(cv, pendingSource ?? undefined);
      if (result.ok) {
        setDirty(false);
        setPendingSource(null);
        setFeedback({
          tone: "ok",
          message: `Saved — ${result.data.headline}`,
        });
      } else {
        setFeedback({ tone: "error", message: result.error });
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5">
        {/* The native control is hidden behind a label rather than styled.
            Chrome renders its own "no file selected" caption beside the button
            and there is no way to remove it, so the page carried two answers to
            the same question — that caption, and the "Currently loaded" line
            below, which is the one that is actually true after a save. */}
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex cursor-pointer items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 ${
              isPending ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {isPending ? "Reading…" : "Choose file"}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              disabled={isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
              className="sr-only"
            />
          </label>
          <span className="text-xs text-gray-500">
            PDF / .docx / .txt — fills every field below, you correct them.
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Word .doc is not supported — save as .docx or PDF first. Scanned PDFs
          without a text layer will not parse.
        </p>

        {/* Without this the page gives no sign an upload was read, so a silent
            failure and a successful parse look identical. */}
        <p className="mt-3 text-xs">
          {pendingSource ? (
            <span className="text-amber-700">
              Fields below came from <strong>{pendingSource}</strong> — not saved yet.
            </span>
          ) : sourceLabel ? (
            <span className="text-gray-500">
              Currently loaded: <strong>{sourceLabel}</strong>
            </span>
          ) : (
            <span className="text-gray-400">No CV loaded yet.</span>
          )}
        </p>

        <p className="mt-1 text-xs text-gray-400">
          Uploading again simply replaces the fields — nothing to delete first.
        </p>

        {hasUnstructuredCv && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <button
              onClick={parseStored}
              disabled={isPending}
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
            >
              Parse my existing CV into fields
            </button>
            <span className="text-xs text-gray-500">
              You already have a CV stored as plain text — no need to re-upload.
            </span>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            feedback.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : feedback.tone === "info"
                ? "border-blue-200 bg-blue-50 text-blue-800"
                : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <Section title="基本信息 / Basics" defaultOpen>
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="姓名 Name" value={cv.basics.name}
            onChange={(v) => update({ ...cv, basics: { ...cv.basics, name: v } })} />
          <Text label="邮箱 Email" value={cv.basics.email}
            onChange={(v) => update({ ...cv, basics: { ...cv.basics, email: v } })} />
          <Text label="电话 Phone" value={cv.basics.phone}
            onChange={(v) => update({ ...cv, basics: { ...cv.basics, phone: v } })} />
          <Text label="所在地 Location" value={cv.basics.location}
            onChange={(v) => update({ ...cv, basics: { ...cv.basics, location: v } })} />
        </div>
        <Text
          label="求职意向 Target role"
          hint="国内简历最吃重的一行，写清岗位方向"
          value={cv.basics.jobTarget}
          onChange={(v) => update({ ...cv, basics: { ...cv.basics, jobTarget: v } })}
        />
        <Lines label="链接 Links (one per line)" value={cv.basics.links}
          onChange={(v) => update({ ...cv, basics: { ...cv.basics, links: v } })} />
        <Area label="个人简介 Summary" rows={3} value={cv.basics.summary}
          onChange={(v) => update({ ...cv, basics: { ...cv.basics, summary: v } })} />
      </Section>

      <Section title={`教育背景 / Education (${cv.education.length})`} defaultOpen>
        <Repeater<CvEducation>
          items={cv.education}
          onChange={(education) => update({ ...cv, education })}
          blank={{ school: "", degree: "", major: "", startDate: "", endDate: "", gpa: "", highlights: [] }}
          title={(e) => e.school || "New entry"}
          render={(e, set) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text label="学校 School" value={e.school} onChange={(v) => set({ ...e, school: v })} />
                <Text label="学位 Degree" value={e.degree} onChange={(v) => set({ ...e, degree: v })} />
                <Text label="专业 Major" value={e.major} onChange={(v) => set({ ...e, major: v })} />
                <Text label="GPA / WAM" value={e.gpa} onChange={(v) => set({ ...e, gpa: v })} />
                <Text label="开始 Start" value={e.startDate} onChange={(v) => set({ ...e, startDate: v })} />
                <Text label="毕业 End" value={e.endDate} onChange={(v) => set({ ...e, endDate: v })} />
              </div>
              <Lines label="亮点 Highlights (one per line)" value={e.highlights}
                onChange={(v) => set({ ...e, highlights: v })} />
            </>
          )}
        />
      </Section>

      <Section title={`实习/工作经历 / Experience (${cv.experience.length})`} defaultOpen>
        <Repeater<CvExperience>
          items={cv.experience}
          onChange={(experience) => update({ ...cv, experience })}
          blank={{ company: "", title: "", location: "", startDate: "", endDate: "", bullets: [] }}
          title={(x) => [x.company, x.title].filter(Boolean).join(" — ") || "New entry"}
          render={(x, set) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Text label="公司 Company" value={x.company} onChange={(v) => set({ ...x, company: v })} />
                <Text label="职位 Title" value={x.title} onChange={(v) => set({ ...x, title: v })} />
                <Text label="地点 Location" value={x.location} onChange={(v) => set({ ...x, location: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Text label="开始" value={x.startDate} onChange={(v) => set({ ...x, startDate: v })} />
                  <Text label="结束" value={x.endDate} onChange={(v) => set({ ...x, endDate: v })} />
                </div>
              </div>
              <Lines
                label="经历描述 Bullets (one per line)"
                hint="保留量化数据：百分比、耗时、数据量"
                value={x.bullets}
                onChange={(v) => set({ ...x, bullets: v })}
              />
            </>
          )}
        />
      </Section>

      <Section title={`项目经历 / Projects (${cv.projects.length})`} defaultOpen>
        <Repeater<CvProject>
          items={cv.projects}
          onChange={(projects) => update({ ...cv, projects })}
          blank={{ name: "", role: "", period: "", stack: [], bullets: [] }}
          title={(p) => p.name || "New project"}
          render={(p, set) => (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Text label="项目名 Name" value={p.name} onChange={(v) => set({ ...p, name: v })} />
                <Text label="角色 Role" value={p.role} onChange={(v) => set({ ...p, role: v })} />
                <Text label="时间 Period" value={p.period} onChange={(v) => set({ ...p, period: v })} />
              </div>
              <Csv label="技术栈 Stack (comma separated)" value={p.stack}
                onChange={(v) => set({ ...p, stack: v })} />
              <Lines label="项目描述 Bullets (one per line)" value={p.bullets}
                onChange={(v) => set({ ...p, bullets: v })} />
            </>
          )}
        />
      </Section>

      <Section title="技能 / Skills">
        <Csv label="编程语言 Languages" value={cv.skills.languages}
          onChange={(v) => update({ ...cv, skills: { ...cv.skills, languages: v } })} />
        <Csv label="框架/库 Frameworks" value={cv.skills.frameworks}
          onChange={(v) => update({ ...cv, skills: { ...cv.skills, frameworks: v } })} />
        <Csv label="工具 Tools" value={cv.skills.tools}
          onChange={(v) => update({ ...cv, skills: { ...cv.skills, tools: v } })} />
        <Csv label="其他 Other" value={cv.skills.other}
          onChange={(v) => update({ ...cv, skills: { ...cv.skills, other: v } })} />
      </Section>

      <Section title={`奖项与证书 / Awards (${cv.awards.length})`}>
        <Lines label="每行一条 One per line" value={cv.awards}
          onChange={(v) => update({ ...cv, awards: v })} />
      </Section>

      {/* One CV, two consumers, and the save has to say so.
          "Save to nanobot memory" named only half of what happens: the same
          click also updates the profile the email classifier is steered by,
          which lives in the database and never touches nanobot. Naming one
          destination made the other invisible — and the CV page is where a
          user decides whether their profile is set up, so a save that does not
          state what it settled leaves that question open. */}
      <div className="sticky bottom-4 space-y-2 rounded-lg border bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={isPending || !(dirty || memoryBehind)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {isPending ? "Saving…" : "Save CV"}
          </button>
          {dirty && !isPending && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          {memoryBehind && (
            <span className="text-xs text-amber-600">
              nanobot has the previous version — start it with{" "}
              <code className="rounded bg-amber-50 px-1">npm run engine</code>,
              then Save CV again
            </span>
          )}
          {inMemory && syncedAt && (
            <span className="text-xs text-green-700">
              Saved {new Date(syncedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <ul className="space-y-0.5 text-xs text-gray-500">
          <li className={memoryBehind ? "text-amber-700" : ""}>
            <span className={inMemory ? "text-green-700" : ""}>
              {inMemory ? "✓" : memoryBehind ? "✗" : "·"}
            </span>{" "}
            {memoryBehind ? "Not written" : "Written"} to nanobot memory (<code className="rounded bg-gray-100 px-1">CV.md</code>) — used by JD analysis
          </li>
          <li>
            <span className={inDatabase ? "text-green-700" : ""}>
              {inDatabase ? "✓" : "·"}
            </span>{" "}
            Written to the database — used by email classification in Tracker
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ── field primitives ─────────────────────────────────────────────── */

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
      {text}
      {hint && <span className="ml-2 font-normal normal-case text-gray-400">{hint}</span>}
    </span>
  );
}

function Text({
  label, value, onChange, hint,
}: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="block">
      <Label text={label} hint={hint} />
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  );
}

function Area({
  label, value, onChange, rows = 3,
}: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <Label text={label} />
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  );
}

function Lines({
  label, value, onChange, hint,
}: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  return (
    <label className="block">
      <Label text={label} hint={hint} />
      <textarea
        value={value.join("\n")}
        rows={Math.max(2, value.length + 1)}
        onChange={(e) => onChange(e.target.value.split("\n").filter((l) => l.trim()))}
        className={inputClass}
      />
    </label>
  );
}

function Csv({
  label, value, onChange,
}: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="block">
      <Label text={label} />
      <input
        value={value.join(", ")}
        onChange={(e) =>
          onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
        }
        className={inputClass}
      />
    </label>
  );
}

function Section({
  title, children, defaultOpen = false,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-lg border bg-white">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-gray-900">
        {title}
      </summary>
      <div className="space-y-3 border-t px-5 py-4">{children}</div>
    </details>
  );
}

function Repeater<T>({
  items, onChange, blank, render, title,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
  title: (item: T) => string;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <details key={i} open className="rounded-md border border-gray-200">
          <summary className="cursor-pointer bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
            {title(item)}
          </summary>
          <div className="space-y-3 p-3">
            {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
            <div className="flex gap-2 border-t pt-2">
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
              {i > 0 && (
                <button
                  onClick={() => {
                    const next = [...items];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                  className="text-xs text-gray-600 hover:underline"
                >
                  Move up
                </button>
              )}
            </div>
          </div>
        </details>
      ))}
      <button
        onClick={() => onChange([...items, blank])}
        className="rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
      >
        + Add
      </button>
    </div>
  );
}
