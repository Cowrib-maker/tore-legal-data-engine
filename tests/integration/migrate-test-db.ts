import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import {
  resolveIntegrationDatabaseUrl,
  schemaNameFromUrl,
} from "./test-database-url.js";

const url = resolveIntegrationDatabaseUrl();
const schema = schemaNameFromUrl(url);
if (schema !== "public") {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error("DATABASE_URL is required to create the test schema");
  }
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const safe = schema.replaceAll('"', "");
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${safe}"`);
  } finally {
    await admin.$disconnect();
  }
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
  shell: true,
});
process.exit(result.status ?? 1);
