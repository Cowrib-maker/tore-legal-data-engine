import { loadEnv } from "@tore-legal-data-engine/common";
import { createLogger } from "@tore-legal-data-engine/logger";

import { loadDiscoveryConfig, loadDownloadConfig } from "./config.js";
import { runDownload } from "./legalinfo/download-service.js";
import { runDiscovery } from "./legalinfo/service.js";

loadEnv();

const logger = createLogger("scraper");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((token) => !token.startsWith("--")) ?? "discover";
  if (command === "download") {
    const config = loadDownloadConfig(argv);
    logger.info(
      {
        event: "download.config",
        baseUrl: config.baseUrl,
        locale: config.locale,
        minDelayMs: config.minDelayMs,
        lawId: config.lawId,
        documentId: config.documentId,
      },
      "starting LegalInfo document download",
    );
    await runDownload(config, logger);
    return;
  }
  if (command !== "discover") {
    logger.error({ command }, "unknown command; use discover or download");
    process.exitCode = 1;
    return;
  }

  const config = loadDiscoveryConfig(argv);
  logger.info(
    {
      event: "discovery.config",
      baseUrl: config.baseUrl,
      locale: config.locale,
      minDelayMs: config.minDelayMs,
      resume: config.resume,
      categoryId: config.categoryId,
      maxPages: config.maxPages,
      isActiveFilters: config.isActiveFilters,
    },
    "starting LegalInfo discovery",
  );
  await runDiscovery(config, logger);
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, "scraper failed");
  process.exitCode = 1;
});
