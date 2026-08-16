import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default(
    "postgresql://tore:tore@localhost:5433/tore_legal_data?schema=public",
  ),
  REDIS_URL: z.string().optional(),
  ENGINE_SERVICE_TOKEN: z.string().min(8).default("dev-engine-service-token-change-me"),
  ARCHIVE_ROOT: z.string().min(1).default(".data/archive"),
  LEGALINFO_REQUEST_DELAY_MS: z.coerce.number().int().min(500).default(4000),
  LEGALINFO_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  LEGALINFO_MAX_DOCUMENTS_PER_RUN: z.coerce.number().int().min(1).max(50).default(5),
  LEGALINFO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),
  LEGALINFO_MAX_RESPONSE_BYTES: z.coerce.number().int().min(10_000).default(8_000_000),
  LEGALINFO_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  LEGALINFO_USER_AGENT: z.string().default("TORE-Legal-Data-Engine/0.3 (+https://legalinfo.mn polite ingest)"),
  LEGALINFO_BASE_URL: z.string().url().default("https://legalinfo.mn"),
  LEGALINFO_LOCALE: z.string().default("mn"),
  LEGALINFO_CATEGORY_ID: z.string().default("27"),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
}
