import { createRequire } from "node:module";

import type { Logger } from "@tore-legal-data-engine/logger";

type Robot = {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
};

type RobotsParser = (url: string, robotstxt: string) => Robot;

const robotsParser = createRequire(import.meta.url)("robots-parser") as RobotsParser;

export class RobotsPolicy {
  private constructor(
    private readonly robots: Robot,
    private readonly userAgent: string,
    readonly crawlDelayMs: number,
  ) {}

  static async load(params: {
    robotsUrl: string;
    userAgent: string;
    fetchText: (url: string) => Promise<{ status: number; body: string }>;
    fallbackDelayMs: number;
    logger: Logger;
  }): Promise<RobotsPolicy> {
    try {
      const response = await params.fetchText(params.robotsUrl);
      if (response.status === 404) {
        params.logger.info(
          { event: "robots.missing", robotsUrl: params.robotsUrl, status: 404 },
          "robots.txt missing; allowing crawl",
        );
        return RobotsPolicy.allowAll(params.userAgent, params.fallbackDelayMs);
      }
      if (response.status >= 400) {
        params.logger.warn(
          { event: "robots.error", robotsUrl: params.robotsUrl, status: response.status },
          "robots.txt not usable; allowing crawl with configured delay",
        );
        return RobotsPolicy.allowAll(params.userAgent, params.fallbackDelayMs);
      }
      const robots = robotsParser(params.robotsUrl, response.body);
      const delaySeconds = robots.getCrawlDelay(params.userAgent);
      const crawlDelayMs =
        typeof delaySeconds === "number" && delaySeconds > 0
          ? delaySeconds * 1000
          : params.fallbackDelayMs;
      params.logger.info(
        { event: "robots.loaded", robotsUrl: params.robotsUrl, crawlDelayMs },
        "loaded robots.txt",
      );
      return new RobotsPolicy(robots, params.userAgent, crawlDelayMs);
    } catch (error) {
      params.logger.warn(
        { event: "robots.error", robotsUrl: params.robotsUrl, err: error },
        "failed to load robots.txt; allowing crawl with configured delay",
      );
      return RobotsPolicy.allowAll(params.userAgent, params.fallbackDelayMs);
    }
  }

  static allowAll(userAgent: string, crawlDelayMs: number): RobotsPolicy {
    return new RobotsPolicy(
      robotsParser("https://example.invalid/robots.txt", "User-agent: *\nAllow: /"),
      userAgent,
      crawlDelayMs,
    );
  }

  isAllowed(url: string): boolean {
    return this.robots.isAllowed(url, this.userAgent) !== false;
  }
}
