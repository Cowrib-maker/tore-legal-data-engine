import { readPositiveInt } from "@tore-legal-data-engine/common";

export type DownloadConfig = DiscoveryConfig & {
  lawId?: string;
  documentId?: string;
};

export type DiscoveryConfig = {
  baseUrl: string;
  locale: string;
  minDelayMs: number;
  maxRetries: number;
  requestTimeoutMs: number;
  userAgent: string;
  checkpointPath: string;
  isActiveFilters: string[];
  maxPages?: number;
  categoryId?: string;
  resume: boolean;
};

export function loadDownloadConfig(argv: string[] = process.argv.slice(2)): DownloadConfig {
  const flags = parseFlags(argv);
  return {
    ...loadDiscoveryConfig(argv),
    lawId: flags["law-id"],
    documentId: flags["document-id"],
  };
}

export function loadDiscoveryConfig(argv: string[] = process.argv.slice(2)): DiscoveryConfig {
  const flags = parseFlags(argv);
  const maxPagesRaw = flags["max-pages"] ?? process.env["LEGALINFO_MAX_PAGES"];
  const maxPages = maxPagesRaw ? readPositiveInt(maxPagesRaw, 0) : 0;

  return {
    baseUrl: (process.env["LEGALINFO_BASE_URL"] ?? "https://legalinfo.mn").replace(/\/+$/, ""),
    locale: process.env["LEGALINFO_LOCALE"] ?? "mn",
    minDelayMs: readPositiveInt(process.env["LEGALINFO_MIN_DELAY_MS"], 1500),
    maxRetries: readPositiveInt(process.env["LEGALINFO_MAX_RETRIES"], 4),
    requestTimeoutMs: readPositiveInt(process.env["LEGALINFO_REQUEST_TIMEOUT_MS"], 30_000),
    userAgent: process.env["LEGALINFO_USER_AGENT"] ?? "TORE-Legal-Data-Engine/0.1",
    checkpointPath:
      process.env["LEGALINFO_CHECKPOINT_PATH"] ?? "data/checkpoints/legalinfo-discovery.json",
    isActiveFilters: parseIsActiveFilters(flags.isactive ?? process.env["LEGALINFO_ISACTIVE"]),
    maxPages: maxPages > 0 ? maxPages : undefined,
    categoryId: flags.category,
    resume: flags.resume === "true" || argv.includes("--resume"),
  };
}

export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function parseIsActiveFilters(value: string | undefined): string[] {
  if (!value || value === "all") {
    return ["1", "0"];
  }
  if (value === "1" || value === "0") {
    return [value];
  }
  return ["1", "0"];
}
