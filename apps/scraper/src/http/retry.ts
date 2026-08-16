import { sleep } from "@tore-legal-data-engine/common";
import type { Logger } from "@tore-legal-data-engine/logger";

import { UnsafeRedirectError } from "./redirects.js";

export type RetryOptions = {
  maxRetries: number;
  logger: Logger;
};

export async function withRetry<T>(
  label: string,
  options: RetryOptions,
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      options.logger.warn(
        {
          event: "http.retry",
          label,
          attempt,
          maxRetries: options.maxRetries,
          retryable,
          err: error,
        },
        "request failed",
      );
      if (!retryable || attempt === options.maxRetries) {
        break;
      }
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

function backoffMs(attempt: number): number {
  return Math.min(16_000, 500 * 2 ** (attempt - 1));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof UnsafeRedirectError) {
    return false;
  }
  if (error instanceof Error && error.name === "RobotsDisallowError") {
    return false;
  }
  return true;
}
