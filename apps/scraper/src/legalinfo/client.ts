import type { Logger } from "@tore-legal-data-engine/logger";

import type { DiscoveryConfig } from "../config.js";
import { RateLimiter } from "../http/rate-limiter.js";
import {
  MAX_REDIRECTS,
  UnsafeRedirectError,
  isRedirectStatus,
  originHostname,
  resolveSafeRedirect,
} from "../http/redirects.js";
import { HttpError, withRetry } from "../http/retry.js";
import { RobotsPolicy } from "../http/robots.js";

export type HttpResponse = {
  status: number;
  body: string;
  url: string;
};

export type DownloadedHeaders = {
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
  lastModified: string | null;
};

export type BinaryHttpResponse = {
  status: number;
  url: string;
  bytes: Buffer;
  headers: DownloadedHeaders;
};

export type DownloadHttpClient = {
  getBytes(pathOrUrl: string): Promise<BinaryHttpResponse>;
  postFormBytes(
    pathOrUrl: string,
    fields: Record<string, string>,
    referer: string,
  ): Promise<BinaryHttpResponse>;
};

export class RobotsDisallowError extends Error {
  constructor(url: string) {
    super(`Blocked by robots.txt: ${url}`);
    this.name = "RobotsDisallowError";
  }
}

export class LegalInfoClient implements DownloadHttpClient {
  private readonly cookies = new Map<string, string>();
  private robots: RobotsPolicy;
  private limiter: RateLimiter;
  private readonly originHost: string;

  private constructor(
    private readonly config: DiscoveryConfig,
    private readonly logger: Logger,
    robots: RobotsPolicy,
  ) {
    this.robots = robots;
    this.limiter = new RateLimiter(Math.max(config.minDelayMs, robots.crawlDelayMs));
    this.originHost = originHostname(config.baseUrl);
  }

  static async create(config: DiscoveryConfig, logger: Logger): Promise<LegalInfoClient> {
    const client = new LegalInfoClient(
      config,
      logger,
      RobotsPolicy.allowAll(config.userAgent, config.minDelayMs),
    );
    const robotsUrl = new URL("/robots.txt", `${config.baseUrl}/`).toString();
    const robots = await RobotsPolicy.load({
      robotsUrl,
      userAgent: config.userAgent,
      fallbackDelayMs: config.minDelayMs,
      logger,
      fetchText: async (url) => client.request(url, { method: "GET" }, { skipRobots: true }),
    });
    client.robots = robots;
    client.limiter = new RateLimiter(Math.max(config.minDelayMs, robots.crawlDelayMs));
    return client;
  }

  static createUnchecked(config: DiscoveryConfig, logger: Logger): LegalInfoClient {
    return new LegalInfoClient(
      config,
      logger,
      RobotsPolicy.allowAll(config.userAgent, config.minDelayMs),
    );
  }

  async get(pathOrUrl: string): Promise<HttpResponse> {
    return this.request(this.resolve(pathOrUrl), { method: "GET" });
  }

  async getBytes(pathOrUrl: string): Promise<BinaryHttpResponse> {
    return this.requestBytes(this.resolve(pathOrUrl), { method: "GET" });
  }

  async postForm(
    pathOrUrl: string,
    fields: Record<string, string>,
    referer: string,
  ): Promise<HttpResponse> {
    return this.request(this.resolve(pathOrUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: referer,
      },
      body: new URLSearchParams(fields),
    });
  }

  async postFormBytes(
    pathOrUrl: string,
    fields: Record<string, string>,
    referer: string,
  ): Promise<BinaryHttpResponse> {
    return this.requestBytes(this.resolve(pathOrUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        Referer: referer,
      },
      body: new URLSearchParams(fields),
    });
  }

  private resolve(pathOrUrl: string): string {
    return new URL(pathOrUrl, `${this.config.baseUrl}/`).toString();
  }

  private async request(
    url: string,
    init: RequestInit,
    options: { skipRobots?: boolean } = {},
  ): Promise<HttpResponse> {
    const binary = await this.requestBytes(url, init, options);
    return {
      status: binary.status,
      body: binary.bytes.toString("utf8"),
      url: binary.url,
    };
  }

  private async requestBytes(
    url: string,
    init: RequestInit,
    options: { skipRobots?: boolean } = {},
  ): Promise<BinaryHttpResponse> {
    if (!options.skipRobots && !this.robots.isAllowed(url)) {
      throw new RobotsDisallowError(url);
    }
    return withRetry(url, { maxRetries: this.config.maxRetries, logger: this.logger }, async () => {
      let currentUrl = url;
      let method = (init.method ?? "GET").toUpperCase();
      let body: RequestInit["body"] = init.body;
      const headers = extraHeaders(init.headers);

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (hop > 0 && !options.skipRobots && !this.robots.isAllowed(currentUrl)) {
          throw new RobotsDisallowError(currentUrl);
        }
        await this.limiter.wait();
        const response = await fetch(currentUrl, {
          method,
          body: method === "GET" || method === "HEAD" ? undefined : body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          headers: {
            "User-Agent": this.config.userAgent,
            Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
            Cookie: this.cookieHeader(),
            ...headers,
          },
        });
        this.storeCookies(response);

        if (isRedirectStatus(response.status)) {
          if (hop === MAX_REDIRECTS) {
            throw new UnsafeRedirectError(
              currentUrl,
              response.headers.get("location"),
              "too many redirects",
            );
          }
          currentUrl = resolveSafeRedirect({
            fromUrl: currentUrl,
            location: response.headers.get("location"),
            originHostname: this.originHost,
          });
          if (response.status === 301 || response.status === 302 || response.status === 303) {
            method = "GET";
            body = undefined;
            delete headers["Content-Type"];
            delete headers["content-type"];
          }
          continue;
        }

        if (response.status === 429 || response.status >= 500) {
          throw new HttpError(response.status, currentUrl);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        return {
          status: response.status,
          url: currentUrl,
          bytes,
          headers: readResponseHeaders(response.headers),
        };
      }

      throw new UnsafeRedirectError(url, null, "too many redirects");
    });
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private storeCookies(response: Response): void {
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const pair = header.split(";", 1)[0];
      if (!pair) {
        continue;
      }
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

export function readResponseHeaders(headers: Headers): DownloadedHeaders {
  const contentLengthHeader = headers.get("content-length");
  const parsedLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  return {
    contentType: headers.get("content-type"),
    contentLength: Number.isFinite(parsedLength) ? parsedLength : null,
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
  };
}

function extraHeaders(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}
