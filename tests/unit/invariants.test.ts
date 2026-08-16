import { describe, expect, it } from "vitest";

import { SharedSecretAuthenticator } from "../../src/infrastructure/auth/service-auth.js";
import { healthResponseSchema } from "../../src/api/contracts.js";

describe("domain and API invariants", () => {
  it("does not treat a missing service token as authenticated", () => {
    const auth = new SharedSecretAuthenticator("engine-secret");
    expect(auth.authenticate(undefined)).toBe(false);
    expect(auth.authenticate("Bearer wrong")).toBe(false);
    expect(auth.authenticate("Bearer engine-secret")).toBe(true);
  });

  it("health contract names the engine service", () => {
    const parsed = healthResponseSchema.parse({
      ok: true,
      service: "tore-legal-data-engine",
      version: "0.1.0",
      checkedAt: "2026-08-16T00:00:00.000Z",
      dependencies: {
        archive: { ok: true, storage: "local-filesystem", detail: "writable" },
        postgres: { ok: true, storage: "postgresql", detail: "connected" },
      },
    });
    expect(parsed.service).toBe("tore-legal-data-engine");
  });
});
