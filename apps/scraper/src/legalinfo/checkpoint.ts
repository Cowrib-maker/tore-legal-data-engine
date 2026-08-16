import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DiscoveryCheckpoint = {
  version: 1;
  jobId: string;
  completedKeys: string[];
  current: {
    categoryId: string;
    isActive: string;
    page: number;
  } | null;
  updatedAt: string;
};

export function categoryKey(categoryId: string, isActive: string): string {
  return `${categoryId}:${isActive}`;
}

export async function readCheckpoint(path: string): Promise<DiscoveryCheckpoint | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as DiscoveryCheckpoint;
    if (parsed.version !== 1 || typeof parsed.jobId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCheckpoint(
  path: string,
  checkpoint: DiscoveryCheckpoint,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const next: DiscoveryCheckpoint = {
    ...checkpoint,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function clearCheckpoint(path: string): Promise<void> {
  await writeFile(path, "", "utf8").catch(() => undefined);
}
