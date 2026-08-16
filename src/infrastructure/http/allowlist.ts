import { IngestError } from "../../domain/errors.js";

export const LEGALINFO_HOSTS = new Set(["legalinfo.mn", "www.legalinfo.mn"]);

export function isLegalInfoHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  return LEGALINFO_HOSTS.has(host) || host.endsWith(".legalinfo.mn");
}

export function assertHttpsLegalInfoUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IngestError("invalid_url", `Not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:") {
    throw new IngestError("https_only", `Only HTTPS URLs are allowed: ${raw}`);
  }
  if (parsed.username || parsed.password) {
    throw new IngestError("ssrf_blocked", "URLs with credentials are not allowed");
  }
  if (!isLegalInfoHost(parsed.hostname)) {
    throw new IngestError(
      "allowlist",
      `Host ${parsed.hostname} is not an allowed LegalInfo host`,
    );
  }
  parsed.hash = "";
  return parsed;
}
