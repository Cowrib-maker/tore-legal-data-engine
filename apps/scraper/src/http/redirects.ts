export const MAX_REDIRECTS = 5;

export class UnsafeRedirectError extends Error {
  constructor(
    readonly url: string,
    readonly location: string | null,
    message?: string,
  ) {
    super(message ?? `Unsafe redirect from ${url} to ${location ?? "(missing Location)"}`);
    this.name = "UnsafeRedirectError";
  }
}

export function originHostname(baseUrl: string): string {
  return new URL(baseUrl).hostname.replace(/\.$/, "").toLowerCase();
}

export function allowedRedirectHost(hostname: string, originHost: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  const origin = originHost.replace(/\.$/, "").toLowerCase();
  return host === origin || host.endsWith(`.${origin}`);
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function resolveSafeRedirect(params: {
  fromUrl: string;
  location: string | null;
  originHostname: string;
}): string {
  if (!params.location?.trim()) {
    throw new UnsafeRedirectError(
      params.fromUrl,
      params.location,
      "redirect missing Location header",
    );
  }

  let next: URL;
  try {
    next = new URL(params.location, params.fromUrl);
  } catch {
    throw new UnsafeRedirectError(
      params.fromUrl,
      params.location,
      "redirect Location is not a valid URL",
    );
  }

  if (next.protocol !== "https:" && next.protocol !== "http:") {
    throw new UnsafeRedirectError(params.fromUrl, params.location);
  }
  if (!allowedRedirectHost(next.hostname, params.originHostname)) {
    throw new UnsafeRedirectError(params.fromUrl, params.location);
  }

  next.hash = "";
  return next.toString();
}
