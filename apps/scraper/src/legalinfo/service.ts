import { getPrisma, disconnectPrisma, type CrawlJob } from "@tore-legal-data-engine/db";
import type { Logger } from "@tore-legal-data-engine/logger";

import type { DiscoveryConfig } from "../config.js";
import {
  categoryKey,
  clearCheckpoint,
  readCheckpoint,
  writeCheckpoint,
  type DiscoveryCheckpoint,
} from "./checkpoint.js";
import { LegalInfoClient } from "./client.js";
import { crawlCategoryPages, discoverCategories } from "./index-crawler.js";
import { ensureLegalInfoSource, persistDiscoveredDocument } from "./persist.js";

export type DiscoveryProgress = {
  found: number;
  inserted: number;
  updated: number;
  duplicates: number;
  failed: number;
};

export async function runDiscovery(
  config: DiscoveryConfig,
  logger: Logger,
): Promise<DiscoveryProgress> {
  const prisma = getPrisma();
  const source = await ensureLegalInfoSource();
  const client = await LegalInfoClient.create(config, logger);
  const categories = await discoverCategories(client, config, logger);
  const progress: DiscoveryProgress = {
    found: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    failed: 0,
  };

  const checkpoint = config.resume ? await readCheckpoint(config.checkpointPath) : null;
  const job = await startJob(source.id, checkpoint, config.resume, logger);
  const completed = new Set(checkpoint?.jobId === job.id ? checkpoint.completedKeys : []);
  const seenUrls = new Set(
    (
      await prisma.crawlResult.findMany({
        where: { crawlJobId: job.id },
        select: { url: true },
      })
    ).map((row) => row.url),
  );

  restoreProgress(progress, job);

  const stop = installShutdownHandler(async (signal) => {
    logger.warn(
      { event: "discovery.cancelled", signal, jobId: job.id, ...progress },
      "discovery interrupted",
    );
    await prisma.crawlJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        ...jobCounters(progress),
      },
    });
  });

  try {
    for (const category of categories) {
      for (const isActive of config.isActiveFilters) {
        const key = categoryKey(category.id, isActive);
        if (completed.has(key)) {
          logger.info(
            { event: "discovery.category.skip", categoryId: category.id, isActive, jobId: job.id },
            "category already completed",
          );
          continue;
        }

        const startPage =
          checkpoint?.jobId === job.id &&
          checkpoint.current?.categoryId === category.id &&
          checkpoint.current.isActive === isActive
            ? checkpoint.current.page
            : 1;

        logger.info(
          {
            event: "discovery.category.start",
            categoryId: category.id,
            categoryName: category.name,
            isActive,
            startPage,
            jobId: job.id,
          },
          "crawling category index",
        );

        await crawlCategoryPages(
          client,
          config,
          logger,
          category,
          isActive,
          startPage,
          async (page) => {
            await writeCheckpoint(config.checkpointPath, {
              version: 1,
              jobId: job.id,
              completedKeys: [...completed],
              current: { categoryId: category.id, isActive, page: page.page },
              updatedAt: new Date().toISOString(),
            });

            for (const document of page.documents) {
              if (seenUrls.has(document.sourceUrl)) {
                continue;
              }
              progress.found += 1;
              try {
                const result = await persistDiscoveredDocument({
                  sourceId: source.id,
                  crawlJobId: job.id,
                  document,
                  httpStatus: page.httpStatus,
                });
                seenUrls.add(document.sourceUrl);
                if (result.outcome === "inserted") {
                  progress.inserted += 1;
                } else if (result.outcome === "updated") {
                  progress.updated += 1;
                } else {
                  progress.duplicates += 1;
                }
              } catch (error) {
                progress.failed += 1;
                logger.error(
                  {
                    event: "discovery.document.failed",
                    url: document.sourceUrl,
                    lawId: document.lawId,
                    err: error,
                  },
                  "failed to store document metadata",
                );
              }
            }

            await prisma.crawlJob.update({
              where: { id: job.id },
              data: jobCounters(progress),
            });

            logger.info(
              {
                event: "discovery.progress",
                jobId: job.id,
                categoryId: page.categoryId,
                categoryName: page.categoryName,
                isActive: page.isActive,
                page: page.page,
                pageDocuments: page.documents.length,
                ...progress,
              },
              "discovery progress",
            );
          },
        );

        completed.add(key);
        await writeCheckpoint(config.checkpointPath, {
          version: 1,
          jobId: job.id,
          completedKeys: [...completed],
          current: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await prisma.crawlJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        ...jobCounters(progress),
      },
    });
    await clearCheckpoint(config.checkpointPath);
    logger.info(
      { event: "discovery.completed", jobId: job.id, ...progress },
      "discovery completed",
    );
    return progress;
  } catch (error) {
    await prisma.crawlJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorLog: error instanceof Error ? (error.stack ?? error.message) : String(error),
        ...jobCounters(progress),
      },
    });
    logger.error(
      { event: "discovery.failed", jobId: job.id, err: error, ...progress },
      "discovery failed",
    );
    throw error;
  } finally {
    stop();
    await disconnectPrisma();
  }
}

async function startJob(
  sourceId: string,
  checkpoint: DiscoveryCheckpoint | null,
  resume: boolean,
  logger: Logger,
): Promise<CrawlJob> {
  const prisma = getPrisma();
  if (resume && checkpoint?.jobId) {
    const existing = await prisma.crawlJob.findUnique({ where: { id: checkpoint.jobId } });
    if (
      existing &&
      (existing.status === "RUNNING" ||
        existing.status === "FAILED" ||
        existing.status === "CANCELLED")
    ) {
      const job = await prisma.crawlJob.update({
        where: { id: existing.id },
        data: { status: "RUNNING", finishedAt: null, errorLog: null },
      });
      logger.info({ event: "discovery.resume", jobId: job.id }, "resuming crawl job");
      return job;
    }
  }

  if (resume) {
    const latest = await prisma.crawlJob.findFirst({
      where: { sourceId, status: { in: ["RUNNING", "FAILED", "CANCELLED"] } },
      orderBy: { startedAt: "desc" },
    });
    if (latest) {
      const job = await prisma.crawlJob.update({
        where: { id: latest.id },
        data: { status: "RUNNING", finishedAt: null, errorLog: null },
      });
      logger.info(
        { event: "discovery.resume", jobId: job.id },
        "resuming latest incomplete crawl job",
      );
      return job;
    }
  }

  const job = await prisma.crawlJob.create({
    data: {
      sourceId,
      startedAt: new Date(),
      status: "RUNNING",
    },
  });
  logger.info({ event: "discovery.start", jobId: job.id }, "started crawl job");
  return job;
}

function restoreProgress(progress: DiscoveryProgress, job: CrawlJob): void {
  progress.found = job.totalFound;
  progress.failed = job.totalFailed;
  progress.inserted = job.totalDownloaded;
}

function jobCounters(progress: DiscoveryProgress) {
  return {
    totalFound: progress.found,
    totalDownloaded: progress.inserted + progress.updated,
    totalFailed: progress.failed,
  };
}

function installShutdownHandler(onStop: (signal: string) => Promise<void>): () => void {
  let stopping = false;
  const handler = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    void onStop(signal).finally(() => {
      process.exit(130);
    });
  };
  const sigint = (): void => handler("SIGINT");
  const sigterm = (): void => handler("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  return () => {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  };
}
