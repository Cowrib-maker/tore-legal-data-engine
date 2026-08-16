export class StorageNotImplementedError extends Error {
  constructor(backend: string) {
    super(`${backend} storage is not implemented`);
    this.name = "StorageNotImplementedError";
  }
}

export class ArchiveIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveIntegrityError";
  }
}

export class ArchiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveConflictError";
  }
}
