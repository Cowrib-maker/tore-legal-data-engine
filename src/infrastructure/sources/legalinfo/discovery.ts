import type { DiscoveredAct } from "../../../domain/ports/source-connector.js";
import { assertHttpsLegalInfoUrl } from "../../http/allowlist.js";

const LAW_CATEGORY_ID = "27";

export function extractLawId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("lawId");
  } catch {
    return null;
  }
}

export function canonicalDetailUrl(lawId: string, locale = "mn"): string {
  return `https://legalinfo.mn/${locale}/detail?lawId=${encodeURIComponent(lawId)}`;
}

export function parseListHtml(html: string, discoveredAt: string): DiscoveredAct[] {
  const acts: DiscoveredAct[] = [];
  const linkRe = /<a\b([^>]*class="act-name"[^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const attrs = match[1] ?? "";
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    const href = decodeHtml(hrefMatch?.[1] ?? "").trim();
    const title = decodeHtml(stripTags(match[2] ?? "")).replace(/\s+/g, " ").trim();
    if (!href) {
      continue;
    }
    let canonical: string;
    try {
      const absolute = new URL(href, "https://legalinfo.mn/");
      const lawId = extractLawId(absolute.toString());
      if (!lawId) {
        continue;
      }
      canonical = canonicalDetailUrl(lawId);
      assertHttpsLegalInfoUrl(canonical);
      acts.push({
        sourceUrl: canonical,
        canonicalUrl: canonical,
        discoveredTitle: title || null,
        actType: "law",
        lawId,
        discoveredAt,
      });
    } catch {
      continue;
    }
  }
  return dedupe(acts);
}

export function discoveredFromLawId(lawId: string, discoveredAt: string): DiscoveredAct {
  const canonical = canonicalDetailUrl(lawId);
  assertHttpsLegalInfoUrl(canonical);
  return {
    sourceUrl: canonical,
    canonicalUrl: canonical,
    discoveredTitle: null,
    actType: "law",
    lawId,
    discoveredAt,
  };
}

export function discoveredFromUrl(url: string, discoveredAt: string): DiscoveredAct {
  const parsed = assertHttpsLegalInfoUrl(url);
  const lawId = extractLawId(parsed.toString());
  const canonical = lawId ? canonicalDetailUrl(lawId) : parsed.toString();
  return {
    sourceUrl: canonical,
    canonicalUrl: canonical,
    discoveredTitle: null,
    actType: lawId ? "law" : null,
    lawId,
    discoveredAt,
  };
}

export function listingUrl(locale: string, categoryId = LAW_CATEGORY_ID): string {
  return `https://legalinfo.mn/${locale}/law/${categoryId}`;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dedupe(acts: DiscoveredAct[]): DiscoveredAct[] {
  const seen = new Set<string>();
  const out: DiscoveredAct[] = [];
  for (const act of acts) {
    if (seen.has(act.canonicalUrl)) {
      continue;
    }
    seen.add(act.canonicalUrl);
    out.push(act);
  }
  return out;
}
