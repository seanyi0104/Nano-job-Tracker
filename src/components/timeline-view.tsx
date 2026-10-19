"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface TimelineEvent {
  id: string;
  /** ISO date of the email. */
  at: string;
  company: string;
  subject: string;
  /** Classifier label; drives the colour. */
  type: string;
  /** Where clicking should go, when the email made it onto a card. */
  applicationId: string | null;
}

type Tone = "applied" | "interview" | "offer" | "rejected" | "other";

const TONE_OF: Record<string, Tone> = {
  applied: "applied",
  recruiter_outreach: "applied",
  interview: "interview",
  oa: "interview",
  offer: "offer",
  rejection: "rejected",
  other: "other",
};

const FILL: Record<Tone, string> = {
  applied: "#3b82f6",
  interview: "#f59e0b",
  offer: "#16a34a",
  rejected: "#ef4444",
  other: "#9ca3af",
};

const TONE_LABEL: Record<Tone, string> = {
  applied: "投递",
  interview: "面试 / 测评",
  offer: "Offer",
  rejected: "拒信",
  other: "其他",
};

// Coordinate space. Rendered with width="100%", so these are proportions, not
// pixels — the browser scales the whole thing to whatever width it is given.
const W = 1000;
const X0 = 48;
const X1 = W - 48;
const ROW_TOP = 74;
const ROW_GAP = 118;
const TURN = 52;
/** Nodes closer than this on screen merge into one, so a busy week stays legible. */
const CLUSTER_PX = 26;
/** Roughly two months of path per row keeps the date scale readable. */
const DAYS_PER_ROW = 62;

interface Placed {
  x: number;
  y: number;
  events: TimelineEvent[];
  tone: Tone;
}

/**
 * The tracking window as a road: start at the top left, walk right, turn down,
 * walk back, every job-related email a stop along the way.
 *
 * A plain chronological list already exists in a sense — the cards below are
 * grouped by company, which answers "how is this employer going" but never
 * "what has this search actually looked like". Laid out in time you can see
 * the shape of it: the fortnight you applied to everything, the month nothing
 * came back, where the interviews clustered. That is a different question, so
 * it gets a different view rather than another sort order on the same one.
 *
 * Folding rather than paging: dense stretches merge into one marked stop
 * instead of overflowing, so the road's length stays fixed and only its
 * density changes. A six-month search and a six-week one both fit on screen.
 */
export function TimelineView({
  events,
  windowStart,
  windowEnd,
}: {
  events: TimelineEvent[];
  windowStart: string | null;
  windowEnd: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Placed | null>(null);

  const layout = useMemo(() => {
    if (events.length === 0) return null;

    const times = events.map((e) => Date.parse(e.at));
    const start = windowStart ? Date.parse(windowStart) : Math.min(...times);
    const end = windowEnd ? Date.parse(windowEnd) : Math.max(...times);
    const span = Math.max(end - start, 86_400_000);

    const days = span / 86_400_000;
    const rows = Math.min(Math.max(Math.ceil(days / DAYS_PER_ROW), 1), 6);
    const rowSpan = span / rows;

    // Serpentine: right on even rows, left on odd, U-turns joining them.
    let d = `M ${X0} ${ROW_TOP}`;
    for (let r = 0; r < rows; r++) {
      const y = ROW_TOP + r * ROW_GAP;
      const goingRight = r % 2 === 0;
      const from = goingRight ? X0 : X1;
      const to = goingRight ? X1 : X0;
      d += `${r === 0 ? "" : ` L ${from} ${y}`} L ${to} ${y}`;
      if (r < rows - 1) {
        const ny = y + ROW_GAP;
        const c = goingRight ? to + TURN : to - TURN;
        d += ` C ${c} ${y} ${c} ${ny} ${to} ${ny}`;
      }
    }

    const raw = events
      .map((e) => {
        const t = Date.parse(e.at);
        const r = Math.min(Math.floor((t - start) / rowSpan), rows - 1);
        const within = (t - (start + r * rowSpan)) / rowSpan;
        const goingRight = r % 2 === 0;
        const x = goingRight
          ? X0 + within * (X1 - X0)
          : X1 - within * (X1 - X0);
        return { x, y: ROW_TOP + r * ROW_GAP, row: r, event: e };
      })
      .sort((a, b) => a.row - b.row || a.x - b.x);

    const placed: Placed[] = [];
    for (const item of raw) {
      const last = placed[placed.length - 1];
      if (
        last &&
        last.y === item.y &&
        Math.abs(last.x - item.x) < CLUSTER_PX
      ) {
        last.events.push(item.event);
        continue;
      }
      placed.push({
        x: item.x,
        y: item.y,
        events: [item.event],
        tone: TONE_OF[item.event.type] ?? "other",
      });
    }

    // A cluster shows the most advanced thing in it — an interview inside a
    // week of applications is the part worth seeing from across the page.
    const RANK: Record<Tone, number> = {
      offer: 4,
      interview: 3,
      rejected: 2,
      applied: 1,
      other: 0,
    };
    for (const p of placed) {
      p.tone = p.events
        .map((e) => TONE_OF[e.type] ?? "other")
        .reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    }

    const months: { x: number; y: number; label: string }[] = [];
    const cursor = new Date(start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end) {
      const t = cursor.getTime();
      if (t >= start) {
        const r = Math.min(Math.floor((t - start) / rowSpan), rows - 1);
        const within = (t - (start + r * rowSpan)) / rowSpan;
        const goingRight = r % 2 === 0;
        months.push({
          x: goingRight ? X0 + within * (X1 - X0) : X1 - within * (X1 - X0),
          y: ROW_TOP + r * ROW_GAP,
          label: cursor.toLocaleDateString("en-US", { month: "short" }),
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return {
      d,
      placed,
      months,
      rows,
      height: ROW_TOP + (rows - 1) * ROW_GAP + 58,
      start: new Date(start),
      end: new Date(end),
    };
  }, [events, windowStart, windowEnd]);

  if (!layout) {
    return (
      <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
        No job-related email in this window yet.
      </p>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: FILL[t] }}
            />
            {TONE_LABEL[t]}
          </span>
        ))}
        <span className="ml-auto text-gray-400">
          带数字的圆 = 该时段多封聚合，点击展开
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${layout.height}`}
        width="100%"
        role="img"
        className="overflow-visible"
      >
        <title>求职时间轴</title>
        <desc>
          从 {layout.start.toLocaleDateString()} 到{" "}
          {layout.end.toLocaleDateString()} 的求职相关邮件，按时间沿一条折返路径排列。
        </desc>

        <path
          d={layout.d}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {layout.months.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={m.y - 16}
            textAnchor="middle"
            className="fill-gray-400"
            style={{ fontSize: 13 }}
          >
            {m.label}
          </text>
        ))}

        <circle cx={X0} cy={ROW_TOP} r={5} fill="#9ca3af" />
        <text
          x={X0}
          y={ROW_TOP + 26}
          textAnchor="start"
          className="fill-gray-400"
          style={{ fontSize: 12 }}
        >
          {layout.start.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>

        {layout.placed.map((p, i) => {
          const many = p.events.length > 1;
          const r = many ? Math.min(9 + p.events.length, 15) : 6;
          const isOpen = selected === p;
          return (
            <g
              key={i}
              onClick={() => setSelected(isOpen ? null : p)}
              style={{ cursor: "pointer" }}
            >
              <title>
                {p.events.length === 1
                  ? `${p.events[0].company} · ${new Date(p.events[0].at).toLocaleDateString()}`
                  : `${p.events.length} 封 · ${new Date(p.events[0].at).toLocaleDateString()}`}
              </title>
              <circle
                cx={p.x}
                cy={p.y}
                r={r + (isOpen ? 4 : 0)}
                fill={FILL[p.tone]}
                stroke="#fff"
                strokeWidth="2"
              />
              {many && (
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fill="#fff"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {p.events.length}
                </text>
              )}
              {!many && (
                <text
                  x={p.x}
                  y={p.y + 24}
                  textAnchor="middle"
                  className="fill-gray-600"
                  style={{ fontSize: 12 }}
                >
                  {truncate(p.events[0].company, 14)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {selected && (
        <div className="mt-3 rounded-lg border bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">
              {new Date(selected.events[0].at).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
              })}
              {selected.events.length > 1 && ` · ${selected.events.length} 封`}
            </span>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-gray-500 hover:underline"
            >
              Close
            </button>
          </div>
          <ul className="space-y-1">
            {selected.events.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() =>
                    e.applicationId &&
                    router.push(`/applications/${e.applicationId}`)
                  }
                  disabled={!e.applicationId}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-white disabled:cursor-default"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: FILL[TONE_OF[e.type] ?? "other"] }}
                  />
                  <span className="shrink-0 font-medium text-gray-800">
                    {e.company}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-gray-500">
                    {e.subject}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {new Date(e.at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
