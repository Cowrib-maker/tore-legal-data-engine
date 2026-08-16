export type IngestLogFields = {
  source?: string | null;
  document?: string | null;
  url?: string | null;
  hash?: string | null;
  stage: string;
  duration?: number;
  result: string;
  errorCode?: string;
};

export function logIngest(fields: IngestLogFields): void {
  const line = {
    ts: new Date().toISOString(),
    source: fields.source ?? null,
    document: fields.document ?? null,
    url: fields.url ?? null,
    hash: fields.hash ?? null,
    stage: fields.stage,
    duration: fields.duration ?? null,
    result: fields.result,
    errorCode: fields.errorCode ?? null,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
