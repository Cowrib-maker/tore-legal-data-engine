import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { categoryKey, readCheckpoint, writeCheckpoint } from "./checkpoint.js";

describe("discovery checkpoint", () => {
  it("round-trips checkpoint state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "legalinfo-checkpoint-"));
    const path = join(dir, "legalinfo-discovery.json");
    await writeCheckpoint(path, {
      version: 1,
      jobId: "job-1",
      completedKeys: [categoryKey("27", "1")],
      current: { categoryId: "26", isActive: "0", page: 3 },
      updatedAt: "",
    });
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("job-1");
    const loaded = await readCheckpoint(path);
    expect(loaded?.jobId).toBe("job-1");
    expect(loaded?.completedKeys).toEqual(["27:1"]);
    expect(loaded?.current).toEqual({ categoryId: "26", isActive: "0", page: 3 });
  });
});
