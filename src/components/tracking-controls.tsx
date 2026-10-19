"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  previewResetAction,
  resetAction,
  previewRejudgeAction,
  rejudgeStaleEmailsAction,
  getUsageAction,
} from "@/actions/nanobot";
import { StaleProfileBanner } from "@/components/stale-profile-banner";
import { isoDate, monthsAgo, defaultResetStart } from "@/lib/dates";

interface SyncStatus {
  status: "idle" | "running" | "error";
  phase: string | null;
  fetched: number;
  total: number;
  lastSyncedAt: string | null;
  windowStart: string | null;
  lastAction: string | null;
  lastError: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  update: "Update",
  rejudge: "Re-judge",
  reset: "Reset",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * The three operations that move the tracking window, and the window itself.
 *
 * They are one component because they are one decision. Sync used to be a lone
 * button with no stated scope or cost, which made the cheap daily action and
 * the expensive rebuild look identical — the user could not tell which one
 * they were about to pay for. Every control here therefore states its range
 * and its price before it will run.
 */
export function TrackingControls({
  staleCount,
  settledCount,
}: {
  staleCount: number;
  settledCount: number;
}) {
  const router = useRouter();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [panel, setPanel] = useState<"none" | "rejudge" | "reset">("none");
  const previousStatus = useRef<SyncStatus["status"] | null>(null);
  const autoOpened = useRef(false);
  const [usage, setUsage] = useState<UsageData | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (res.ok) setSync(await res.json());
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
    }
  }, []);

  // One subscription to an external system rather than "fetch once, then set
  // up an interval". Sync progress lives in the database and is moved by a
  // background job, so there is no render that can derive it — polling is the
  // read. Splitting it in two only produced an extra effect whose whole job
  // was to set state on mount, which is the pattern React tells you not to
  // write. The tick rate follows the phase: fast while work is happening,
  // slow enough to stay current when nothing is.
  const status = sync?.status;
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/sync/status");
        if (!res.ok || cancelled) return;
        const next: SyncStatus = await res.json();
        if (cancelled) return;
        setSync(next);

        // With no window defined, Reset is not one option among three — it is
        // the only thing that can be done, because the other two operate
        // inside a window that does not exist yet. Hiding its date fields
        // behind a click asks the user to guess that. Open it once, then stop
        // interfering so a deliberate close stays closed.
        if (!next.windowStart && !autoOpened.current) {
          autoOpened.current = true;
          setPanel("reset");
        }
      } catch {
        // Ignored on purpose; the next tick retries.
      }

      // Its own guard, not the one above. The same rule the recorder follows
      // applies here: reading the spend figure must not be able to break the
      // thing it reports on. A server action rejects outright when the server
      // restarts mid-poll, and left unguarded that surfaced as an unhandled
      // rejection in the console of a page that was otherwise fine.
      try {
        const spend = await getUsageAction();
        if (!cancelled && spend.ok) setUsage(spend.data);
      } catch {
        // Leave the last known figure on screen; the next tick refreshes it.
      }
    }

    poll();
    const id = setInterval(poll, status === "running" ? 1500 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status]);

  // The list is server-rendered, so it will not show new results on its own.
  useEffect(() => {
    const previous = previousStatus.current;
    const current = sync?.status ?? null;
    previousStatus.current = current;
    if (previous === "running" && current !== "running") router.refresh();
  }, [sync?.status, router]);

  const running = sync?.status === "running";

  async function startUpdate() {
    const res = await fetch("/api/sync", { method: "POST" });
    if (res.ok) {
      setSync((p) => (p ? { ...p, status: "running", phase: "fetching" } : p));
    } else if (res.status === 409) {
      await fetchStatus();
    }
  }

  const toggle = (which: "rejudge" | "reset") =>
    setPanel(panel === which ? "none" : which);

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <StaleProfileBanner staleCount={staleCount} settledCount={settledCount} />

      <WindowBadge sync={sync} usage={usage} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          onClick={startUpdate}
          disabled={running}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Working…" : "Update"}
        </button>
        <span className="text-xs text-gray-500">
          {sync?.lastSyncedAt
            ? `Fetches ${shortDate(sync.lastSyncedAt)} → now, skipping mail already seen`
            : "Fetches new mail since the last run"}
        </span>

        <span className="ml-auto flex items-center gap-2">
          <ActionButton
            tone="amber"
            active={panel === "rejudge"}
            disabled={running}
            onClick={() => toggle("rejudge")}
          >
            Re-judge
          </ActionButton>
          <ActionButton
            tone="red"
            active={panel === "reset"}
            disabled={running || !sync}
            onClick={() => toggle("reset")}
          >
            Reset
          </ActionButton>
        </span>
      </div>

      {running && sync && <Progress sync={sync} />}

      {sync?.status === "error" && sync.lastError && (
        <p className="text-xs text-red-600">
          {sync.lastError === "reauth"
            ? "Gmail connection expired. Sign out and reconnect."
            : `Sync error: ${sync.lastError}`}
        </p>
      )}

      {panel === "rejudge" && <RejudgePanel onDone={fetchStatus} />}
      {panel === "reset" && sync && (
        <ResetPanel onDone={fetchStatus} windowStart={sync.windowStart} />
      )}
    </div>
  );
}

const TONES = {
  blue: "bg-blue-600 hover:bg-blue-700",
  amber: "bg-amber-600 hover:bg-amber-700",
  red: "bg-red-600 hover:bg-red-700",
} as const;

/**
 * The three controls share one shape and differ only in colour.
 *
 * They were grey outlines first, on the theory that only the daily action
 * deserved weight. That made two of the three read as page furniture rather
 * than as things you press — and one of them wipes the database. Colour is
 * doing real work here: blue for the routine action, amber for the one that
 * spends a little, red for the one that destroys. Equal prominence, unequal
 * warning, which is the honest arrangement when all three are legitimate
 * choices and only their consequences differ.
 */
function ActionButton({
  tone,
  active,
  disabled,
  onClick,
  children,
}: {
  tone: keyof typeof TONES;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${active ? "ring-2 ring-offset-1 ring-current/30" : ""}`}
    >
      {children}
      <span className="text-[10px] leading-none opacity-70" aria-hidden="true">
        {active ? "▲" : "▼"}
      </span>
    </button>
  );
}

/**
 * The window, stated plainly. Without it the product can say when it last ran
 * but never which stretch of mail the cards were drawn from, which leaves
 * "nothing found" and "never looked" indistinguishable.
 */
interface UsageData {
  monthCost: number;
  monthCalls: number;
  monthEmails: number;
  costPerEmail: number | null;
  lastRun: { at: string; cost: number; emails: number } | null;
}

function WindowBadge({
  sync,
  usage,
}: {
  sync: SyncStatus | null;
  usage: UsageData | null;
}) {
  if (!sync?.lastSyncedAt) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
      <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
        {sync.windowStart
          ? `Tracking ${shortDate(sync.windowStart)} – ${shortDateTime(sync.lastSyncedAt)}`
          : `Last run ${shortDateTime(sync.lastSyncedAt)}`}
      </span>
      {sync.lastAction && (
        <span>via {ACTION_LABELS[sync.lastAction] ?? sync.lastAction}</span>
      )}
      {!sync.windowStart && (
        <span className="text-gray-400">
          · no window set yet — Reset defines one
        </span>
      )}

      {/* Always rendered, including at zero. A spend readout that appears only
          once there is spend is indistinguishable from a broken one, and the
          point of this badge is to be trusted. */}
      {usage && (
        <span
          className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700"
          title={
            usage.monthCalls > 0
              ? `${usage.monthCalls.toLocaleString()} model calls covering ${usage.monthEmails.toLocaleString()} emails${
                  usage.costPerEmail
                    ? ` · $${usage.costPerEmail.toFixed(5)} per email, measured`
                    : ""
                }`
              : "Counting starts with your next run — spend before now was not recorded"
          }
        >
          {usage.monthCalls > 0
            ? `$${usage.monthCost.toFixed(2)} this month`
            : "$0.00 recorded — counting from your next run"}
        </span>
      )}
      {usage?.lastRun && usage.lastRun.emails > 0 && (
        <span>
          last run ${usage.lastRun.cost.toFixed(2)} ·{" "}
          {usage.lastRun.emails.toLocaleString()} emails
        </span>
      )}
    </div>
  );
}

function Progress({ sync }: { sync: SyncStatus }) {
  const pct = sync.total > 0 ? (sync.fetched / sync.total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500">
        {sync.phase === "fetching" &&
          `Fetching emails… ${sync.fetched}/${sync.total}`}
        {sync.phase === "classifying" && "Classifying emails…"}
        {sync.phase === "extracting" && "Extracting job info…"}
      </p>
    </div>
  );
}

function RejudgePanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [start, setStart] = useState(isoDate(monthsAgo(3)));
  const [end, setEnd] = useState(isoDate(new Date()));
  const [preview, setPreview] = useState<{
    queued: number;
    skipped: number;
    estimatedCost: number;
  } | null>(null);
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function check() {
    setBusy("check");
    setMessage(null);
    setPreview(null);
    setConfirming(false);
    const res = await previewRejudgeAction({ start, end });
    setBusy(null);
    if (res.ok) setPreview(res.data);
    else setMessage(res.error);
  }

  async function run() {
    setBusy("run");
    setMessage(null);
    const res = await rejudgeStaleEmailsAction({ start, end });
    setBusy(null);
    setConfirming(false);
    if (!res.ok) {
      setMessage(res.error);
      return;
    }
    setMessage(
      res.data.queued === 0
        ? "Nothing to re-judge in that range."
        : `Re-judging ${res.data.queued} emails in the background.`
    );
    onDone();
    router.refresh();
  }

  return (
    <Panel title="Re-judge — double-check emails that were ruled out" tone="amber">
      <p className="text-xs text-gray-600">
        Only emails already marked not job-related are re-examined, and only
        those judged under an older CV. Matches you already have are untouched.
      </p>
      <DateRange
        start={start}
        end={end}
        onStart={setStart}
        onEnd={setEnd}
        disabled={busy !== null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={check}
          disabled={busy !== null}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "check" ? "Checking…" : "Check how many"}
        </button>
        {preview && (
          <span className="text-sm text-gray-700">
            <strong>{preview.queued}</strong> to re-check
            {preview.skipped > 0 && (
              <span className="text-gray-500">
                {" "}
                · {preview.skipped} bulk mail skipped for good
              </span>
            )}
          </span>
        )}
      </div>
      {preview && preview.queued > 0 && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy !== null}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Re-judge {preview.queued} emails
        </button>
      )}

      {confirming && preview && (
        <Confirm
          tone="amber"
          question={`Send ${preview.queued.toLocaleString()} emails back to the classifier? Costs about $${preview.estimatedCost.toFixed(2)} and runs in the background.`}
          confirmLabel="Yes, re-judge"
          busy={busy === "run"}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
      {preview && preview.queued === 0 && (
        <p className="text-xs text-gray-500">
          Nothing to re-check here — every verdict in this range was reached
          under your current CV. Edit your CV and the ones worth revisiting
          appear.
        </p>
      )}
      {message && <p className="text-sm text-blue-800">{message}</p>}
    </Panel>
  );
}

function ResetPanel({
  onDone,
  windowStart,
}: {
  onDone: () => void;
  windowStart: string | null;
}) {
  const router = useRouter();
  const [start, setStart] = useState(defaultResetStart(windowStart));
  const [end, setEnd] = useState(isoDate(new Date()));
  const [preview, setPreview] = useState<{
    count: number;
    estimatedCost: number;
    overCap: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function check() {
    setBusy("check");
    setMessage(null);
    setPreview(null);
    setConfirming(false);
    const res = await previewResetAction({ start, end });
    setBusy(null);
    if (res.ok) setPreview(res.data);
    else setMessage(res.error);
  }

  async function run() {
    setBusy("run");
    setMessage(null);
    const res = await resetAction({ start, end });
    setBusy(null);
    setConfirming(false);
    if (!res.ok) {
      setMessage(res.error);
      return;
    }
    setMessage("Reset running in the background.");
    onDone();
    router.refresh();
  }

  return (
    <Panel title="Reset — rebuild everything for a window you choose" tone="red">
      <p className="text-xs text-gray-600">
        Deletes every card, drops mail outside the window, and re-judges the
        whole window from scratch. Bulk-mail marks are cleared too, so anything
        wrongly filed as an advert gets another look. This is the way to undo a
        mistake the cheaper buttons cannot.
      </p>
      <DateRange
        start={start}
        end={end}
        onStart={setStart}
        onEnd={setEnd}
        disabled={busy !== null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={check}
          disabled={busy !== null}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "check" ? "Counting… (takes a few seconds)" : "Check how many"}
        </button>
        {preview && (
          <span className="text-sm text-gray-700">
            <strong>{preview.count.toLocaleString()}</strong> emails in Gmail ·
            about <strong>${preview.estimatedCost.toFixed(2)}</strong> to judge
          </span>
        )}
      </div>

      {preview?.overCap && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Over the {`4,000`}-message per-run guard. That guard exists to stop a
          surprise bill; you have the number now, so confirming runs the whole
          window without truncating it.
        </p>
      )}

      {preview && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy !== null}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reset and rebuild
        </button>
      )}

      {confirming && preview && (
        <Confirm
          tone="red"
          question={`Delete every card and re-judge ${preview.count.toLocaleString()} emails from scratch? Costs about $${preview.estimatedCost.toFixed(2)}. Mail outside the window is removed and manually set statuses are lost.`}
          confirmLabel="Yes, reset everything"
          busy={busy === "run"}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}

      {message && <p className="text-sm text-blue-800">{message}</p>}
    </Panel>
  );
}

/**
 * The last step before anything is spent or destroyed.
 *
 * Both operations run in the background the moment they start, so there is no
 * "undo" to fall back on — the confirmation is the only place a misclick can
 * still be caught. It restates the count and the price rather than asking "are
 * you sure", because the number is the thing worth a second look.
 */
function Confirm({
  tone,
  question,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  tone: "red" | "amber";
  question: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  const button =
    tone === "red"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-amber-600 hover:bg-amber-700";

  return (
    <div className={`rounded-md border p-3 ${box}`}>
      <p className="text-sm">{question}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${button}`}
        >
          {busy ? "Starting…" : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "amber" | "red";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        tone === "red"
          ? "border-red-200 bg-red-50/40"
          : "border-amber-200 bg-amber-50/40"
      }`}
    >
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

function DateRange({
  start,
  end,
  onStart,
  onEnd,
  disabled,
}: {
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="text-gray-600">From</label>
      <input
        type="date"
        value={start}
        onChange={(e) => onStart(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
      />
      <label className="text-gray-600">to</label>
      <input
        type="date"
        value={end}
        onChange={(e) => onEnd(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
      />
    </div>
  );
}
