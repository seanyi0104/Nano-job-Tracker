import { describe, it, expect } from "vitest";
import { extractPlainText, extractFromAddress, extractHeader } from "@/lib/gmail/mime";
import type { GmailPayload } from "@/lib/gmail/client";

import plainText from "./fixtures/emails/plain-text.json";
import multipart from "./fixtures/emails/multipart-alternative.json";
import htmlOnly from "./fixtures/emails/html-only.json";
import nested from "./fixtures/emails/nested-multipart.json";

describe("extractPlainText", () => {
  it("extracts text from a plain-text message", () => {
    const text = extractPlainText(plainText.payload as GmailPayload);
    expect(text).toContain("Thank you for applying for Software Development Engineer Intern at Amazon");
  });

  it("prefers text/plain in multipart/alternative", () => {
    const text = extractPlainText(multipart.payload as GmailPayload);
    expect(text).toContain("Congratulations!");
    expect(text).toContain("Google");
    expect(text).not.toContain("<p>");
  });

  it("falls back to stripped HTML when no text/plain exists", () => {
    const text = extractPlainText(htmlOnly.payload as GmailPayload);
    expect(text).toContain("We regret to inform you");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<html>");
  });

  it("handles nested multipart/mixed with multipart/alternative inside", () => {
    const text = extractPlainText(nested.payload as GmailPayload);
    expect(text).toContain("online assessment for Stripe");
    expect(text).toContain("72 hours");
  });

  it("skips attachments and does not crash", () => {
    const text = extractPlainText(nested.payload as GmailPayload);
    expect(text).not.toBeNull();
  });

  it("returns null for a message with only an attachment and no text", () => {
    const payload: GmailPayload = {
      mimeType: "application/pdf",
      headers: [],
      body: { size: 5000, attachmentId: "att123" },
    };
    expect(extractPlainText(payload)).toBeNull();
  });

  it("truncates very long bodies to 10000 chars", () => {
    const longData = Buffer.from("x".repeat(20_000)).toString("base64url");
    const payload: GmailPayload = {
      mimeType: "text/plain",
      headers: [],
      body: { size: 20_000, data: longData },
    };
    const text = extractPlainText(payload);
    expect(text).toHaveLength(10_000);
  });
});

describe("extractFromAddress", () => {
  it("extracts email from angle brackets", () => {
    const addr = extractFromAddress(plainText.payload as GmailPayload);
    expect(addr).toBe("jobs@amazon.com");
  });

  it("returns raw value when no angle brackets", () => {
    const payload: GmailPayload = {
      mimeType: "text/plain",
      headers: [{ name: "From", value: "plain@example.com" }],
      body: { size: 0 },
    };
    expect(extractFromAddress(payload)).toBe("plain@example.com");
  });
});

describe("extractHeader", () => {
  it("finds headers case-insensitively", () => {
    const subject = extractHeader(plainText.payload as GmailPayload, "subject");
    expect(subject).toBe("Application Confirmation - SDE Intern");
  });

  it("returns undefined for missing headers", () => {
    expect(extractHeader(plainText.payload as GmailPayload, "X-Custom")).toBeUndefined();
  });
});
