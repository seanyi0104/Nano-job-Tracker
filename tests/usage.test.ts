import { describe, it, expect } from "vitest";
import { estimateSpend, priceCall } from "@/lib/llm/usage";

describe("priceCall", () => {
  it("prices Haiku input and output at the published rates", () => {
    // 1M input @ $1 + 1M output @ $5
    const cost = priceCall("claude-haiku-4-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6, 6);
  });

  it("prices Sonnet at its own rates", () => {
    const cost = priceCall("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(18, 6);
  });

  // The three input buckets are reported separately by the API. Reading only
  // input_tokens would price a fully cached call at zero, which is the shape
  // of error that made the old estimate believable and wrong.
  it("adds cached tokens instead of ignoring them", () => {
    const cost = priceCall("claude-haiku-4-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.1, 6);
  });

  it("charges a cache write at 1.25x and a read at 0.1x", () => {
    const write = priceCall("claude-haiku-4-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    const read = priceCall("claude-haiku-4-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(write).toBeCloseTo(1.25, 6);
    expect(read).toBeCloseTo(0.1, 6);
    expect(write / read).toBeCloseTo(12.5, 6);
  });

  // An unpriced model must not silently bill as free-but-plausible; returning
  // zero is visible in a total, whereas guessing a rate is not.
  it("returns zero for a model with no published rate", () => {
    expect(
      priceCall("some-future-model", { input_tokens: 1000, output_tokens: 1000 })
    ).toBe(0);
  });

  it("treats missing cache fields as zero rather than NaN", () => {
    const cost = priceCall("claude-haiku-4-5", {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: undefined,
    });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeCloseTo(1000 / 1e6 + (100 * 5) / 1e6, 9);
  });
});

// Rates measured on this inbox from the ledger on 2026-09-19: classification
// is cheap and every email pays it; extraction is ~10x and only job-related
// mail pays it.
const RATES = { classify: 0.00052, extract: 0.0051 };

describe("estimateSpend", () => {
  it("prices extraction separately from classification", () => {
    // A Reset over the tracking window: 3,203 emails judged, of which the 87
    // that are job-related get extracted again.
    expect(estimateSpend(RATES, 3203, 87)).toBeCloseTo(2.11, 2);
  });

  // The bug this replaced: one blended $/email, learned from Updates that
  // barely extract anything, then applied to a Reset that re-extracts the lot.
  it("comes out above the blended per-email rate it replaced", () => {
    const blended = 0.00056; // month average on 2026-09-19
    expect(estimateSpend(RATES, 3203, 87)).toBeGreaterThan(3203 * blended);
  });

  it("charges only classification when nothing will be extracted", () => {
    expect(estimateSpend(RATES, 141, 0)).toBeCloseTo(0.07, 2);
  });
});
