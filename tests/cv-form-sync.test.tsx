import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/actions/nanobot", () => ({
  parseCvUploadAction: vi.fn(),
  parseStoredCvAction: vi.fn(),
  saveStructuredCvAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CvForm } from "@/components/cv-form";
import { EMPTY_CV } from "@/lib/nanobot/cv-schema";

const cv = { ...EMPTY_CV, basics: { ...EMPTY_CV.basics, name: "Test Person" } };

function render(syncedAt: string | null, syncError: string | null) {
  const html = renderToStaticMarkup(
    <CvForm
      initial={cv}
      sourceLabel={null}
      hasUnstructuredCv={false}
      syncedAt={syncedAt}
      syncError={syncError}
    />
  );
  const button = html.match(/<button[^>]*>Save CV<\/button>/)?.[0] ?? "";
  const strip = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "")
  );
  return { html, saveDisabled: /\sdisabled=""/.test(button), strip };
}

// The confirmation strip under Save CV names both places a save writes to.
// A save writes the database first and nanobot second, so after a save made
// with the engine offline the two disagree — and the strip has to say so.
describe("CV save confirmation", () => {
  it("shows both destinations done when the last save reached nanobot", () => {
    const { saveDisabled, strip } = render("2026-08-13T01:15:04.045Z", null);
    expect(strip[0]).toMatch(/^✓ Written to nanobot memory/);
    expect(strip[1]).toMatch(/^✓ Written to the database/);
    expect(saveDisabled).toBe(true);
  });

  it("does not claim nanobot has the CV when the last push failed", () => {
    const { html, strip } = render(
      "2026-08-13T01:15:04.045Z",
      "Cannot reach nanobot at http://127.0.0.1:8900."
    );
    expect(strip[0]).toMatch(/^✗ Not written to nanobot memory/);
    expect(strip[1]).toMatch(/^✓ Written to the database/);
    expect(html).toContain("nanobot has the previous version");
    expect(html).not.toContain("Saved Aug");
  });

  it("leaves Save enabled after a failed push, so it can be retried without an edit", () => {
    const { saveDisabled } = render(
      "2026-08-13T01:15:04.045Z",
      "Cannot reach nanobot at http://127.0.0.1:8900."
    );
    expect(saveDisabled).toBe(false);
  });

  it("claims nothing before the first save", () => {
    const { saveDisabled, strip } = render(null, null);
    expect(strip[0]).toMatch(/^· Written to nanobot memory/);
    expect(strip[1]).toMatch(/^· Written to the database/);
    expect(saveDisabled).toBe(true);
  });
});
