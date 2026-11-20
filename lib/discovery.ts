import { GEO_TOOL_CATALOG } from "./catalog";
import { CANONICAL_BRAND, getPaymentConfig } from "./env";
import { ACTIVATION_MODES, APEXSEO_ELITE_METADATA } from "./prompt";

export function buildMcpServerCard(requestOrigin?: string) {
  const cfg = getPaymentConfig(requestOrigin);
  return {
    name: "io.github.kwizzlesurp10-ctrl/apexseo-geo-mcp",
    title: "ApexSEO GEO & AI-Crawler Audit MCP",
    version: "0.1.1",
    description:
      "Keyless Base USDC x402 MCP & HTTP audit suite for AI-crawler readiness (robots.txt/llms.txt), GEO/AEO page scoring, JSON-LD citation completeness, and competitor benchmarks.",
    protocolVersion: "2025-03-26",
    transport: "streamable-http",
    endpoint: `${cfg.publicBaseUrl}/mcp`,
    websiteUrl: cfg.publicBaseUrl,
    repository: CANONICAL_BRAND.repository,
    author: {
      name: CANONICAL_BRAND.author,
      organization: CANONICAL_BRAND.org,
      email: CANONICAL_BRAND.email,
      website: CANONICAL_BRAND.website,
      location: CANONICAL_BRAND.location,
    },
    framework: APEXSEO_ELITE_METADATA,
    payment: {
      protocol: "x402",
      version: 2,
      scheme: "exact",
      network: cfg.network,
      currency: "USDC",
      asset: cfg.usdcAsset,
      payTo: cfg.payTo,
      demoMode: cfg.demoMode,
    },
    prompts: [
      {
        name: "apexseo_elite_strategist",
        description:
          "ApexSEO Elite v2026.6 autonomous SEO & Generative Engine Optimization strategist prompt with 8 activation modes.",
        modes: ACTIVATION_MODES,
      },
    ],
    tools: GEO_TOOL_CATALOG.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      priceUsd: t.isFree ? "0" : t.priceUsd,
      amountAtomic: t.amountAtomic,
      httpMethod: t.method,
      httpUrl: `${cfg.publicBaseUrl}${t.routePath}`,
      inputSchema: t.inputJsonSchema,
      annotations: t.annotations,
    })),
  };
}

export function buildWellKnownX402(requestOrigin?: string) {
  const cfg = getPaymentConfig(requestOrigin);
  return {
    version: 2,
    service: {
      name: "ApexSEO GEO & AI-Crawler Audit MCP",
      id: "apexseo-geo-mcp",
      description:
        "Keyless live-site AI-crawler, GEO/AEO readiness, JSON-LD citation & competitor benchmark server settled in USDC on Base Mainnet.",
      homepage: cfg.publicBaseUrl,
      operator: CANONICAL_BRAND.org,
      author: CANONICAL_BRAND.author,
      contact: CANONICAL_BRAND.email,
      repository: CANONICAL_BRAND.repository,
    },
    payment: {
      scheme: "exact",
      network: cfg.network,
      asset: cfg.usdcAsset,
      currency: "USDC",
      payTo: cfg.payTo,
      facilitatorUrl: cfg.facilitatorUrl,
    },
    transports: {
      mcpStreamableHttp: `${cfg.publicBaseUrl}/mcp`,
      openapi: `${cfg.publicBaseUrl}/openapi.json`,
      llmsTxt: `${cfg.publicBaseUrl}/llms.txt`,
    },
    resources: GEO_TOOL_CATALOG.map((t) => ({
      name: t.name,
      method: t.method,
      url: `${cfg.publicBaseUrl}${t.routePath}`,
      priceUsd: t.isFree ? "FREE" : t.priceUsd,
      amountAtomic: t.amountAtomic,
      scheme: "exact",
      network: cfg.network,
      asset: cfg.usdcAsset,
      payTo: cfg.payTo,
      description: t.description,
    })),
  };
}

export function buildAgentCard(requestOrigin?: string) {
  const cfg = getPaymentConfig(requestOrigin);
  return {
    name: "ApexSEO GEO & AI-Crawler Audit Agent",
    description:
      "Autonomous Technical SEO, AI Search (GEO/AEO), robots.txt/llms.txt & JSON-LD citation auditor powered by ApexSEO Elite v2026.6.",
    url: cfg.publicBaseUrl,
    version: "0.1.0",
    provider: {
      organization: CANONICAL_BRAND.org,
      url: CANONICAL_BRAND.website,
      contactEmail: CANONICAL_BRAND.email,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      mcpStreamableHttp: `${cfg.publicBaseUrl}/mcp`,
      x402Payments: true,
    },
    skills: GEO_TOOL_CATALOG.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ["seo", "geo", "aeo", "ai-crawlers", "json-ld"],
      examples: [JSON.stringify(t.exampleInput)],
    })),
  };
}

export function buildOpenApiSpec(requestOrigin?: string) {
  const cfg = getPaymentConfig(requestOrigin);
  const paths: Record<string, Record<string, unknown>> = {};

  for (const tool of GEO_TOOL_CATALOG) {
    const methodKey = tool.method.toLowerCase();
    const operation: Record<string, unknown> = {
      operationId: tool.name,
      summary: tool.title,
      description: tool.description,
      responses: {
        "200": {
          description: `${tool.title} JSON report`,
          content: {
            "application/json": {
              schema: tool.outputJsonSchema,
            },
          },
        },
        ...(tool.isFree
          ? {}
          : {
              "402": {
                description: `x402 Payment Required (${tool.priceUsd} USDC on ${cfg.network})`,
              },
            }),
      },
    };

    if (!tool.isFree) {
      operation["x-payment-info"] = {
        price: tool.priceUsd,
        amountAtomic: tool.amountAtomic,
        currency: "USDC",
        asset: cfg.usdcAsset,
        network: cfg.network,
        scheme: "exact",
        payTo: cfg.payTo,
      };
    }

    if (tool.method === "POST") {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: tool.inputJsonSchema,
            example: tool.exampleInput,
          },
        },
      };
    }

    paths[tool.routePath] = { [methodKey]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ApexSEO GEO & AI-Crawler Audit API",
      version: "0.1.0",
      description:
        "Keyless live-site AI crawler (robots.txt / llms.txt), GEO/AEO readiness, JSON-LD entity citation completeness, and competitor benchmark API payable per call in Base USDC via x402 v2.",
      contact: {
        name: CANONICAL_BRAND.author,
        url: CANONICAL_BRAND.website,
        email: CANONICAL_BRAND.email,
      },
      license: {
        name: "MIT",
        url: `${CANONICAL_BRAND.repository}/blob/main/LICENSE`,
      },
    },
    servers: [{ url: cfg.publicBaseUrl }],
    paths,
  };
}

export function buildLlmsTxt(requestOrigin?: string): string {
  const cfg = getPaymentConfig(requestOrigin);
  return `# ApexSEO GEO & AI-Crawler Audit MCP

> Keyless remote Streamable HTTP MCP + x402 Base Mainnet USDC audit service powered by ApexSEO Elite v2026.6. Evaluates live domains for AI-bot access (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot), /llms.txt compliance, technical GEO/AEO readiness, JSON-LD citation completeness, and competitor benchmarks.

- Operator: ${CANONICAL_BRAND.author} (${CANONICAL_BRAND.org})
- Contact: ${CANONICAL_BRAND.email}
- Location: ${CANONICAL_BRAND.location}
- Network: ${cfg.network} (USDC \`${cfg.usdcAsset}\`)
- Payout Address: \`${cfg.payTo}\`

## MCP & Agent Discovery

- [Streamable HTTP MCP Endpoint](${cfg.publicBaseUrl}/mcp): MCP JSON-RPC 2.0 + Server Card manifest on GET
- [OpenAPI 3.1 + x-payment-info Spec](${cfg.publicBaseUrl}/openapi.json): Machine-readable API and x402 pricing contract
- [x402 Resource Manifest](${cfg.publicBaseUrl}/.well-known/x402): x402 v2 settlement and tool directory
- [Agent Card](${cfg.publicBaseUrl}/.well-known/agent-card.json): A2A capability descriptor

## Endpoints & Pricing

- [Service Health — FREE](${cfg.publicBaseUrl}/api/health): \`GET /api/health\`
- [Live Pricing — FREE](${cfg.publicBaseUrl}/api/pricing): \`GET /api/pricing\`
- [AI Crawler & llms.txt Audit — $0.01 USDC](${cfg.publicBaseUrl}/api/audit/crawlers): \`POST /api/audit/crawlers\`
- [GEO / AEO Technical Page Audit — $0.02 USDC](${cfg.publicBaseUrl}/api/audit/page): \`POST /api/audit/page\`
- [JSON-LD Schema Citation Check — $0.01 USDC](${cfg.publicBaseUrl}/api/audit/schema): \`POST /api/audit/schema\`
- [Head-to-Head Competitor Benchmark — $0.05 USDC](${cfg.publicBaseUrl}/api/audit/compare): \`POST /api/audit/compare\`
`;
}

export function buildFundingJson(requestOrigin?: string) {
  const cfg = getPaymentConfig(requestOrigin);
  return {
    version: "v1.0.0",
    entity: {
      type: "individual",
      name: CANONICAL_BRAND.author,
      role: "Founder, Dragon&PandaDuo / Sevtech",
      email: CANONICAL_BRAND.email,
      webpageUrl: CANONICAL_BRAND.website,
    },
    projects: [
      {
        guid: "apexseo-geo-mcp",
        name: "ApexSEO GEO & AI-Crawler Audit MCP",
        description:
          "Keyless Base USDC x402 MCP & HTTP API auditing AI crawlers, llms.txt, technical GEO readiness, and JSON-LD citation structure.",
        webpageUrl: cfg.publicBaseUrl,
        repositoryUrl: { url: CANONICAL_BRAND.repository },
        licenses: ["spdx:MIT"],
      },
    ],
    channels: [
      {
        guid: "base-usdc-x402",
        type: "payment-address",
        address: cfg.payTo,
        description: "Base Mainnet (eip155:8453) USDC payout address for x402 API calls",
      },
    ],
  };
}
