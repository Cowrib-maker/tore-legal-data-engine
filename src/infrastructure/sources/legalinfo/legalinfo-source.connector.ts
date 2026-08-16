import type {
  DiscoverRequest,
  DiscoveredAct,
  DownloadRequest,
  DownloadResult,
  IDownloader,
  ISourceConnector,
  SourceDescriptor,
} from "../../../domain/ports/source-connector.js";
import { IngestError } from "../../../domain/errors.js";
import {
  discoveredFromLawId,
  discoveredFromUrl,
  listingUrl,
  parseListHtml,
} from "./discovery.js";

export class LegalInfoSourceConnector implements ISourceConnector {
  readonly descriptor: SourceDescriptor = {
    id: "mn.legalinfo",
    name: "LegalInfo Mongolia",
    jurisdiction: "MN",
    authority: "LEGALINFO",
    enabled: true,
  };

  constructor(
    private readonly downloader: IDownloader,
    private readonly options: { locale?: string; categoryId?: string } = {},
  ) {}

  async connect(): Promise<{ connected: boolean; mode: "mock" | "live" }> {
    return { connected: true, mode: "live" };
  }

  async discover(request: DiscoverRequest): Promise<DiscoveredAct[]> {
    const discoveredAt = new Date().toISOString();
    if (request.url) {
      return [discoveredFromUrl(request.url, discoveredAt)].slice(0, request.limit);
    }
    const lawIds = [
      ...(request.lawIds ?? []),
      ...(request.lawId && !request.lawIds?.includes(request.lawId) ? [request.lawId] : []),
    ];
    if (lawIds.length > 0) {
      return lawIds
        .map((lawId) => discoveredFromLawId(lawId, discoveredAt))
        .slice(0, request.limit);
    }
    const listing = listingUrl(this.options.locale ?? "mn", this.options.categoryId ?? "27");
    const downloaded = await this.downloader.download({ url: listing });
    const html = new TextDecoder("utf-8").decode(downloaded.bytes);
    return parseListHtml(html, discoveredAt).slice(0, request.limit);
  }

  async download(request?: DownloadRequest): Promise<DownloadResult> {
    if (!request?.url) {
      throw new IngestError("invalid_url", "LegalInfo download requires a URL");
    }
    return this.downloader.download(request);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "LegalInfo public connector (Mонгол Улсын хууль / category 27)" };
  }
}
