import { z } from "zod";
import { runCompetitorCompare, runGeoPageAudit, runSchemaCitationCheck } from "./auditor";
import { runAiCrawlerAudit } from "./crawler";
import { CANONICAL_BRAND, getPaymentConfig } from "./env";

export type ToolMethod = "GET" | "POST";

export interface GeoToolSpec<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  method: ToolMethod;
  routePath: string;
  priceUsd: string; // "0" for free or "$0.01"
  amountAtomic: string; // Base USDC 6-decimal integer string
  isFree: boolean;
  zodSchema: TInput;
  inputJsonSchema: Record<string, unknown>;
  outputJsonSchema: Record<string, unknown>;
  exampleInput: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  execute: (input: z.infer<TInput>, requestOrigin?: string) => Promise<unknown>;
}

const emptyInputSchema = z.object({});

const singleUrlInputSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Must be a valid http:// or https:// URL")
    .describe("Public HTTPS or HTTP URL to inspect live (private/local IPs rejected)."),
});

const compareInputSchema = z.object({
  targetUrl: z
    .string()
    .trim()
    .url("targetUrl must be a valid http:// or https:// URL")
    .describe("Primary URL whose GEO & crawler readiness is benchmarked."),
  competitorUrls: z
    .array(z.string().trim().url("Each competitorUrl must be a valid http:// or https:// URL"))
    .min(1, "Provide at least 1 competitor URL")
    .max(3, "Maximum 3 competitor URLs per compare call")
    .describe("1 to 3 competitor URLs to audit in parallel and compare against targetUrl."),
});

const emptyJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const singleUrlJsonSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      format: "uri",
      description: "Public HTTPS/HTTP URL to audit live (e.g. https://example.com).",
    },
  },
  required: ["url"],
  additionalProperties: false,
};

const compareJsonSchema = {
  type: "object",
  properties: {
    targetUrl: {
      type: "string",
      format: "uri",
      description: "Your target URL to benchmark.",
    },
    competitorUrls: {
      type: "array",
      items: { type: "string", format: "uri" },
      minItems: 1,
      maxItems: 3,
      description: "1 to 3 competitor URLs for live head-to-head benchmarking.",
    },
  },
  required: ["targetUrl", "competitorUrls"],
  additionalProperties: false,
};

export const GEO_TOOL_CATALOG: GeoToolSpec<any>[] = [
  {
    name: "geo_health",
    title: "Service Health & Auth Readiness",
    description:
      "Free diagnostic check returning live service uptime, supported AI crawler matrix, x402 payment configuration (Base USDC payTo and CDP facilitator readiness), and SSRF protection status. Call this or geo_pricing first before running paid live-site audits.",
    method: "GET",
    routePath: "/api/health",
    priceUsd: "0",
    amountAtomic: "0",
    isFree: true,
    zodSchema: emptyInputSchema,
    inputJsonSchema: emptyJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        service: { type: "string" },
        version: { type: "string" },
        payTo: { type: "string" },
        network: { type: "string" },
        demoMode: { type: "boolean" },
        facilitatorAuthConfigured: { type: "boolean" },
      },
      required: ["ok", "service", "payTo", "network"],
    },
    exampleInput: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (_input, requestOrigin) => {
      const cfg = getPaymentConfig(requestOrigin);
      return {
        ok: true,
        service: "apexseo-geo-mcp",
        title: "ApexSEO GEO & AI-Crawler Audit MCP",
        version: "0.1.0",
        framework: "ApexSEO Elite v2026.6",
        operator: CANONICAL_BRAND,
        payTo: cfg.payTo,
        network: cfg.network,
        usdcAsset: cfg.usdcAsset,
        facilitatorUrl: cfg.facilitatorUrl,
        facilitatorAuthConfigured: cfg.hasCdpAuth,
        demoMode: cfg.demoMode,
        ssrfProtection: "strict-dns-and-redirect-private-ip-blocking",
        timestamp: new Date().toISOString(),
      };
    },
  },
  {
    name: "geo_pricing",
    title: "Live x402 USDC Pricing & Tool Menu",
    description:
      "Free pricing manifest listing all ApexSEO GEO audit endpoints, Base Mainnet (eip155:8453) USDC prices ($0.01-$0.05), endpoint paths, and MCP Streamable HTTP connection details. Ideal sibling to geo_health before dispatching paid calls.",
    method: "GET",
    routePath: "/api/pricing",
    priceUsd: "0",
    amountAtomic: "0",
    isFree: true,
    zodSchema: emptyInputSchema,
    inputJsonSchema: emptyJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        currency: { type: "string" },
        network: { type: "string" },
        payTo: { type: "string" },
        endpoints: { type: "array", items: { type: "object" } },
      },
      required: ["currency", "network", "payTo", "endpoints"],
    },
    exampleInput: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (_input, requestOrigin) => {
      const cfg = getPaymentConfig(requestOrigin);
      return {
        service: "apexseo-geo-mcp",
        currency: "USDC",
        network: cfg.network,
        asset: cfg.usdcAsset,
        payTo: cfg.payTo,
        mcpEndpoint: `${cfg.publicBaseUrl}/mcp`,
        demoMode: cfg.demoMode,
        endpoints: GEO_TOOL_CATALOG.map((t) => ({
          tool: t.name,
          method: t.method,
          url: `${cfg.publicBaseUrl}${t.routePath}`,
          priceUsd: t.isFree ? "FREE" : t.priceUsd,
          amountAtomic: t.amountAtomic,
          description: t.title,
        })),
      };
    },
  },
  {
    name: "ai_crawler_audit",
    title: "AI Crawler, robots.txt & llms.txt Audit ($0.01)",
    description:
      "Live-fetches a domain's /robots.txt, /llms.txt, /llms-full.txt, /sitemap.xml, and /.well-known/{x402,mcp,agent-card.json} files, returning a per-bot permission matrix (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, Applebot-Extended, CCBot), AI-crawler readiness score (0-100), and ICE fixes. Use geo_page_audit for HTML/TTFB signals or schema_citation_check for JSON-LD validation.",
    method: "POST",
    routePath: "/api/audit/crawlers",
    priceUsd: "$0.01",
    amountAtomic: "10000",
    isFree: false,
    zodSchema: singleUrlInputSchema,
    inputJsonSchema: singleUrlJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        robotsTxt: { type: "object" },
        llmsTxt: { type: "object" },
        sitemapXml: { type: "object" },
        wellKnown: { type: "object" },
        summary: { type: "object" },
        iceActionPlan: { type: "array" },
      },
      required: ["origin", "robotsTxt", "llmsTxt", "summary", "iceActionPlan"],
    },
    exampleInput: { url: "https://example.com" },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (input: z.infer<typeof singleUrlInputSchema>) => {
      return runAiCrawlerAudit(input.url);
    },
  },
  {
    name: "geo_page_audit",
    title: "Live GEO / AEO & Technical SEO Page Audit ($0.02)",
    description:
      "Performs a comprehensive live technical + Generative Engine Optimization (GEO/AEO) audit of any URL: measures TTFB, redirect chain, X-Robots-Tag, meta robots, canonical/hreflang, compression & security headers, title/meta/OpenGraph, H1-H3 question-heading density, structured lists/tables, empty CSR-shell detection, image alt coverage, E-E-A-T trust signals, composite geoScore (0-100), and ApexSEO Elite ICE action plan. Pair with ai_crawler_audit for site-wide robots.txt/llms.txt or geo_competitor_compare for rival benchmarking.",
    method: "POST",
    routePath: "/api/audit/page",
    priceUsd: "$0.02",
    amountAtomic: "20000",
    isFree: false,
    zodSchema: singleUrlInputSchema,
    inputJsonSchema: singleUrlJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        finalUrl: { type: "string" },
        fetch: { type: "object" },
        directives: { type: "object" },
        structure: { type: "object" },
        subscores: { type: "object" },
        geoScore: { type: "number" },
        grade: { type: "string" },
        iceActionPlan: { type: "array" },
      },
      required: ["finalUrl", "geoScore", "grade", "subscores", "iceActionPlan"],
    },
    exampleInput: { url: "https://example.com" },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (input: z.infer<typeof singleUrlInputSchema>) => {
      return runGeoPageAudit(input.url);
    },
  },
  {
    name: "schema_citation_check",
    title: "JSON-LD & AI Citation Entity Check ($0.01)",
    description:
      "Extracts and validates all embedded application/ld+json blocks (including @graph trees) on a live page, flags syntax errors and missing AI-citation properties for Organization, WebSite, SoftwareApplication, Product, Article, FAQPage, and WebPage entities, scores schema completeness (0-100), and outputs a ready-to-paste JSON-LD @graph patch customized from detected metadata.",
    method: "POST",
    routePath: "/api/audit/schema",
    priceUsd: "$0.01",
    amountAtomic: "10000",
    isFree: false,
    zodSchema: singleUrlInputSchema,
    inputJsonSchema: singleUrlJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        finalUrl: { type: "string" },
        jsonLdBlockCount: { type: "number" },
        parseErrors: { type: "array" },
        detectedTypes: { type: "array" },
        schemaScore: { type: "number" },
        citationReadiness: { type: "string" },
        recommendedJsonLdPatch: { type: "object" },
        iceActionPlan: { type: "array" },
      },
      required: ["finalUrl", "detectedTypes", "schemaScore", "recommendedJsonLdPatch"],
    },
    exampleInput: { url: "https://example.com" },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (input: z.infer<typeof singleUrlInputSchema>) => {
      return runSchemaCitationCheck(input.url);
    },
  },
  {
    name: "geo_competitor_compare",
    title: "Live Head-to-Head Competitor GEO Benchmark ($0.05)",
    description:
      "Runs parallel live page GEO audits and AI-crawler (robots.txt / llms.txt) checks across your targetUrl and 1-3 competitorUrls, computing exact win/loss deltas across geoScore, AI-crawler readiness, TTFB speed, schema depth, question headings, and llms.txt coverage, plus a ranked ICE counter-strategy roadmap.",
    method: "POST",
    routePath: "/api/audit/compare",
    priceUsd: "$0.05",
    amountAtomic: "50000",
    isFree: false,
    zodSchema: compareInputSchema,
    inputJsonSchema: compareJsonSchema,
    outputJsonSchema: {
      type: "object",
      properties: {
        target: { type: "object" },
        competitors: { type: "array" },
        deltasVsCompetitorBest: { type: "object" },
        gapsToClose: { type: "array" },
        advantagesToPress: { type: "array" },
        iceActionPlan: { type: "array" },
      },
      required: ["target", "competitors", "deltasVsCompetitorBest", "iceActionPlan"],
    },
    exampleInput: {
      targetUrl: "https://example.com",
      competitorUrls: ["https://competitor-a.example"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (input: z.infer<typeof compareInputSchema>) => {
      return runCompetitorCompare(input.targetUrl, input.competitorUrls);
    },
  },
];

export function findGeoTool(name: string): GeoToolSpec | undefined {
  return GEO_TOOL_CATALOG.find((t) => t.name === name);
}
