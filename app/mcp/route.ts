import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildMcpServerCard } from "@/lib/discovery";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";
import { handleMcpJsonRpc } from "@/lib/mcp-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(req: NextRequest) {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();

  if (accept.includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const sessionId = crypto.randomUUID();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`: ApexSEO GEO MCP Stream\n\n`));
        controller.enqueue(encoder.encode(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "mcp-session-id": sessionId,
      },
    });
  }

  // Plain browser/crawler GET /mcp MUST return 200 OK JSON Server Card per MCP Registry rules
  return NextResponse.json(buildMcpServerCard(req.nextUrl.origin), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "cache-control": "public, max-age=60",
    },
  });
}

export async function POST(req: NextRequest) {
  let rpcBody: unknown;
  try {
    rpcBody = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON payload" },
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const httpPaymentSignature =
    req.headers.get("payment-signature") ?? req.headers.get("x-payment");

  const rpcResponse = await handleMcpJsonRpc(rpcBody, {
    requestOrigin: req.nextUrl.origin,
    httpPaymentSignature,
    enforcePayment: true,
  });

  if (rpcResponse === null) {
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }

  const sessionId = req.headers.get("mcp-session-id") ?? crypto.randomUUID();
  return NextResponse.json(rpcResponse, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "mcp-session-id": sessionId,
    },
  });
}
