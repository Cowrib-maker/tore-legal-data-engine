export type ContentKind = "html" | "pdf" | "word" | "unknown";

export type SourceDocument = {
  originalUrl: string;
  retrievedUrl: string;
  contentType: string;
  contentHash: string;
  retrievedAt: string;
  format: ContentKind;
  byteSize: number;
};

export function detectFormat(mimeType: string, bytes: Uint8Array): ContentKind {
  const media = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (media === "application/pdf" || looksLikePdf(bytes)) {
    return "pdf";
  }
  if (media.includes("word") || media.includes("officedocument.wordprocessingml")) {
    return "word";
  }
  if (media === "text/html" || media === "application/xhtml+xml" || looksLikeHtml(bytes)) {
    return "html";
  }
  return "unknown";
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1").startsWith("%PDF");
}

export function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 512))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return (
    prefix.startsWith("<!doctype html") ||
    prefix.startsWith("<html") ||
    prefix.includes("<html")
  );
}

export function validateSourceBytes(
  format: ContentKind,
  bytes: Uint8Array,
  mimeType: string,
): { ok: true } | { ok: false; reason: string } {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "empty_body" };
  }
  if (format === "unknown") {
    return { ok: false, reason: `unexpected_type:${mimeType}` };
  }
  if (format === "html" && looksLikePdf(bytes)) {
    return { ok: false, reason: "expected_html_got_pdf" };
  }
  return { ok: true };
}
