import pino, { type Logger } from "pino";

export const PACKAGE_NAME = "@tore-legal-data-engine/logger" as const;

export type { Logger };

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env["LOG_LEVEL"] ?? "info",
  });
}
