import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

export const PACKAGE_NAME = "@tore-legal-data-engine/common" as const;

export function loadEnv(cwd: string = process.cwd()): void {
  const envPath = findEnvFile(cwd);
  config({ path: envPath ?? resolve(cwd, ".env") });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
