export class RateLimiter {
  private nextAllowedAt = 0;
  private inFlight = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxConcurrency: number,
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    while (this.inFlight >= this.maxConcurrency) {
      await sleep(25);
    }
    this.inFlight += 1;
    try {
      const waitMs = this.nextAllowedAt - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
      return await operation();
    } finally {
      this.inFlight -= 1;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function backoffMs(attempt: number): number {
  return Math.min(16_000, 500 * 2 ** (attempt - 1));
}
