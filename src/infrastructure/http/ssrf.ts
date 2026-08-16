import { isIP } from "node:net";

import { IngestError } from "../../domain/errors.js";

const IPV4_PRIVATE = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^198\.18\./,
  /^198\.19\./,
];

export function isBlockedIp(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (ip.includes(":")) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) {
      return isBlockedIp(mapped[1]);
    }
    return (
      ip === "::1" ||
      ip === "::" ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      ip.startsWith("fe80") ||
      ip.startsWith("ff")
    );
  }
  return IPV4_PRIVATE.some((pattern) => pattern.test(ip));
}

export function assertPublicResolvedAddresses(
  hostname: string,
  addresses: readonly string[],
): void {
  if (isIP(hostname) && isBlockedIp(hostname)) {
    throw new IngestError("ssrf_blocked", `Blocked IP host ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new IngestError("ssrf_blocked", `Could not resolve ${hostname}`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new IngestError(
        "ssrf_blocked",
        `Host ${hostname} resolved to a private or local address`,
      );
    }
  }
}
