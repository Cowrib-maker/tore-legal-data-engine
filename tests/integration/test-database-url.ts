/**
 * Integration tests may TRUNCATE. That is only allowed against an explicit
 * test database or test schema, never the shared/development corpus.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const CORPUS_DATABASE_NAMES = new Set([
  "tore_legal_data",
  "postgres",
  "template0",
  "template1",
]);

const PRODUCTION_NAME = /(^|[_-])(prod|production)([_-]|$)/i;
const TEST_NAME = /(?:^|[_-])test(?:[_-]|$)/i;

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestDatabaseError("Invalid database URL");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
  return name.trim();
}

export function schemaNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestDatabaseError("Invalid database URL");
  }
  return parsed.searchParams.get("schema")?.trim() || "public";
}

export function looksLikeTestName(name: string): boolean {
  return TEST_NAME.test(name);
}

export function assertSafeTestDatabaseUrl(url: string | undefined | null): string {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) {
    throw new UnsafeTestDatabaseError(
      "TEST_DATABASE_URL is required for integration tests. Refusing to use DATABASE_URL.",
    );
  }
  const name = databaseNameFromUrl(trimmed);
  const schema = schemaNameFromUrl(trimmed);
  if (!name) {
    throw new UnsafeTestDatabaseError("Database URL is missing a database name");
  }
  if (PRODUCTION_NAME.test(name) || PRODUCTION_NAME.test(schema)) {
    throw new UnsafeTestDatabaseError(
      `Refusing destructive tests against production-like target "${name}" schema "${schema}"`,
    );
  }
  const databaseIsTest = looksLikeTestName(name);
  const schemaIsTest = looksLikeTestName(schema) && schema !== "public";
  if (CORPUS_DATABASE_NAMES.has(name) && !schemaIsTest) {
    throw new UnsafeTestDatabaseError(
      `Refusing destructive tests against shared/corpus database "${name}" (schema "${schema}")`,
    );
  }
  if (!databaseIsTest && !schemaIsTest) {
    throw new UnsafeTestDatabaseError(
      `Target "${name}" schema "${schema}" must explicitly indicate test`,
    );
  }
  if (schema === "public" && CORPUS_DATABASE_NAMES.has(name)) {
    throw new UnsafeTestDatabaseError(
      `Refusing public schema on shared/corpus database "${name}"`,
    );
  }
  return trimmed;
}

export function resolveIntegrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  loadOptionalEnvFile(env);
  return assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL);
}

function loadOptionalEnvFile(env: NodeJS.ProcessEnv): void {
  if (env !== process.env) {
    return;
  }
  if (env.TEST_DATABASE_URL) {
    return;
  }
  try {
    const text = readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const eq = line.indexOf("=");
      if (eq < 1) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (env[key] === undefined) {
        env[key] = value;
      }
    }
  } catch {
    // No .env file; CI and explicit env remain authoritative.
  }
}
