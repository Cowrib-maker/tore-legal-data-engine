import { describe, expect, it } from "vitest";

import {
  UnsafeTestDatabaseError,
  assertSafeTestDatabaseUrl,
  databaseNameFromUrl,
  resolveIntegrationDatabaseUrl,
  schemaNameFromUrl,
} from "../integration/test-database-url.js";

describe("test database isolation", () => {
  it("rejects the shared corpus database public schema", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://tore:tore@localhost:5432/tore_legal_data?schema=public",
      ),
    ).toThrow(UnsafeTestDatabaseError);
  });

  it("rejects DATABASE_URL fallback when TEST_DATABASE_URL is missing", () => {
    expect(() =>
      resolveIntegrationDatabaseUrl({
        DATABASE_URL: "postgresql://tore:tore@localhost:5432/tore_legal_data_test",
      }),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it("rejects production-like names and unmarked targets", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://tore:tore@localhost:5432/tore_legal_data_prod"),
    ).toThrow(UnsafeTestDatabaseError);
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://tore:tore@localhost:5432/legal_corpus"),
    ).toThrow(/explicitly indicate test/);
  });

  it("accepts an explicit test database URL", () => {
    const url = "postgresql://tore:tore@localhost:5434/tore_legal_data_test?schema=public";
    expect(assertSafeTestDatabaseUrl(url)).toBe(url);
    expect(databaseNameFromUrl(url)).toBe("tore_legal_data_test");
    expect(
      resolveIntegrationDatabaseUrl({
        TEST_DATABASE_URL: url,
        DATABASE_URL: "postgresql://tore:tore@localhost:5432/tore_legal_data?schema=public",
      }),
    ).toBe(url);
  });

  it("accepts a test schema on the corpus host as an isolation mechanism", () => {
    const url = "postgresql://tore:tore@localhost:5432/tore_legal_data?schema=tore_legal_test";
    expect(assertSafeTestDatabaseUrl(url)).toBe(url);
    expect(schemaNameFromUrl(url)).toBe("tore_legal_test");
  });
});
