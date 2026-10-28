import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JdAnalysisView } from "@/components/jd-analysis-view";
import type { JdAnalysis } from "@/lib/nanobot/schemas";

const analysis: JdAnalysis = {
  ok: true,
  company: "Acme",
  role: "Product Intern",
  rating: "B",
  matchScore: 60,
  verdict: "Worth applying after one fix",
  matches: [{ point: "Python", evidence: "Python in skills" }],
  gaps: [{ gap: "No SQL", severity: "low", mitigation: "Add a SQL project" }],
  keywords: [],
  suggestions: [],
};

function footer(props: Partial<Parameters<typeof JdAnalysisView>[0]>): string {
  const html = renderToStaticMarkup(
    <JdAnalysisView
      analysis={analysis}
      analyzedAt={new Date("2026-10-28T03:01:00Z")}
      model="deepseek-v4-flash"
      {...props}
    />
  );
  return html.slice(html.indexOf("Analyzed by nanobot"));
}

// The reminder lives in the footer and only offers a re-run: plenty of
// analyses are not worth paying for again after a CV edit.
describe("analysis footer", () => {
  it("flags an analysis built on an older CV and offers a re-run", () => {
    const html = footer({ stale: true, onReanalyze: () => {} });
    expect(html).toContain("Based on an older CV");
    expect(html).toContain(">Re-analyze</button>");
  });

  it("says nothing extra when the analysis used the current CV", () => {
    const html = footer({ stale: false, onReanalyze: () => {} });
    expect(html).not.toContain("older CV");
    expect(html).not.toContain("Re-analyze");
  });

  it("shows the re-run in progress", () => {
    const html = footer({ stale: true, onReanalyze: () => {}, reanalyzing: true });
    expect(html).toContain("Re-analyzing…");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
