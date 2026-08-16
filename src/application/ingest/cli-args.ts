export type IngestCliOptions = {
  limit: number;
  dryRun: boolean;
  url?: string;
  lawId?: string;
  lawIds?: string[];
  allowFullCrawl: boolean;
  fromArchive?: string;
  retrievedAt?: string;
  expectedShape?: {
    articles: number;
    paragraphs: number;
    clauses: number;
    nodes: number;
  };
};

export function parseIngestCliArgs(
  argv: string[],
  maxDocumentsPerRun: number,
): IngestCliOptions {
  const flags = parseFlags(argv);
  const allowFullCrawl = flags["allow-full-crawl"] === "true";
  const dryRun = flags.publish === "true" ? false : flags["dry-run"] !== "false";
  const requested = flags.limit ? Number.parseInt(flags.limit, 10) : 1;
  const parsedLimit = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const expectedShape = parseExpectedShape(flags);
  const lawIds = parseLawIds(argv, flags["law-id"]);
  const needed = lawIds?.length ?? (flags.url || flags["law-id"] ? 1 : parsedLimit);
  const uncapped = Math.max(parsedLimit, needed);
  const capped = allowFullCrawl ? uncapped : Math.min(uncapped, maxDocumentsPerRun);
  return {
    limit: Math.max(1, capped),
    dryRun,
    url: flags.url,
    lawId: lawIds?.[0] ?? flags["law-id"],
    lawIds,
    allowFullCrawl,
    fromArchive: flags["from-archive"],
    retrievedAt: flags["retrieved-at"],
    expectedShape,
  };
}

function parseLawIds(argv: string[], single?: string): string[] | undefined {
  const collected: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--law-id") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        collected.push(next);
      }
      continue;
    }
    if (token?.startsWith("--law-id=")) {
      collected.push(token.slice("--law-id=".length));
    }
  }
  if (collected.length === 0 && single) {
    collected.push(single);
  }
  const unique = [...new Set(collected.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
  return unique.length ? unique : undefined;
}

function parseExpectedShape(
  flags: Record<string, string>,
): IngestCliOptions["expectedShape"] {
  const articles = Number.parseInt(flags["expect-articles"] ?? "", 10);
  const paragraphs = Number.parseInt(flags["expect-paragraphs"] ?? "", 10);
  const clauses = Number.parseInt(flags["expect-clauses"] ?? "", 10);
  const nodes = Number.parseInt(flags["expect-nodes"] ?? "", 10);
  if ([articles, paragraphs, clauses, nodes].every((value) => Number.isFinite(value))) {
    return { articles, paragraphs, clauses, nodes };
  }
  return undefined;
}

export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const eq = key.indexOf("=");
    if (eq >= 0) {
      flags[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
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
