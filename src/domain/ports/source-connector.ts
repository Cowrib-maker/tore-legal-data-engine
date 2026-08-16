export type SourceDescriptor = {
  id: string;
  name: string;
  jurisdiction: string;
  authority: string;
  enabled: boolean;
};

export type DownloadRequest = {
  url?: string;
  locator?: string;
};

export type DownloadResult = {
  url: string;
  retrievedUrl: string;
  bytes: Uint8Array;
  mimeType: string;
  retrievedAt: string;
  httpStatus?: number;
};

export type DiscoveredAct = {
  sourceUrl: string;
  canonicalUrl: string;
  discoveredTitle: string | null;
  actType: string | null;
  lawId: string | null;
  discoveredAt: string;
};

export type DiscoverRequest = {
  limit: number;
  url?: string;
  lawId?: string;
  lawIds?: string[];
};

export interface IDownloader {
  download(request: DownloadRequest): Promise<DownloadResult>;
}

export interface ISourceConnector {
  readonly descriptor: SourceDescriptor;
  connect(): Promise<{ connected: boolean; mode: "mock" | "live" }>;
  discover(request: DiscoverRequest): Promise<DiscoveredAct[]>;
  download(request?: DownloadRequest): Promise<DownloadResult>;
  health(): Promise<{ ok: boolean; detail: string }>;
}
