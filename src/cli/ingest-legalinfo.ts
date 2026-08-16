import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "../infrastructure/config/env.js";
import { createEngine } from "../infrastructure/compose.js";
import { SafeHttpsDownloader } from "../infrastructure/http/safe-https-downloader.js";
import { assertHttpsLegalInfoUrl } from "../infrastructure/http/allowlist.js";
import { LegalInfoSourceConnector } from "../infrastructure/sources/legalinfo/legalinfo-source.connector.js";
import { canonicalDetailUrl } from "../infrastructure/sources/legalinfo/discovery.js";
import { LegalInfoHtmlParser } from "../parsers/legalinfo/legalinfo-html.parser.js";
import { parseIngestCliArgs } from "../application/ingest/cli-args.js";
import { IngestLegalInfoService } from "../application/ingest/ingest-legalinfo.service.js";

function applyDotEnv(): void {
  if (!existsSync(".env")) {
    return;
  }
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

applyDotEnv();

async function main(): Promise<void> {
  const env = loadEnv();
  const options = parseIngestCliArgs(
    process.argv.slice(2),
    env.LEGALINFO_MAX_DOCUMENTS_PER_RUN,
  );
  if (options.allowFullCrawl) {
    throw new Error("allow_full_crawl_blocked");
  }
  const targetIds = options.lawIds ?? (options.lawId ? [options.lawId] : []);
  if (!options.fromArchive && !options.url && targetIds.length === 0) {
    throw new Error("explicit_url_or_law_id_required");
  }
  const targetUrls = options.url
    ? [assertHttpsLegalInfoUrl(options.url).toString()]
    : targetIds.map((lawId) => canonicalDetailUrl(lawId));
  for (const url of targetUrls) {
    assertHttpsLegalInfoUrl(url);
  }
  process.stderr.write(
    `${JSON.stringify({
      preflight: {
        https: true,
        hostAllowlist: "legalinfo.mn",
        ssrf: "dns_checked_at_download",
        redirects: "manual_allowlist_only",
        detailPageFetches: options.fromArchive ? 0 : targetUrls.length,
        concurrency: env.LEGALINFO_MAX_CONCURRENCY,
        requestDelayMs: env.LEGALINFO_REQUEST_DELAY_MS,
        allowFullCrawl: false,
        urls: targetUrls,
      },
    })}\n`,
  );
  const engine = createEngine(env);
  const downloader = new SafeHttpsDownloader({
    timeoutMs: env.LEGALINFO_REQUEST_TIMEOUT_MS,
    maxBytes: env.LEGALINFO_MAX_RESPONSE_BYTES,
    maxRetries: env.LEGALINFO_MAX_RETRIES,
    delayMs: env.LEGALINFO_REQUEST_DELAY_MS,
    maxConcurrency: env.LEGALINFO_MAX_CONCURRENCY,
    userAgent: env.LEGALINFO_USER_AGENT,
  });
  const connector = new LegalInfoSourceConnector(downloader, {
    locale: env.LEGALINFO_LOCALE,
    categoryId: env.LEGALINFO_CATEGORY_ID,
  });
  const ingest = new IngestLegalInfoService({
    connector,
    parser: new LegalInfoHtmlParser(),
    archive: engine.archive,
    uow: engine.uow,
    repos: engine.repos,
  });
  const result = options.fromArchive
    ? await ingest.republishFromArchive(options)
    : await ingest.run(options);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "ingest_failed";
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
});
