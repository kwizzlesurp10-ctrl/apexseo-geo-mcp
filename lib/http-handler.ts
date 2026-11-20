import { NextRequest, NextResponse } from "next/server";
import type { GeoToolSpec } from "./catalog";
import { resolvePublicBaseUrl } from "./env";
import {
  buildPaymentRequiredChallenge,
  settleVerifiedPayment,
  verifyPaymentBeforeExecution,
  type FacilitatorFetchFn,
} from "./payment";
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

  // 1. Parse and validate request payload before checking/settling payment
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

  // 2. Enforce x402 payment before expensive upstream crawling
  const sigHeader = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
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

  // 3. Execute audit cleanly; surface SSRF or target fetch errors without settling payment
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

  // 4. Settle verified payment and attach PAYMENT-RESPONSE header
  const responseHeaders: Record<string, string> = { ...CORS_HEADERS };
  if (check.status === "verified") {
    const settlement = await settleVerifiedPayment(check.context);
    if (!settlement.settled) {
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
  }

  return NextResponse.json(output, {
    status: 200,
    headers: responseHeaders,
  });
}
