import type {
  DownloadRequest,
  DownloadResult,
  IDownloader,
} from "../../domain/ports/source-connector.js";

/** Network I/O disabled unless the LegalInfo ingest CLI is used. */
export class DisabledDownloader implements IDownloader {
  async download(_request: DownloadRequest): Promise<DownloadResult> {
    throw new Error("Downloading official sources is disabled outside ingest:legalinfo");
  }
}
