export type ArchiveMetadata = {
  originalUrl: string;
  retrievedAt: string;
  mimeType: string;
  originalFileName: string;
  encoding?: string;
  sourceId?: string | null;
};

export type ArchiveRecord = {
  archiveId: string;
  sha256: string;
  originalUrl: string;
  retrievedAt: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  originalFileName: string;
  encoding?: string;
  sourceId?: string | null;
};

export type ArchiveStoreResult = {
  record: ArchiveRecord;
  created: boolean;
};

export interface ArchiveStorage {
  putIfAbsent(
    bytes: Uint8Array,
    metadata: ArchiveMetadata,
  ): Promise<ArchiveStoreResult>;
  get(sha256: string): Promise<Uint8Array | null>;
  findByHash(sha256: string): Promise<ArchiveRecord | null>;
  health(): Promise<{ ok: boolean; storage: string; detail: string }>;
}
