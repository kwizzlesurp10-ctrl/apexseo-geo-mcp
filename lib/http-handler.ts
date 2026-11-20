import { NextRequest, NextResponse } from "next/server";
import type { GeoToolSpec } from "./catalog";
import { resolvePublicBaseUrl } from "./env";
import {
  buildPaymentRequiredChallenge,
  settleVerifiedPayment,
  verifyPaymentBeforeExecution,
  type FacilitatorFetchFn,
} from "./payment";
import { recordToolAnalytics } from "./redis";
import { SsrfBlockedError, TargetFetchError } from "./ssrf";
import { encodePaymentRequiredHeader } from "@x402/core/http";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Authorization, PAYMENT-SIGNATURE, X-PAYMENT, Mcp-Session-Id",
  "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
};

export function corsOptionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function handleToolHttpRequest(
  req: NextRequest,
  tool: GeoToolSpec,
  options?: { facilitatorFetch?: FacilitatorFetchFn }
): Promise<NextResponse> {
  const origin = req.nextUrl?.origin || undefined;
  const publicBase = resolvePublicBaseUrl(origin);
  const resourceUrl = `${publicBase}${tool.routePath}`;
  const sigHeader = req.headers.get("payment-signature") ?? req.headers.get("x-payment");

  // 1. Return 402 PAYMENT-REQUIRED challenge immediately on unpaid probes (GET, empty POST, {} body)
  // so x402 scanners (x402-trust, x402scan, AgentCash) always receive payment terms cleanly.
  if (!tool.isFree && !sigHeader?.trim()) {
    recordToolAnalytics({ tool: tool.name, isFree: false, status: "402_probe" });
    const unpaid = await verifyPaymentBeforeExecution({
      tool,
      requestUrl: resourceUrl,
      mode: "http",
      paymentSignatureHeader: null,
      requestOrigin: origin,
      facilitatorFetch: options?.facilitatorFetch,
    });
    if (unpaid.status === "rejected") {
      return NextResponse.json(unpaid.challenge, {
        status: 402,
        headers: {
          ...CORS_HEADERS,
          "cache-control": "private, no-store",
          "payment-required": unpaid.encodedHeader,
        },
      });
    }
  }

  // 2. For GET requests on POST-only paid tools (with a stray header), return 402 challenge or 405
  if (req.method === "GET" && tool.method === "POST") {
    const challenge = buildPaymentRequiredChallenge({
      tool,
      requestUrl: resourceUrl,
      mode: "http",
      error: `Use POST ${tool.routePath} with JSON body and PAYMENT-SIGNATURE header.`,
      requestOrigin: origin,
    });
    return NextResponse.json(challenge, {
      status: 402,
      headers: {
        ...CORS_HEADERS,
        "cache-control": "private, no-store",
        "payment-required": encodePaymentRequiredHeader(challenge),
      },
    });
  }

  // 3. Parse and validate request parameters BEFORE verify/settle so bad input never spends USDC
  let rawBody: unknown = {};
  if (tool.method === "POST") {
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400, headers: CORS_HEADERS }
      );
    }
  } else {
    rawBody = Object.fromEntries(req.nextUrl.searchParams.entries());
  }

  const parsed = tool.zodSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request parameters.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // 4. Verify x402 payment signature with facilitator before executing expensive live audit
  const check = await verifyPaymentBeforeExecution({
    tool,
    requestUrl: resourceUrl,
    mode: "http",
    paymentSignatureHeader: sigHeader,
    requestOrigin: origin,
    facilitatorFetch: options?.facilitatorFetch,
  });

  if (check.status === "rejected") {
    return NextResponse.json(check.challenge, {
      status: 402,
      headers: {
        ...CORS_HEADERS,
        "cache-control": "private, no-store",
        "payment-required": check.encodedHeader,
      },
    });
  }

  // 5. Execute audit cleanly; surface SSRF or upstream errors BEFORE settlement
  let output: unknown;
  try {
    output = await tool.execute(parsed.data, origin);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json(
        { error: err.message, code: "SSRF_BLOCKED" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (err instanceof TargetFetchError) {
      return NextResponse.json(
        { error: err.message, code: "UPSTREAM_FETCH_ERROR" },
        { status: 502, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Audit execution failed",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // 6. Settle verified payment and attach PAYMENT-RESPONSE header
  const responseHeaders: Record<string, string> = { ...CORS_HEADERS };
  if (check.status === "verified") {
    const settlement = await settleVerifiedPayment(check.context);
    if (!settlement.settled) {
      recordToolAnalytics({
        tool: tool.name,
        isFree: false,
        status: "settlement_error",
        amountAtomic: tool.amountAtomic,
      });
      const challenge = buildPaymentRequiredChallenge({
        tool,
        requestUrl: resourceUrl,
        mode: "http",
        error: settlement.reason,
        requestOrigin: origin,
      });
      return NextResponse.json(challenge, {
        status: 402,
        headers: {
          ...CORS_HEADERS,
          "cache-control": "private, no-store",
          "payment-required": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    responseHeaders["payment-response"] = settlement.encodedHeader;
    recordToolAnalytics({
      tool: tool.name,
      isFree: false,
      status: "success",
      amountAtomic: tool.amountAtomic,
      payer: (settlement.settleResponse as { payer?: string })?.payer,
      txHash: (settlement.settleResponse as { transaction?: string })?.transaction,
    });
  } else if (tool.isFree) {
    recordToolAnalytics({
      tool: tool.name,
      isFree: true,
      status: "success",
    });
  }

  return NextResponse.json(output, {
    status: 200,
    headers: responseHeaders,
  });
}
