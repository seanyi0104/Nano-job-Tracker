import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export class UnsupportedCvFileError extends Error {
  constructor(readonly filename: string) {
    super(`Unsupported file type: ${filename}`);
    this.name = "UnsupportedCvFileError";
  }
}

export const MAX_CV_BYTES = 10 * 1024 * 1024;

/**
 * Pull plain text out of an uploaded CV.
 *
 * Only text extraction happens here — turning that text into fields is the
 * agent's job, so a layout this code cannot understand still parses correctly.
 */
export async function extractCvText(file: File): Promise<string> {
  if (file.size > MAX_CV_BYTES) {
    throw new Error("File is larger than 10MB");
  }

  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return normalize(Array.isArray(text) ? text.join("\n") : text);
  }

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    return normalize(value);
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return normalize(new TextDecoder().decode(buffer));
  }

  // .doc is the old binary Word format; mammoth only reads .docx, and adding a
  // converter is not worth it when Word exports .docx and PDF for free.
  throw new UnsupportedCvFileError(file.name);
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
