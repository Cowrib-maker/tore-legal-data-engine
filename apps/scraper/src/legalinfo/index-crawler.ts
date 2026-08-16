import type { Logger } from "@tore-legal-data-engine/logger";

import type { DiscoveryConfig } from "../config.js";
import { FALLBACK_CATEGORY_IDS, uniqueCategories, type LegalInfoCategory } from "./catalog.js";
import type { LegalInfoClient } from "./client.js";
import {
  extractCategories,
  extractCodeValue,
  parseListHtml,
  type DiscoveredDocument,
} from "./metadata.js";

export type IndexPage = {
  categoryId: string;
  categoryName?: string;
  isActive: string;
  page: number;
  httpStatus: number;
  documents: DiscoveredDocument[];
};

export async function discoverCategories(
  client: LegalInfoClient,
  config: DiscoveryConfig,
  logger: Logger,
): Promise<LegalInfoCategory[]> {
  if (config.categoryId) {
    return [{ id: config.categoryId }];
  }

  const seedId =
    FALLBACK_CATEGORY_IDS.find((id) => id === "27") ?? FALLBACK_CATEGORY_IDS[0] ?? "27";
  const indexUrl = `/${config.locale}/law/${seedId}`;
  const response = await client.get(indexUrl);
  const fromHtml = uniqueCategories(extractCategories(response.body, config.baseUrl));
  if (fromHtml.length > 0) {
    logger.info(
      {
        event: "discovery.categories",
        count: fromHtml.length,
        categoryIds: fromHtml.map((item) => item.id),
      },
      "discovered category index",
    );
    return fromHtml;
  }

  logger.warn({ event: "discovery.categories.fallback", seedId }, "using fallback category ids");
  return FALLBACK_CATEGORY_IDS.map((id) => ({ id }));
}

export async function crawlCategoryPages(
  client: LegalInfoClient,
  config: DiscoveryConfig,
  logger: Logger,
  category: LegalInfoCategory,
  isActive: string,
  startPage: number,
  onPage: (page: IndexPage) => Promise<void>,
): Promise<void> {
  const categoryUrl = `${config.baseUrl}/${config.locale}/law/${category.id}`;
  const index = await client.get(`/${config.locale}/law/${category.id}`);
  const code = extractCodeValue(index.body);
  let page = startPage;

  while (true) {
    if (config.maxPages && page > config.maxPages) {
      logger.info(
        {
          event: "discovery.page.limit",
          categoryId: category.id,
          isActive,
          page,
          maxPages: config.maxPages,
        },
        "reached max pages",
      );
      break;
    }

    const list = await client.postForm(
      `/${config.locale}/ajaxList/`,
      {
        page: String(page),
        filtercategorytypeid: category.id,
        code,
        isactive: isActive,
      },
      categoryUrl,
    );

    if (list.status >= 400) {
      throw new Error(`ajaxList HTTP ${list.status} for category ${category.id} page ${page}`);
    }

    const html = extractListHtml(list.body);
    const documents = parseListHtml({
      html,
      categoryId: category.id,
      locale: config.locale,
      baseUrl: config.baseUrl,
    });

    await onPage({
      categoryId: category.id,
      categoryName: category.name,
      isActive,
      page,
      httpStatus: list.status,
      documents,
    });

    if (documents.length === 0) {
      break;
    }
    page += 1;
  }
}

function extractListHtml(body: string): string {
  try {
    const parsed = JSON.parse(body) as { Html?: unknown };
    return typeof parsed.Html === "string" ? parsed.Html : body;
  } catch {
    return body;
  }
}
