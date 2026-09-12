/**
 * Structured, PII-free telemetry for /v1/retrieve. Never pass question
 * text, node/document titles, excerpts, or any legal content here — only
 * counts, timings, and enum-like labels. Mirrors the plain
 * stdout-JSON-line convention already used by logIngest (structured-log.ts).
 */

export type RetrievalLogOperation = "retrieveOpenQuestion";

export type RetrievalLogFields = {
  operation: RetrievalLogOperation;
  candidateCount: number;
  resultCount: number;
  latencyMs: number;
  zeroResult: boolean;
  asOf: boolean;
};

export function logRetrievalEvent(fields: RetrievalLogFields): void {
  const line = {
    ts: new Date().toISOString(),
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
