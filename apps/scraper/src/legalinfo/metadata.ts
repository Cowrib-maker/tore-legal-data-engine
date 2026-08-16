import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import type { DocumentStatus, DocumentType } from "@tore-legal-data-engine/db";

import { documentTypeForCategory } from "./catalog.js";

export type DiscoveredDocument = {
  title: string;
  documentNumber: string | null;
  sourceUrl: string;
  lawId: string;
  documentType: DocumentType;
  issuedDate: Date | null;
  effectiveDate: Date | null;
  status: DocumentStatus;
  language: string;
  htmlAvailable: boolean;
  pdfAvailable: boolean;
  categoryId: string;
  checksum: string;
};

export function extractCategories(html: string, baseUrl: string): { id: string; name?: string }[] {
  const $ = cheerio.load(html);
  const categories: { id: string; name?: string }[] = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }
    const id = categoryIdFromHref(href, baseUrl);
    if (!id) {
      return;
    }
    const name = $(element).text().replace(/\s+/g, " ").trim();
    categories.push({ id, name: name || undefined });
  });
  return categories;
}

export function extractCodeValue(html: string): string {
  const match = html.match(/codeval\s*=\s*'([^']*)'/);
  return match?.[1] && match[1] !== "" ? match[1] : "1";
}

export function parseListHtml(params: {
  html: string;
  categoryId: string;
  locale: string;
  baseUrl: string;
}): DiscoveredDocument[] {
  const $ = cheerio.load(params.html);
  const documents: DiscoveredDocument[] = [];

  $(".shine-huuli-content").each((_, element) => {
    const card = $(element);
    const link = card.find("a.act-name").first();
    const href = link.attr("href")?.trim();
    const title = link.text().replace(/\s+/g, " ").trim();
    if (!href || !title) {
      return;
    }
    const sourceUrl = canonicalizeDocumentUrl(href, params.baseUrl, params.locale);
    const lawId = extractLawId(sourceUrl);
    if (!lawId) {
      return;
    }
    const documentNumber =
      card.find('span[style*="italic"]').first().text().replace(/\s+/g, " ").trim() || null;
    const issuedDate = parseDate(card.find('[data-block="enacteddate"]').text());
    const effectiveDate = parseDate(card.find('[data-block="enforcementdate"]').text());
    const status: DocumentStatus = card.find('[data-block="inactive"] .fa-check').length
      ? "ACTIVE"
      : "ARCHIVED";
    const htmlAvailable = true;
    const pdfAvailable = detectPdfAvailable(card.html() ?? "");
    const documentType = documentTypeForCategory(params.categoryId);
    const checksum = metadataChecksum({
      title,
      documentNumber,
      sourceUrl,
      documentType,
      issuedDate,
      effectiveDate,
      status,
      language: params.locale,
      htmlAvailable,
      pdfAvailable,
    });

    documents.push({
      title: truncate(title, 2000),
      documentNumber: documentNumber ? truncate(documentNumber, 255) : null,
      sourceUrl,
      lawId,
      documentType,
      issuedDate,
      effectiveDate,
      status,
      language: params.locale,
      htmlAvailable,
      pdfAvailable,
      categoryId: params.categoryId,
      checksum,
    });
  });

  return documents;
}

export function extractLawId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("lawId");
    if (fromQuery) {
      return fromQuery;
    }
    const fromPath = parsed.pathname.match(/\/detail\/([^/]+)$/);
    return fromPath?.[1] ?? null;
  } catch {
    return null;
  }
}

export function canonicalizeDocumentUrl(href: string, baseUrl: string, locale: string): string {
  const parsed = new URL(href, `${baseUrl}/`);
  const lawId =
    parsed.searchParams.get("lawId") ?? parsed.pathname.match(/\/detail\/([^/]+)$/)?.[1];
  if (!lawId) {
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  }
  return `${baseUrl}/${locale}/detail?lawId=${encodeURIComponent(lawId)}`;
}

export function metadataChecksum(input: {
  title: string;
  documentNumber: string | null;
  sourceUrl: string;
  documentType: DocumentType;
  issuedDate: Date | null;
  effectiveDate: Date | null;
  status: DocumentStatus;
  language: string;
  htmlAvailable: boolean;
  pdfAvailable: boolean;
}): string {
  const payload = JSON.stringify({
    title: input.title,
    documentNumber: input.documentNumber,
    sourceUrl: input.sourceUrl,
    documentType: input.documentType,
    issuedDate: input.issuedDate?.toISOString() ?? null,
    effectiveDate: input.effectiveDate?.toISOString() ?? null,
    status: input.status,
    language: input.language,
    htmlAvailable: input.htmlAvailable,
    pdfAvailable: input.pdfAvailable,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function categoryIdFromHref(href: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(href, `${baseUrl}/`);
    const match = parsed.pathname.match(/\/law\/(\d+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function detectPdfAvailable(html: string): boolean {
  return /pdf/i.test(html);
}

function parseDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
