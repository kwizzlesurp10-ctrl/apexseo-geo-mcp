import { GEO_TOOL_CATALOG, type GeoToolSpec } from "../lib/catalog";
import {
  BASE_MAINNET_NETWORK,
  BASE_MAINNET_USDC,
  CANONICAL_PAY_TO,
  X402_TRUST_VERIFICATION,
} from "../lib/env";
import type { EndpointCheckResult } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface TimedFetchResult {
  ok: boolean;
  status: number | null;
  headers: Headers;
  text: string;
  latencyMs: number;
  error?: string;
}

/** Execute an HTTP request with bounded timeout and wall-clock latency capture. */
export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<TimedFetchResult> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const latencyMs = Math.max(1, Math.round(performance.now() - t0));
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      text,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Math.round(performance.now() - t0));
    return {
      ok: false,
      status: null,
      headers: new Headers(),
      text: "",
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DecodedPaymentHeader {
  x402Version?: number;
  accepts?: Array<{
    scheme?: string;
    network?: string;
    amount?: string;
    asset?: string;
    payTo?: string;
  }>;
}

/** Decode base64 JSON `payment-required` x402 v2 header safely. */
export function decodePaymentRequiredHeader(raw: string | null): DecodedPaymentHeader | null {
  if (!raw?.trim()) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const jsonText = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(jsonText) as DecodedPaymentHeader;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Validate x402 payment header fields against canonical ApexSEO Base USDC requirements. */
export function verifyX402Parity(
  headerValue: string | null,
  bodyText: string,
  expectedAmountAtomic: string
): {
  parityOk: boolean;
  detail: string;
  payTo?: string;
  amountAtomic?: string;
  network?: string;
  asset?: string;
} {
  let decoded = decodePaymentRequiredHeader(headerValue);
  if (!decoded && bodyText.trim()) {
    try {
      decoded = JSON.parse(bodyText) as DecodedPaymentHeader;
    } catch {
      decoded = null;
    }
  }
  const accept = decoded?.accepts?.[0];
  if (!decoded || !accept) {
    return { parityOk: false, detail: "missing or invalid PAYMENT-REQUIRED payload" };
  }

  const payTo = accept.payTo ?? "";
  const network = accept.network ?? "";
  const asset = accept.asset ?? "";
  const amountAtomic = accept.amount ?? "";

  const mismatches: string[] = [];
  if (decoded.x402Version !== 2) mismatches.push(`version=${String(decoded.x402Version)}`);
  if (payTo.toLowerCase() !== CANONICAL_PAY_TO.toLowerCase()) mismatches.push(`payTo=${payTo}`);
  if (network !== BASE_MAINNET_NETWORK) mismatches.push(`network=${network}`);
  if (asset.toLowerCase() !== BASE_MAINNET_USDC.toLowerCase()) mismatches.push(`asset=${asset}`);
  if (amountAtomic !== expectedAmountAtomic) {
    mismatches.push(`amount=${amountAtomic}!=${expectedAmountAtomic}`);
  }

  return {
    parityOk: mismatches.length === 0,
    detail:
      mismatches.length === 0
        ? `402 parity OK (${amountAtomic} atomic, payTo ${payTo.slice(0, 6)}..${payTo.slice(-4)})`
        : `parity drift: ${mismatches.join(", ")}`,
    payTo,
    amountAtomic,
    network,
    asset,
  };
}

/** Compute integer P50 and P95 latencies from probe results. */
export function computeLatencyPercentiles(latencies: number[]): { p50: number; p95: number } {
  const clean = latencies.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (clean.length === 0) return { p50: 0, p95: 0 };
  const at = (q: number) => {
    const idx = Math.min(clean.length - 1, Math.max(0, Math.ceil(q * clean.length) - 1));
    return Math.round(clean[idx]);
  };
  return { p50: at(0.5), p95: at(0.95) };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function probeGetJsonCheck(
  id: string,
  label: string,
  category: EndpointCheckResult["category"],
  url: string,
  validate: (json: Record<string, unknown> | null, res: TimedFetchResult) => { ok: boolean; detail: string }
): Promise<EndpointCheckResult> {
  const res = await timedFetch(url, { method: "GET", headers: { accept: "application/json,*/*" } });
  const checkedAt = new Date().toISOString();
  if (res.error || res.status === null) {
    return {
      id,
      label,
      category,
      url,
      method: "GET",
      expectedStatus: 200,
      actualStatus: null,
      latencyMs: res.latencyMs,
      ok: false,
      detail: res.error ?? "network failure",
      checkedAt,
    };
  }
  const parsed = safeJson(res.text);
  const verdict = validate(parsed, res);
  return {
    id,
    label,
    category,
    url,
    method: "GET",
    expectedStatus: 200,
    actualStatus: res.status,
    latencyMs: res.latencyMs,
    ok: res.status === 200 && verdict.ok,
    detail: res.status === 200 ? verdict.detail : `HTTP ${res.status}`,
    checkedAt,
  };
}

async function probePaidX402Tool(baseUrl: string, tool: GeoToolSpec): Promise<EndpointCheckResult> {
  const url = `${baseUrl}${tool.routePath}`;
  const res = await timedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({}),
  });
  const checkedAt = new Date().toISOString();
  if (res.error || res.status === null) {
    return {
      id: `x402:${tool.name}`,
      label: `${tool.name} (${tool.priceUsd})`,
      category: "x402",
      url,
      method: "POST",
      expectedStatus: 402,
      actualStatus: null,
      latencyMs: res.latencyMs,
      ok: false,
      paymentParityOk: false,
      detail: res.error ?? "network error",
      checkedAt,
    };
  }

  const parity = verifyX402Parity(
    res.headers.get("payment-required"),
    res.text,
    tool.amountAtomic
  );
  return {
    id: `x402:${tool.name}`,
    label: `${tool.name} (${tool.priceUsd})`,
    category: "x402",
    url,
    method: "POST",
    expectedStatus: 402,
    actualStatus: res.status,
    latencyMs: res.latencyMs,
    ok: res.status === 402 && parity.parityOk,
    paymentParityOk: parity.parityOk,
    payTo: parity.payTo,
    amountAtomic: parity.amountAtomic,
    network: parity.network,
    asset: parity.asset,
    detail: res.status === 402 ? parity.detail : `expected 402, got ${res.status}`,
    checkedAt,
  };
}

async function probeMcpRpc(
  id: string,
  label: string,
  url: string,
  rpcBody: Record<string, unknown>,
  validate: (json: Record<string, unknown> | null) => { ok: boolean; detail: string }
): Promise<EndpointCheckResult> {
  const res = await timedFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(rpcBody),
  });
  const checkedAt = new Date().toISOString();
  const parsed = safeJson(res.text);
  const verdict = validate(parsed);
  return {
    id,
    label,
    category: "mcp",
    url,
    method: "POST",
    expectedStatus: 200,
    actualStatus: res.status,
    latencyMs: res.latencyMs,
    ok: res.status === 200 && verdict.ok,
    detail: res.error ?? (res.status === 200 ? verdict.detail : `HTTP ${res.status}`),
    checkedAt,
  };
}

/** Run the complete live HTTP, Discovery, MCP JSON-RPC, and x402 parity probe suite. */
export async function probeAllEndpoints(rawBaseUrl: string): Promise<EndpointCheckResult[]> {
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const mcpUrl = `${baseUrl}/mcp`;
  const paidTools = GEO_TOOL_CATALOG.filter((tool) => !tool.isFree);

  const checks: Array<Promise<EndpointCheckResult>> = [
    probeGetJsonCheck("api:health", "GET /api/health", "api", `${baseUrl}/api/health`, (json) => {
      const ok = json?.ok === true;
      const payTo = String(json?.payTo ?? "");
      const payOk = payTo.toLowerCase() === CANONICAL_PAY_TO.toLowerCase();
      const networkOk = json?.network === BASE_MAINNET_NETWORK;
      const authReady = json?.facilitatorAuthConfigured === true;
      return {
        ok: ok && payOk && networkOk,
        detail:
          ok && payOk && networkOk
            ? `v${String(json?.version ?? "?")} ok=true cdpAuth=${authReady} payTo=${payTo.slice(0, 6)}..${payTo.slice(-4)}`
            : `health mismatch (ok=${String(ok)}, payTo=${payTo}, net=${String(json?.network)})`,
      };
    }),
    probeGetJsonCheck("api:pricing", "GET /api/pricing", "api", `${baseUrl}/api/pricing`, (json) => {
      const endpoints = Array.isArray(json?.endpoints) ? json.endpoints.length : 0;
      const payTo = String(json?.payTo ?? "");
      const payOk = payTo.toLowerCase() === CANONICAL_PAY_TO.toLowerCase();
      return {
        ok: endpoints === GEO_TOOL_CATALOG.length && payOk,
        detail: `${endpoints}/${GEO_TOOL_CATALOG.length} catalog endpoints advertised`,
      };
    }),
    probeGetJsonCheck("disc:x402", "GET /.well-known/x402", "discovery", `${baseUrl}/.well-known/x402`, (json) => {
      const resources = Array.isArray(json?.resources) ? json.resources.length : 0;
      const payTo = String((json?.payment as Record<string, unknown> | undefined)?.payTo ?? "");
      const ok = resources === GEO_TOOL_CATALOG.length && payTo.toLowerCase() === CANONICAL_PAY_TO.toLowerCase();
      return { ok, detail: `${resources} resources declared` };
    }),
    probeGetJsonCheck(
      "disc:x402-trust",
      "GET /.well-known/x402-trust.txt",
      "discovery",
      `${baseUrl}/.well-known/x402-trust.txt`,
      (_json, res) => {
        const match = res.text.trim() === X402_TRUST_VERIFICATION;
        return {
          ok: match,
          detail: match ? "P-256 verification proof intact" : "x402-trust.txt proof mismatch",
        };
      }
    ),
    probeGetJsonCheck("disc:openapi", "GET /openapi.json", "discovery", `${baseUrl}/openapi.json`, (json) => {
      const paths = json?.paths && typeof json.paths === "object" ? Object.keys(json.paths).length : 0;
      return { ok: paths >= GEO_TOOL_CATALOG.length, detail: `${paths} OpenAPI paths` };
    }),
    probeGetJsonCheck("disc:llms", "GET /llms.txt", "discovery", `${baseUrl}/llms.txt`, (_json, res) => {
      const ok = res.text.includes("ApexSEO") && res.text.length > 100;
      return { ok, detail: `${res.text.length} bytes` };
    }),
    probeGetJsonCheck(
      "disc:agent-card",
      "GET /.well-known/agent-card.json",
      "discovery",
      `${baseUrl}/.well-known/agent-card.json`,
      (json) => ({
        ok: Boolean(json?.name),
        detail: json?.name ? String(json.name) : "missing name",
      })
    ),
    probeGetJsonCheck("mcp:get", "GET /mcp (Browser Card)", "mcp", mcpUrl, (json) => ({
      ok: Boolean(json?.name || json?.serverInfo),
      detail: "200 JSON Server Card",
    })),
    probeMcpRpc(
      "mcp:initialize",
      "MCP initialize",
      mcpUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "apexseo-monitor", version: "0.1.1" },
        },
      },
      (json) => {
        const res = json?.result as Record<string, unknown> | undefined;
        const version = String(res?.protocolVersion ?? "");
        return {
          ok: Boolean(version),
          detail: version ? `protocol ${version}` : "missing protocolVersion",
        };
      }
    ),
    probeMcpRpc(
      "mcp:tools-list",
      "MCP tools/list",
      mcpUrl,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      (json) => {
        const tools = (json?.result as { tools?: unknown[] } | undefined)?.tools;
        const count = Array.isArray(tools) ? tools.length : 0;
        return {
          ok: count === GEO_TOOL_CATALOG.length,
          detail: `${count} tools exposed`,
        };
      }
    ),
    probeMcpRpc(
      "mcp:unpaid-gate",
      "MCP unpaid x402 gate",
      mcpUrl,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ai_crawler_audit", arguments: { url: "https://example.com" } },
      },
      (json) => {
        const result = json?.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
        const text = result?.content?.[0]?.text ?? "";
        const gated = result?.isError === true && text.includes("10000");
        return {
          ok: gated,
          detail: gated ? "isError=true x402 challenge (10000)" : "unpaid call did not return x402 error",
        };
      }
    ),
    ...paidTools.map((tool) => probePaidX402Tool(baseUrl, tool)),
  ];

  return Promise.all(checks);
}
