"use client";

import { useCallback, useSyncExternalStore } from "react";
import { TimelineView } from "./timeline-view";
import type { TimelineEvent } from "./timeline-view";

const STORAGE_KEY = "njt.timeline.open";

/**
 * The timeline, foldable, closed by default.
 *
 * It answers a question you ask occasionally — what has this search looked
 * like — while the cards below answer the one you ask every day. Left open it
 * would push the day-to-day work under the fold to serve the rarer need, so it
 * starts collapsed and remembers the choice: someone who wants it open every
 * time should only have to say so once.
 */
export function TimelinePanel({
  events,
  windowStart,
  windowEnd,
}: {
  events: TimelineEvent[];
  windowStart: string | null;
  windowEnd: string | null;
}) {
  const open = usePersistedFlag(STORAGE_KEY);
  const toggle = useCallback(() => setFlag(STORAGE_KEY, !open), [open]);

  if (events.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left hover:bg-gray-50"
      >
        <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-semibold text-gray-900">Timeline</span>
        <span className="text-xs text-gray-500">
          {events.length} job-related {events.length === 1 ? "email" : "emails"}{" "}
          across the tracking window
        </span>
      </button>

      {open && (
        <div className="mt-2">
          <TimelineView
            events={events}
            windowStart={windowStart}
            windowEnd={windowEnd}
          />
        </div>
      )}
    </div>
  );
}

/* ── persisted open/closed flag ───────────────────────────────────── */

const listeners = new Set<() => void>();

/**
 * Fallback for when localStorage is unavailable — a private window, or a
 * browser set to block site data. Without it the toggle silently does nothing
 * there: the write throws, the snapshot reads storage again, and the panel
 * never opens. Remembering the choice across reloads is the feature that
 * degrades; being able to open the panel at all is not.
 */
const memory = new Map<string, boolean>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return memory.get(key) ?? false;
  }
}

function setFlag(key: string, value: boolean): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Handled by the in-memory fallback above.
  }
  for (const fn of listeners) fn();
}

/**
 * localStorage is external mutable state, so it is read through the hook React
 * provides for that rather than copied into component state by an effect.
 *
 * The effect version needs a setState on mount, which is the pattern React
 * warns about — and it also renders once with the wrong answer before
 * correcting itself, so a panel the user has pinned open visibly flickers
 * shut. The server snapshot is `false`, matching what the HTML ships with, so
 * hydration stays consistent.
 */
function usePersistedFlag(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readFlag(key),
    () => false
  );
}
