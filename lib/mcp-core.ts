import { findGeoTool, GEO_TOOL_CATALOG } from "./catalog";
import { wrapToolError, wrapToolResult } from "./envelope";
import { resolvePublicBaseUrl } from "./env";
import {
  buildPaymentRequiredChallenge,
  settleVerifiedPayment,
  verifyPaymentBeforeExecution,
  type FacilitatorFetchFn,
} from "./payment";
import { ACTIVATION_MODES, renderApexSeoPromptMessage, type ActivationMode } from "./prompt";
import { recordToolAnalytics } from "./redis";
import { SsrfBlockedError, TargetFetchError } from "./ssrf";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpDispatchOptions {
  requestOrigin?: string;
  httpPaymentSignature?: string | null;
  facilitatorFetch?: FacilitatorFetchFn;
  enforcePayment?: boolean;
}

const SUPPORTED_PROTOCOL_VERSION = "2025-03-26";

function errorRpc(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

export async function handleMcpJsonRpc(
  body: unknown,
  options: McpDispatchOptions = {}
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return errorRpc(null, -32600, "Invalid Request: empty JSON-RPC batch");
    }
    const results = await Promise.all(body.map((item) => handleSingleRpc(item, options)));
    const filtered = results.filter((r): r is JsonRpcResponse => r !== null);
    return filtered.length > 0 ? filtered : null;
  }

  return handleSingleRpc(body, options);
}

async function handleSingleRpc(
  raw: unknown,
  options: McpDispatchOptions
): Promise<JsonRpcResponse | null> {
  if (!raw || typeof raw !== "object") {
    return errorRpc(null, -32600, "Invalid Request");
  }

  const req = raw as Partial<JsonRpcRequest>;
  const id = req.id ?? null;
  const hasId = req.id !== undefined && req.id !== null;

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return errorRpc(id, -32600, "Invalid Request: jsonrpc='2.0' and string method required");
  }

  // Handle JSON-RPC notifications silently when no response id exists
  if (req.method.startsWith("notifications/")) {
    return hasId ? { jsonrpc: "2.0", id, result: {} } : null;
  }

  switch (req.method) {
    case "ping": {
      return { jsonrpc: "2.0", id, result: {} };
    }

    case "initialize": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: "apexseo-geo-mcp",
            title: "ApexSEO GEO & AI-Crawler Audit MCP",
            version: "0.1.1",
          },
          instructions:
            "Keyless live-site Technical SEO, AI-Crawler (robots.txt / llms.txt), GEO/AEO & JSON-LD citation auditor powered by ApexSEO Elite v2026.6. geo_health and geo_pricing are free; audit tools settle per-call in Base Mainnet (eip155:8453) USDC ($0.01-$0.05) via x402 v2.",
        },
      };
    }

    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: GEO_TOOL_CATALOG.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputJsonSchema,
            outputSchema: t.outputJsonSchema,
            annotations: t.annotations,
            _meta: {
              x402: {
                isFree: t.isFree,
                priceUsd: t.isFree ? "0" : t.priceUsd,
                amountAtomic: t.amountAtomic,
                network: "eip155:8453",
                currency: "USDC",
              },
            },
          })),
        },
      };
    }

    case "prompts/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [
            {
              name: "apexseo_elite_strategist",
              title: "ApexSEO Elite v2026.6 Strategist",
              description:
                "World-class 2026 Technical SEO, AI Overviews (GEO/AEO), E-E-A-T, and ICE roadmap strategist system prompt sourced from SwarmScribe.",
              arguments: [
                {
                  name: "targetUrl",
                  description: "Primary website or page URL to audit.",
                  required: false,
                },
                {
                  name: "mode",
                  description: `Activation mode: ${ACTIVATION_MODES.join(", ")}`,
                  required: false,
                },
                {
                  name: "focus",
                  description: "Optional business KPI or topic cluster focus.",
                  required: false,
                },
              ],
            },
          ],
        },
      };
    }

    case "prompts/get": {
      const promptName =
        req.params && typeof req.params.name === "string" ? req.params.name : "";
      if (promptName !== "apexseo_elite_strategist") {
        return errorRpc(id, -32602, `Unknown prompt: ${promptName}`);
      }
      const promptArgs =
        req.params?.arguments && typeof req.params.arguments === "object"
          ? (req.params.arguments as Record<string, unknown>)
          : {};
      const rawMode = typeof promptArgs.mode === "string" ? promptArgs.mode : undefined;
      const validMode = ACTIVATION_MODES.includes(rawMode as ActivationMode)
        ? (rawMode as ActivationMode)
        : undefined;

      const text = renderApexSeoPromptMessage({
        targetUrl: typeof promptArgs.targetUrl === "string" ? promptArgs.targetUrl : undefined,
        mode: validMode,
        focus: typeof promptArgs.focus === "string" ? promptArgs.focus : undefined,
      });

      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: "ApexSEO Elite v2026.6 Technical SEO & GEO Strategist Prompt",
          messages: [
            {
              role: "user",
              content: { type: "text", text },
            },
          ],
        },
      };
    }

    case "tools/call": {
      return handleToolCall(id, req.params, options);
    }

    default:
      return errorRpc(id, -32601, `Method not found: ${req.method}`);
  }
}

async function handleToolCall(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  options: McpDispatchOptions
): Promise<JsonRpcResponse> {
  const toolName = typeof params?.name === "string" ? params.name : "";
  const tool = findGeoTool(toolName);
  if (!tool) {
    return {
      jsonrpc: "2.0",
      id,
      result: wrapToolError(`Unknown tool "${toolName}". Call tools/list to view available tools.`),
    };
  }

  const publicBase = resolvePublicBaseUrl(options.requestOrigin);
  const resourceUrl = `${publicBase}${tool.routePath}`;
  const enforcePayment = options.enforcePayment ?? true;
  const metaObj =
    params?._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : undefined;
  const mcpPaymentMeta = metaObj?.["x402/payment"];

  // Return 402 PaymentRequired challenge immediately on unpaid tool probes (even with empty args)
  if (enforcePayment && !tool.isFree && !mcpPaymentMeta && !options.httpPaymentSignature?.trim()) {
    recordToolAnalytics({ tool: tool.name, isFree: false, status: "402_probe" });
    const unpaid = await verifyPaymentBeforeExecution({
      tool,
      requestUrl: resourceUrl,
      mode: "mcp",
      paymentSignatureHeader: null,
      mcpPaymentMeta: undefined,
      requestOrigin: options.requestOrigin,
      facilitatorFetch: options.facilitatorFetch,
    });
    if (unpaid.status === "rejected") {
      return {
        jsonrpc: "2.0",
        id,
        result: wrapToolError(unpaid.reason, {
          structuredContent: unpaid.challenge as unknown as Record<string, unknown>,
          meta: {
            "x402/payment-required": unpaid.challenge,
          },
        }),
      };
    }
  }

  const parsed = tool.zodSchema.safeParse(params?.arguments ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return {
      jsonrpc: "2.0",
      id,
      result: wrapToolError(`Invalid tool arguments: ${details}`),
    };
  }

  let paymentCtx: Extract<
    Awaited<ReturnType<typeof verifyPaymentBeforeExecution>>,
    { status: "verified" }
  >["context"] | null = null;

  if (enforcePayment && !tool.isFree) {
    const paymentCheck = await verifyPaymentBeforeExecution({
      tool,
      requestUrl: resourceUrl,
      mode: "mcp",
      paymentSignatureHeader: options.httpPaymentSignature,
      mcpPaymentMeta,
      requestOrigin: options.requestOrigin,
      facilitatorFetch: options.facilitatorFetch,
    });

    if (paymentCheck.status === "rejected") {
      return {
        jsonrpc: "2.0",
        id,
        result: wrapToolError(paymentCheck.reason, {
          structuredContent: paymentCheck.challenge as unknown as Record<string, unknown>,
          meta: {
            "x402/payment-required": paymentCheck.challenge,
          },
        }),
      };
    }

    if (paymentCheck.status === "verified") {
      paymentCtx = paymentCheck.context;
    }
  }

  let data: unknown;
  try {
    data = await tool.execute(parsed.data, options.requestOrigin);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        jsonrpc: "2.0",
        id,
        result: wrapToolError(`SSRF_BLOCKED: ${err.message}`),
      };
    }
    if (err instanceof TargetFetchError) {
      return {
        jsonrpc: "2.0",
        id,
        result: wrapToolError(`UPSTREAM_FETCH_ERROR: ${err.message}`),
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      result: wrapToolError(err instanceof Error ? err.message : "Tool execution failed"),
    };
  }

  if (paymentCtx) {
    const settlement = await settleVerifiedPayment(paymentCtx);
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
        mode: "mcp",
        error: settlement.reason,
        requestOrigin: options.requestOrigin,
      });
      return {
        jsonrpc: "2.0",
        id,
        result: wrapToolError(settlement.reason, {
          structuredContent: challenge as unknown as Record<string, unknown>,
          meta: { "x402/payment-required": challenge },
        }),
      };
    }

    recordToolAnalytics({
      tool: tool.name,
      isFree: false,
      status: "success",
      amountAtomic: tool.amountAtomic,
      payer: (settlement.settleResponse as { payer?: string })?.payer,
      txHash: (settlement.settleResponse as { transaction?: string })?.transaction,
    });

    return {
      jsonrpc: "2.0",
      id,
      result: wrapToolResult(data, {
        "x402/payment-response": settlement.settleResponse,
      }),
    };
  }

  if (tool.isFree) {
    recordToolAnalytics({ tool: tool.name, isFree: true, status: "success" });
  }

  return {
    jsonrpc: "2.0",
    id,
    result: wrapToolResult(data),
  };
}
