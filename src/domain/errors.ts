export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class InvariantError extends DomainError {
  constructor(message: string) {
    super("invariant_violation", message);
    this.name = "InvariantError";
  }
}

export class IngestError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "IngestError";
  }
}
