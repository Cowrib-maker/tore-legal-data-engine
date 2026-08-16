import { sleep } from "@tore-legal-data-engine/common";

export class RateLimiter {
  private nextAllowedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const waitMs = this.nextAllowedAt - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.nextAllowedAt = Date.now() + this.minIntervalMs;
  }
}
