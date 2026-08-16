import { describe, expect, it } from "vitest";

import { CHECKSUM_ALGORITHM, contentAddressKey, sha256Hex } from "./cas.js";

describe("content-addressable keys", () => {
  it("builds a sha256 fan-out key from the digest", () => {
    const checksum = sha256Hex(Buffer.from("legal-source"));
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(contentAddressKey(checksum)).toBe(
      `${CHECKSUM_ALGORITHM}/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}`,
    );
  });

  it("rejects invalid digests", () => {
    expect(() => contentAddressKey("not-a-hash")).toThrow(/checksum must be/);
  });
});
