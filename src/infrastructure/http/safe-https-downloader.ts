import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { IngestError } from "../../domain/errors.js";
import type {
  DownloadRequest,
  DownloadResult,
  IDownloader,
} from "../../domain/ports/source-connector.js";
import { assertHttpsLegalInfoUrl } from "./allowlist.js";
import { MAX_REDIRECTS, isRedirectStatus } from "./redirects.js";
import { RateLimiter, backoffMs, sleep } from "./rate-limiter.js";
import { assertPublicResolvedAddresses } from "./ssrf.js";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ResolveHost = (hostname: string) => Promise<string[]>;

export type SafeDownloaderOptions = {
  timeoutMs: number;
  maxBytes: number;
  maxRetries: number;
  delayMs: number;
  maxConcurrency: number;
  userAgent: string;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
};

const BLOCKED_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "multipart/x-zip",
]);

const ALLOWED_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export async function defaultResolveHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return [hostname];
  }
  const results = await lookup(hostname, { all: true });
  return results.map((item) => item.address);
}

export class SafeHttpsDownloader implements IDownloader {
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: FetchLike;
  private readonly resolveHost: ResolveHost;

  constructor(private readonly options: SafeDownloaderOptions) {
    this.limiter = new RateLimiter(options.delayMs, options.maxConcurrency);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
  }

  async download(request: DownloadRequest): Promise<DownloadResult> {
    if (!request.url) {
      throw new IngestError("invalid_url", "A LegalInfo URL is required");
    }
    const started = assertHttpsLegalInfoUrl(request.url);
    return this.limiter.run(() => this.downloadResolved(started.toString()));
  }

  private async downloadResolved(startUrl: string): Promise<DownloadResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt += 1) {
      try {
        return await this.follow(startUrl);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt > this.options.maxRetries) {
          break;
        }
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError;
  }

  private async follow(startUrl: string): Promise<DownloadResult> {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = assertHttpsLegalInfoUrl(current);
      const addresses = await this.resolveHost(parsed.hostname);
      assertPublicResolvedAddresses(parsed.hostname, addresses);

      const response = await this.fetchImpl(parsed.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: {
          "User-Agent": this.options.userAgent,
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5",
        },
      });

      if (isRedirectStatus(response.status)) {
        if (hop === MAX_REDIRECTS) {
          throw new IngestError("redirect", "Too many redirects");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new IngestError("redirect", "Redirect missing Location header");
        }
        let next: URL;
        try {
          next = new URL(location, parsed);
        } catch {
          throw new IngestError("redirect", "Redirect Location is not a valid URL");
        }
        current = assertHttpsLegalInfoUrl(next.toString()).toString();
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        throw new IngestError(
          "http_transient",
          `HTTP ${response.status} for ${parsed.toString()}`,
        );
      }
      if (response.status >= 400) {
        throw new IngestError(
          "http_error",
          `HTTP ${response.status} for ${parsed.toString()}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (BLOCKED_TYPES.has(media)) {
        throw new IngestError("content_type", `Blocked content type ${media}`);
      }

      const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declared) && declared > this.options.maxBytes) {
        throw new IngestError("too_large", "Response exceeds size limit");
      }

      const bytes = await readLimitedBody(response, this.options.maxBytes);
      if (!ALLOWED_TYPES.has(media) && !looksLikeHtml(bytes) && !looksLikePdf(bytes)) {
        throw new IngestError("content_type", `Unexpected content type ${media || "unknown"}`);
      }

      return {
        url: startUrl,
        retrievedUrl: parsed.toString(),
        bytes,
        mimeType: contentType,
        retrievedAt: new Date().toISOString(),
        httpStatus: response.status,
      };
    }
    throw new IngestError("redirect", "Too many redirects");
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new IngestError("too_large", "Response exceeds size limit");
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IngestError("too_large", "Response exceeds size limit");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1").startsWith("%PDF");
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 512)).toString("utf8").trimStart().toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.includes("<html");
}

function isRetryable(error: unknown): boolean {
  return error instanceof IngestError && error.code === "http_transient";
}
