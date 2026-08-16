import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@tore-legal-data-engine/logger";

import { UnsafeRedirectError } from "./redirects.js";
import { HttpError, withRetry } from "./retry.js";
import { RobotsPolicy } from "./robots.js";

const logger = createLogger("scraper-test");

describe("retry", () => {
  it("retries retryable HTTP errors then succeeds", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(503, "https://legalinfo.mn/mn/ajaxList/"))
      .mockResolvedValueOnce("ok");

    await expect(withRetry("ajaxList", { maxRetries: 3, logger }, operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry HTTP 403", async () => {
    const error = new HttpError(403, "https://legalinfo.mn/api/");
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withRetry("api", { maxRetries: 3, logger }, operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry unsafe redirects", async () => {
    const error = new UnsafeRedirectError(
      "https://legalinfo.mn/mn/detail?lawId=1",
      "https://evil.example/",
    );
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withRetry("detail", { maxRetries: 3, logger }, operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("robots policy", () => {
  it("allows crawl when robots.txt is missing", async () => {
    const policy = await RobotsPolicy.load({
      robotsUrl: "https://legalinfo.mn/robots.txt",
      userAgent: "TORE-Legal-Data-Engine/0.1",
      fallbackDelayMs: 1500,
      logger,
      fetchText: async () => ({ status: 404, body: "" }),
    });
    expect(policy.isAllowed("https://legalinfo.mn/mn/ajaxList/")).toBe(true);
    expect(policy.crawlDelayMs).toBe(1500);
  });

  it("honors disallow rules and crawl-delay", async () => {
    const policy = await RobotsPolicy.load({
      robotsUrl: "https://legalinfo.mn/robots.txt",
      userAgent: "TORE-Legal-Data-Engine/0.1",
      fallbackDelayMs: 1500,
      logger,
      fetchText: async () => ({
        status: 200,
        body: "User-agent: *\nDisallow: /private\nCrawl-delay: 2\n",
      }),
    });
    expect(policy.isAllowed("https://legalinfo.mn/mn/law/27")).toBe(true);
    expect(policy.isAllowed("https://legalinfo.mn/private/secret")).toBe(false);
    expect(policy.crawlDelayMs).toBe(2000);
  });
});
