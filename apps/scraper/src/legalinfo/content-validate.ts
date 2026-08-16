export type ContentKind = "html" | "pdf";

export type ContentValidation =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

export function validateDownloadedContent(
  kind: ContentKind,
  bytes: Buffer,
  contentType: string | null,
): ContentValidation {
  const media = mediaType(contentType);
  if (kind === "pdf") {
    if (looksLikePdf(bytes)) {
      return { ok: true, mimeType: "application/pdf" };
    }
    return {
      ok: false,
      reason: `expected PDF bytes, got ${media || "unknown"} (${bytes.byteLength} bytes)`,
    };
  }

  if (looksLikePdf(bytes) || media === "application/pdf") {
    return { ok: false, reason: "expected HTML, got PDF" };
  }
  if (media === "text/html" || media === "application/xhtml+xml" || looksLikeHtml(bytes)) {
    return { ok: true, mimeType: contentType?.trim() || "text/html; charset=utf-8" };
  }
  return {
    ok: false,
    reason: `expected HTML, got ${media || "unknown"}`,
  };
}

export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1").startsWith("%PDF");
}

export function looksLikeHtml(bytes: Buffer): boolean {
  const prefix = stripBom(bytes).subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.includes("<html");
}

function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function stripBom(bytes: Buffer): Buffer {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3);
  }
  return bytes;
}
