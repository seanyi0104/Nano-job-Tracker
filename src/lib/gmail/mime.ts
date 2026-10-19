import type { GmailPayload } from "./client";

const MAX_BODY_LENGTH = 10_000;

export function extractPlainText(payload: GmailPayload): string | null {
  const text = findTextPart(payload);
  if (text) return text.slice(0, MAX_BODY_LENGTH);

  const html = findHtmlPart(payload);
  if (html) return stripHtml(html).slice(0, MAX_BODY_LENGTH);

  return null;
}

function findTextPart(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/plain" && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findTextPart(part);
      if (result) return result;
    }
  }

  return null;
}

function findHtmlPart(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/html" && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = findHtmlPart(part);
      if (result) return result;
    }
  }

  return null;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  let text = html;
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  return text.trim();
}

export function extractHeader(
  payload: GmailPayload,
  name: string
): string | undefined {
  const header = payload.headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value;
}

export function extractFromAddress(payload: GmailPayload): string {
  const from = extractHeader(payload, "From") ?? "";
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}
