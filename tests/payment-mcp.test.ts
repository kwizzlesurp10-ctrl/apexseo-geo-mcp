import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { POST as auditPageRoute, GET as auditPageGetRoute } from "@/app/api/audit/page/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as pricingRoute } from "@/app/api/pricing/route";
import { GET as mcpGetRoute, POST as mcpPostRoute } from "@/app/mcp/route";
import { findGeoTool } from "@/lib/catalog";
import { CANONICAL_PAY_TO } from "@/lib/env";
import { handleToolHttpRequest } from "@/lib/http-handler";
import { handleMcpJsonRpc } from "@/lib/mcp-core";

function createTestPaymentHeader(overrides: Partial<PaymentPayload> = {}): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: {
      url: "https://apexseo-geo-mcp.vercel.app/api/audit/page",
    },
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "20000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: CANONICAL_PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    },
    payload: {
      signature: "0xdeadbeef",
      authorization: { from: "0x1111111111111111111111111111111111111111" },
    },
    ...overrides,
  };
  return encodePaymentSignatureHeader(payload);
}

describe("HTTP x402 Enforcement & Streamable MCP Server", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.DEMO_ALLOW_PUBLIC;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
  });

  it("serves free /api/health and /api/pricing with 200 OK", async () => {
    const healthRes = await healthRoute(new NextRequest("http://localhost:3000/api/health"));
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.ok).toBe(true);
    expect(healthJson.payTo).toBe(CANONICAL_PAY_TO);

    const pricingRes = await pricingRoute(new NextRequest("http://localhost:3000/api/pricing"));
    expect(pricingRes.status).toBe(200);
    const pricingJson = await pricingRes.json();
    expect(pricingJson.endpoints).toHaveLength(6);
  });

  it("enforces HTTP 402 + PAYMENT-REQUIRED V2 Bazaar challenge on unpaid calls", async () => {
    const req = new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const res = await auditPageRoute(req);
    expect(res.status).toBe(402);

    const encodedHeader = res.headers.get("payment-required");
    expect(encodedHeader).toBeTruthy();

    const decoded = decodePaymentRequiredHeader(encodedHeader!);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]?.payTo).toBe(CANONICAL_PAY_TO);
    expect(decoded.accepts[0]?.amount).toBe("20000");
    expect(decoded.extensions?.bazaar).toBeDefined();

    // Unpaid discovery probes (GET or POST empty {}) MUST still return 402 instead of 400/405
    const getProbe = await auditPageGetRoute(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page")
    );
    expect(getProbe.status).toBe(402);

    const emptyPostProbe = await auditPageRoute(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(emptyPostProbe.status).toBe(402);
  });

  it("fails closed when CDP facilitator credentials are absent on production Coinbase CDP URL", async () => {
    const sig = createTestPaymentHeader();
    const req = new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": sig,
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const res = await auditPageRoute(req);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toContain("FACILITATOR_AUTH_REQUIRED");
  });

  it("rejects mismatched payTo and settles strictly AFTER clean SSRF/execution via CDP JWT", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    const rawSeedBase64 = pkcs8.subarray(-32).toString("base64");

    process.env.CDP_API_KEY_ID = "organizations/test/apiKeys/test-key";
    process.env.CDP_API_KEY_SECRET = rawSeedBase64;
    process.env.PUBLIC_BASE_URL = "https://apexseo-geo-mcp.vercel.app";

    const pageTool = findGeoTool("geo_page_audit")!;

    // 1. Mismatched payTo must 402 without hitting facilitator
    const badPayToSig = createTestPaymentHeader({
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        amount: "20000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0x9999999999999999999999999999999999999999",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    });
    const facilitatorSpy = vi.fn();
    const badRes = await handleToolHttpRequest(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
        method: "POST",
        headers: { "content-type": "application/json", "payment-signature": badPayToSig },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
      pageTool,
      { facilitatorFetch: facilitatorSpy as unknown as typeof fetch }
    );
    expect(badRes.status).toBe(402);
    expect(facilitatorSpy).not.toHaveBeenCalled();

    // 2. SSRF target with valid verify NEVER settles payment!
    const validSig = createTestPaymentHeader();
    const calls: string[] = [];
    const mockFacilitator = async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      expect(String((init?.headers as Record<string, string>)?.authorization)).toMatch(/^Bearer /);
      if (String(url).endsWith("/verify")) {
        return new Response(JSON.stringify({ isValid: true, payer: "0x1111" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ success: true, transaction: "0xtxhash", network: "eip155:8453" }),
        { status: 200 }
      );
    };

    const ssrfRes = await handleToolHttpRequest(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
        method: "POST",
        headers: { "content-type": "application/json", "payment-signature": validSig },
        body: JSON.stringify({ url: "http://127.0.0.1:8080/secret" }),
      }),
      pageTool,
      { facilitatorFetch: mockFacilitator as unknown as typeof fetch }
    );
    expect(ssrfRes.status).toBe(400);
    expect(calls.some((c) => c.endsWith("/settle"))).toBe(false);

    // 3. Valid paid call verifies -> executes -> settles and sets PAYMENT-RESPONSE header
    const execSpy = vi
      .spyOn(pageTool, "execute")
      .mockResolvedValueOnce({ geoScore: 91, grade: "A" });
    calls.length = 0;

    const okRes = await handleToolHttpRequest(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/api/audit/page", {
        method: "POST",
        headers: { "content-type": "application/json", "payment-signature": validSig },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
      pageTool,
      { facilitatorFetch: mockFacilitator as unknown as typeof fetch }
    );
    expect(execSpy).toHaveBeenCalledOnce();
    expect(okRes.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/\/verify$/);
    expect(calls[1]).toMatch(/\/settle$/);

    const paymentResponseHeader = okRes.headers.get("payment-response");
    expect(paymentResponseHeader).toBeTruthy();
    expect(decodePaymentResponseHeader(paymentResponseHeader!).transaction).toBe("0xtxhash");
  });

  it("handles browser GET /mcp manifest, Streamable HTTP POST JSON-RPC, prompts & paid x402 MCP calls", async () => {
    // Plain browser GET /mcp -> 200 OK JSON Server Card
    const cardRes = await mcpGetRoute(new NextRequest("https://apexseo-geo-mcp.vercel.app/mcp"));
    expect(cardRes.status).toBe(200);
    const cardJson = await cardRes.json();
    expect(cardJson.transport).toBe("streamable-http");
    expect(cardJson.tools).toHaveLength(6);

    // SSE GET /mcp -> 200 text/event-stream
    const sseRes = await mcpGetRoute(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/mcp", {
        headers: { accept: "text/event-stream" },
      })
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

    // initialize & notifications/initialized
    const initRes = await mcpPostRoute(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      })
    );
    expect(initRes.status).toBe(200);
    const initJson = await initRes.json();
    expect(initJson.result.serverInfo.name).toBe("apexseo-geo-mcp");

    const notifRes = await mcpPostRoute(
      new NextRequest("https://apexseo-geo-mcp.vercel.app/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      })
    );
    expect(notifRes.status).toBe(202);

    // tools/list and prompts/get
    const toolsRpc = await handleMcpJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((toolsRpc as { result: { tools: unknown[] } }).result.tools).toHaveLength(6);

    const promptRpc = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: {
        name: "apexseo_elite_strategist",
        arguments: { targetUrl: "https://example.com", mode: "AI_OVERVIEW_OPTIMIZATION" },
      },
    });
    const promptText = (promptRpc as { result: { messages: Array<{ content: { text: string } }> } })
      .result.messages[0].content.text;
    expect(promptText).toContain("ApexSEO Elite v2026.6");
    expect(promptText).toContain("AI_OVERVIEW_OPTIMIZATION");

    // Free tool call envelope
    const freeCall = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "geo_health", arguments: {} },
    });
    const freeEnvelope = (freeCall as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
    expect(freeEnvelope.isError).toBeUndefined();
    expect(JSON.parse(freeEnvelope.content[0].text).ok).toBe(true);

    // Unpaid paid tool call (even with empty arguments {}) -> strict MCP isError: true + x402 structuredContent
    const unpaidCall = await handleMcpJsonRpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "ai_crawler_audit", arguments: {} },
    });
    const unpaidEnvelope = (
      unpaidCall as {
        result: {
          isError?: boolean;
          content: Array<{ text: string }>;
          structuredContent: { x402Version: number };
        };
      }
    ).result;
    expect(unpaidEnvelope.isError).toBe(true);
    expect(unpaidEnvelope.structuredContent.x402Version).toBe(2);
    expect(JSON.parse(unpaidEnvelope.content[0].text).x402Version).toBe(2);
  });
});
