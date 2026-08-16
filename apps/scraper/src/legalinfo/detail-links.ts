import * as cheerio from "cheerio";

export type PdfDownloadTarget =
  | { type: "url"; url: string }
  | { type: "export"; lawId: string };

export function pdfExportPath(locale: string): string {
  return `/${locale}/pdfExport`;
}

export function pdfExportFields(lawId: string): Record<string, string> {
  return {
    fileid: lawId,
    orientation: "portrait",
    size: "a4",
    top: "1cm",
    left: "1.5cm",
    bottom: "1cm",
    right: "0.5cm",
    width: "",
    height: "",
    fontfamily: "Arial, Helvetica, sans-serif",
  };
}

export function extractPdfSource(
  html: string,
  pageUrl: string,
  fallbackLawId: string,
): PdfDownloadTarget | null {
  const $ = cheerio.load(html);
  let fileUrl: string | null = null;

  $("a[href]").each((_, element) => {
    if (fileUrl) {
      return;
    }
    const href = $(element).attr("href")?.trim();
    if (!href || href.toLowerCase().startsWith("javascript:")) {
      return;
    }
    let absolute: URL;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (absolute.pathname.toLowerCase().endsWith(".pdf")) {
      fileUrl = absolute.toString();
    }
  });

  if (fileUrl) {
    return { type: "url", url: fileUrl };
  }

  const exportMatch = html.match(/downloadlaw\s*\(\s*['"]1['"]\s*,\s*['"]([^'"]+)['"]/i);
  if (exportMatch?.[1]) {
    return { type: "export", lawId: exportMatch[1] };
  }
  if (/downloadlaw\s*\(\s*['"]1['"]/i.test(html) || /pdf_export\.png/i.test(html)) {
    return { type: "export", lawId: fallbackLawId };
  }
  return null;
}

export function extractPdfFileUrl(html: string, pageUrl: string): string | null {
  const source = extractPdfSource(html, pageUrl, "");
  return source?.type === "url" ? source.url : null;
}
