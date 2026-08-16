import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, readPositiveInt } from "./index.js";

describe("common", () => {
  it("exports the package name", () => {
    expect(PACKAGE_NAME).toBe("@tore-legal-data-engine/common");
  });

  it("parses positive integers with a fallback", () => {
    expect(readPositiveInt("1500", 1)).toBe(1500);
    expect(readPositiveInt(undefined, 4)).toBe(4);
    expect(readPositiveInt("0", 4)).toBe(4);
    expect(readPositiveInt("nope", 4)).toBe(4);
  });
});
