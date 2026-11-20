import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { signCdpJwt } from "./cdp-jwt";
import type { GeoToolSpec } from "./catalog";
import { getPaymentConfig, type PaymentConfig } from "./env";

export type FacilitatorFetchFn = typeof fetch;

export interface PaymentVerificationContext {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  config: PaymentConfig;
  facilitatorFetch: FacilitatorFetchFn;
}

export type PaymentCheckResult =
  | {
      status: "free";
    }
  | {
      status: "verified";
      context: PaymentVerificationContext;
    }
  | {
      status: "rejected";
      httpStatus: 402;
      reason: string;
      challenge: PaymentRequired;
      encodedHeader: string;
    };

export function buildPaymentRequiredChallenge(params: {
  tool: GeoToolSpec;
  requestUrl: string;
  mode: "http" | "mcp";
  error?: string;
  requestOrigin?: string;
}): PaymentRequired {
  const { tool, requestUrl, mode, error, requestOrigin } = params;
  const cfg = getPaymentConfig(requestOrigin);

  const extensions =
    mode === "mcp"
      ? declareDiscoveryExtension({
          toolName: tool.name,
          description: tool.description,
          transport: "streamable-http",
          inputSchema: tool.inputJsonSchema,
          example: tool.exampleInput,
          output: { schema: tool.outputJsonSchema },
        })
      : declareDiscoveryExtension(
          tool.method === "GET"
            ? {
                input: tool.exampleInput,
                inputSchema: tool.inputJsonSchema,
                output: { schema: tool.outputJsonSchema },
              }
            : {
                bodyType: "json",
                input: tool.exampleInput,
                inputSchema: tool.inputJsonSchema,
                output: { schema: tool.outputJsonSchema },
              }
        );

  const bazaarExt = (
    extensions as unknown as Record<string, { info?: { input?: Record<string, unknown> } }>
  ).bazaar;
  if (mode === "http" && bazaarExt?.info?.input) {
    bazaarExt.info.input.method = tool.method;
  }

  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: requestUrl,
      description: `${tool.title} — ${tool.priceUsd} USDC on Base Mainnet`,
      mimeType: "application/json",
      serviceName: "ApexSEO GEO Audit MCP",
      tags: ["seo", "geo", "ai-crawlers", "schema", "x402"],
    },
    accepts: [
      {
        scheme: "exact",
        network: cfg.network,
        amount: tool.amountAtomic,
        asset: cfg.usdcAsset,
        payTo: cfg.payTo,
        maxTimeoutSeconds: 300,
        extra: {
          name: "USD Coin",
          version: "2",
        },
      },
    ],
    extensions,
  };
}

function buildChallengeRejection(params: {
  tool: GeoToolSpec;
  requestUrl: string;
  mode: "http" | "mcp";
  reason: string;
  requestOrigin?: string;
}): Extract<PaymentCheckResult, { status: "rejected" }> {
  const challenge = buildPaymentRequiredChallenge({
    tool: params.tool,
    requestUrl: params.requestUrl,
    mode: params.mode,
    error: params.reason,
    requestOrigin: params.requestOrigin,
  });

  return {
    status: "rejected",
    httpStatus: 402,
    reason: params.reason,
    challenge,
    encodedHeader: encodePaymentRequiredHeader(challenge),
  };
}

async function callFacilitatorEndpoint<TResponse>(params: {
  config: PaymentConfig;
  endpoint: "verify" | "settle";
  payload: Record<string, unknown>;
  facilitatorFetch: FacilitatorFetchFn;
}): Promise<{ ok: boolean; status: number; json?: TResponse; errorText?: string }> {
  const url = `${params.config.facilitatorUrl}/${params.endpoint}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (params.config.cdpApiKeyId && params.config.cdpApiKeySecret) {
    const jwt = signCdpJwt({
      keyId: params.config.cdpApiKeyId,
      keySecret: params.config.cdpApiKeySecret,
      requestMethod: "POST",
      requestUrl: url,
    });
    headers.authorization = `Bearer ${jwt}`;
  }

  const res = await params.facilitatorFetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify(params.payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      errorText: text || `Facilitator /${params.endpoint} HTTP ${res.status}`,
    };
  }

  const json = (await res.json()) as TResponse;
  return { ok: true, status: res.status, json };
}

function parseIncomingPayment(params: {
  paymentSignatureHeader?: string | null;
  mcpPaymentMeta?: unknown;
}): { payload?: PaymentPayload; error?: string } {
  if (params.paymentSignatureHeader && params.paymentSignatureHeader.trim()) {
    try {
      const decoded = decodePaymentSignatureHeader(params.paymentSignatureHeader.trim());
      return { payload: decoded };
    } catch {
      return { error: "Invalid base64 PAYMENT-SIGNATURE header" };
    }
  }

  if (params.mcpPaymentMeta && typeof params.mcpPaymentMeta === "object") {
    const candidate = params.mcpPaymentMeta as Partial<PaymentPayload>;
    if (candidate.x402Version === 2 && candidate.accepted && candidate.payload) {
      return { payload: candidate as PaymentPayload };
    }
    return { error: "Invalid _meta['x402/payment'] payload structure" };
  }

  return {};
}

function validatePayloadMatchesRequirements(
  payload: PaymentPayload,
  expected: PaymentRequirements
): string | null {
  if (payload.x402Version !== 2) {
    return "Only x402Version 2 payments are supported.";
  }
  const acc = payload.accepted;
  if (!acc) return "Missing accepted payment terms in payload.";
  if (acc.scheme !== expected.scheme) {
    return `Scheme mismatch: expected ${expected.scheme}, got ${acc.scheme}`;
  }
  if (acc.network !== expected.network) {
    return `Network mismatch: expected ${expected.network}, got ${acc.network}`;
  }
  if (acc.payTo.toLowerCase() !== expected.payTo.toLowerCase()) {
    return `payTo mismatch: expected ${expected.payTo}, got ${acc.payTo}`;
  }
  if (acc.asset.toLowerCase() !== expected.asset.toLowerCase()) {
    return `Asset mismatch: expected ${expected.asset}, got ${acc.asset}`;
  }
  try {
    if (BigInt(acc.amount) < BigInt(expected.amount)) {
      return `Insufficient amount: required ${expected.amount}, got ${acc.amount}`;
    }
  } catch {
    return "Malformed payment amount.";
  }
  return null;
}

export async function verifyPaymentBeforeExecution(params: {
  tool: GeoToolSpec;
  requestUrl: string;
  mode: "http" | "mcp";
  paymentSignatureHeader?: string | null;
  mcpPaymentMeta?: unknown;
  requestOrigin?: string;
  facilitatorFetch?: FacilitatorFetchFn;
}): Promise<PaymentCheckResult> {
  const { tool, requestUrl, mode, requestOrigin } = params;
  if (tool.isFree) {
    return { status: "free" };
  }

  const config = getPaymentConfig(requestOrigin);
  const { payload, error: parseErr } = parseIncomingPayment({
    paymentSignatureHeader: params.paymentSignatureHeader,
    mcpPaymentMeta: params.mcpPaymentMeta,
  });

  if (parseErr) {
    return buildChallengeRejection({ tool, requestUrl, mode, reason: parseErr, requestOrigin });
  }

  if (!payload) {
    return buildChallengeRejection({
      tool,
      requestUrl,
      mode,
      reason: `Payment required: ${tool.priceUsd} USDC on ${config.network}`,
      requestOrigin,
    });
  }

  // Fail closed when facilitator credentials are missing on production CDP URL
  const usesCoinbaseCdp = config.facilitatorUrl.includes("api.cdp.coinbase.com");
  if (usesCoinbaseCdp && !config.hasCdpAuth) {
    return buildChallengeRejection({
      tool,
      requestUrl,
      mode,
      reason: "FACILITATOR_AUTH_REQUIRED: CDP API credentials not configured on server.",
      requestOrigin,
    });
  }

  const challenge = buildPaymentRequiredChallenge({
    tool,
    requestUrl,
    mode,
    requestOrigin,
  });
  const paymentRequirements = challenge.accepts[0];

  const termsError = validatePayloadMatchesRequirements(payload, paymentRequirements);
  if (termsError) {
    return buildChallengeRejection({ tool, requestUrl, mode, reason: termsError, requestOrigin });
  }

  // Backfill discovery metadata so Coinbase Bazaar indexes both resource & extension schemas
  const enrichedPayload: PaymentPayload = {
    ...payload,
    resource: payload.resource ?? challenge.resource,
    extensions: payload.extensions ?? challenge.extensions,
  };

  const facilitatorFetch = params.facilitatorFetch ?? fetch;
  try {
    const verifyRes = await callFacilitatorEndpoint<{
      isValid?: boolean;
      invalidReason?: string;
      payer?: string;
    }>({
      config,
      endpoint: "verify",
      payload: {
        x402Version: 2,
        paymentPayload: enrichedPayload,
        paymentRequirements,
      },
      facilitatorFetch,
    });

    if (!verifyRes.ok || !verifyRes.json?.isValid) {
      return buildChallengeRejection({
        tool,
        requestUrl,
        mode,
        reason:
          verifyRes.json?.invalidReason ||
          verifyRes.errorText ||
          "x402 payment verification failed",
        requestOrigin,
      });
    }
  } catch (err) {
    return buildChallengeRejection({
      tool,
      requestUrl,
      mode,
      reason: `Facilitator verify unavailable: ${err instanceof Error ? err.message : String(err)}`,
      requestOrigin,
    });
  }

  return {
    status: "verified",
    context: {
      paymentPayload: enrichedPayload,
      paymentRequirements,
      config,
      facilitatorFetch,
    },
  };
}

export async function settleVerifiedPayment(
  ctx: PaymentVerificationContext
): Promise<
  | { settled: true; settleResponse: SettleResponse; encodedHeader: string }
  | { settled: false; reason: string }
> {
  try {
    const res = await callFacilitatorEndpoint<SettleResponse>({
      config: ctx.config,
      endpoint: "settle",
      payload: {
        x402Version: 2,
        paymentPayload: ctx.paymentPayload,
        paymentRequirements: ctx.paymentRequirements,
      },
      facilitatorFetch: ctx.facilitatorFetch,
    });

    if (!res.ok || !res.json?.success) {
      return {
        settled: false,
        reason: res.json?.errorReason || res.errorText || "x402 payment settlement failed",
      };
    }

    return {
      settled: true,
      settleResponse: res.json,
      encodedHeader: encodePaymentResponseHeader(res.json),
    };
  } catch (err) {
    return {
      settled: false,
      reason: `Facilitator settle unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
