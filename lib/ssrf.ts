import dns from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export class TargetFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TargetFetchError";
    this.status = status;
  }
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  ttfbMs: number;
  totalMs: number;
  headers: Record<string, string>;
  redirectChain: RedirectHop[];
  bodyText: string;
  byteLength: number;
  truncated: boolean;
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type RawFetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  acceptHeader?: string;
  userAgent?: string;
  lookupFn?: LookupFn;
  fetchFn?: RawFetchFn;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB safety ceiling per live page fetch
const DEFAULT_UA = "ApexSEO-GEO-Audit/0.1 (+https://kwizzlesurp.com; MCP/x402)";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".arpa", ".home.arpa"];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 0;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidrV4(ip: string, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],       // Current network / unspecified
  ["10.0.0.0", 8],      // RFC1918
  ["100.64.0.0", 10],   // Carrier-grade NAT (RFC6598)
  ["127.0.0.0", 8],     // Loopback
  ["169.254.0.0", 16],  // Link-local / Cloud IMDS
  ["172.16.0.0", 12],   // RFC1918
  ["192.0.0.0", 24],    // IETF protocol assignments
  ["192.0.2.0", 24],    // TEST-NET-1
  ["192.88.99.0", 24],  // Deprecated 6to4 relay
  ["192.168.0.0", 16],  // RFC1918
  ["198.18.0.0", 15],   // Benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24],  // TEST-NET-3
  ["224.0.0.0", 4],     // Multicast
  ["240.0.0.0", 4],     // Reserved / Broadcast
];

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const ipVersion = net.isIP(cleaned);
  if (ipVersion === 0) return true;

  if (ipVersion === 4) {
    return PRIVATE_V4_RANGES.some(([base, bits]) => inCidrV4(cleaned, base, bits));
  }

  // IPv6 checks: unspecified, loopback, link-local fe80::/10, ULA fc00::/7, multicast ff00::/8
  if (cleaned === "::" || cleaned === "::1") return true;
  if (cleaned.startsWith("fe8") || cleaned.startsWith("fe9") || cleaned.startsWith("fea") || cleaned.startsWith("feb")) {
    return true;
  }
  if (cleaned.startsWith("fc") || cleaned.startsWith("fd") || cleaned.startsWith("ff")) {
    return true;
  }

  // IPv4-mapped IPv6 e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1
  const v4MappedDotted = cleaned.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedDotted) {
    return isPrivateOrReservedIp(v4MappedDotted[1]);
  }
  const v4MappedHex = cleaned.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const hi = Number.parseInt(v4MappedHex[1], 16);
    const lo = Number.parseInt(v4MappedHex[2], 16);
    const reconstructed = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateOrReservedIp(reconstructed);
  }

  return false;
}

const defaultLookup: LookupFn = async (hostname) => {
  return dns.lookup(hostname, { all: true });
};

export async function validatePublicHttpUrl(
  rawUrl: string,
  lookupFn: LookupFn = defaultLookup
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SsrfBlockedError(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported protocol "${parsed.protocol}". Only http/https allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError("URLs containing embedded credentials are blocked.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new SsrfBlockedError("URL hostname is empty.");
  }
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new SsrfBlockedError(`Hostname "${hostname}" is blocked by SSRF policy.`);
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfBlockedError(`Target IP "${hostname}" falls in a private or reserved range.`);
    }
    return parsed;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookupFn(hostname);
  } catch (err) {
    throw new SsrfBlockedError(
      `DNS lookup failed for "${hostname}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!resolved.length) {
    throw new SsrfBlockedError(`DNS returned no records for "${hostname}".`);
  }

  for (const rec of resolved) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new SsrfBlockedError(
        `Resolved IP "${rec.address}" for "${hostname}" is private or reserved.`
      );
    }
  }

  return parsed;
}

async function readLimitedText(res: Response, maxBytes: number): Promise<{
  text: string;
  byteLength: number;
  truncated: boolean;
}> {
  if (!res.body) {
    const fallbackText = await res.text();
    const buf = Buffer.from(fallbackText, "utf8");
    if (buf.byteLength <= maxBytes) {
      return { text: fallbackText, byteLength: buf.byteLength, truncated: false };
    }
    return {
      text: buf.subarray(0, maxBytes).toString("utf8"),
      byteLength: maxBytes,
      truncated: true,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks, total).toString("utf8"),
    byteLength: total,
    truncated,
  };
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((val, key) => {
    out[key.toLowerCase()] = val;
  });
  return out;
}

export async function safeFetchUrl(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookupFn = options.lookupFn ?? defaultLookup;
  const fetchFn: RawFetchFn = options.fetchFn ?? fetch;

  let currentUrl = (await validatePublicHttpUrl(rawUrl, lookupFn)).toString();
  const redirectChain: RedirectHop[] = [];
  const overallStart = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const hopStart = Date.now();
    const response = await fetchFn(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": options.userAgent ?? DEFAULT_UA,
        accept:
          options.acceptHeader ??
          "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const ttfbMs = Date.now() - hopStart;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        if (hop === maxRedirects) {
          throw new TargetFetchError(`Exceeded maximum ${maxRedirects} redirects from ${rawUrl}`, 310);
        }
        redirectChain.push({ url: currentUrl, status: response.status });
        const nextResolved = new URL(location, currentUrl).toString();
        await validatePublicHttpUrl(nextResolved, lookupFn);
        currentUrl = nextResolved;
        continue;
      }
    }

    const { text, byteLength, truncated } = await readLimitedText(response, maxBytes);
    const totalMs = Date.now() - overallStart;

    return {
      requestedUrl: rawUrl,
      finalUrl: currentUrl,
      status: response.status,
      ok: response.ok,
      ttfbMs,
      totalMs,
      headers: normalizeHeaders(response.headers),
      redirectChain,
      bodyText: text,
      byteLength,
      truncated,
    };
  }

  throw new TargetFetchError(`Redirect loop detected for ${rawUrl}`);
}
