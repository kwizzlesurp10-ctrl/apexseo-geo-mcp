# ApexSEO GEO & AI-Crawler Audit MCP (`apexseo-geo-mcp`)

> **Keyless Remote Streamable HTTP MCP & Base Mainnet USDC x402 API** powered by **ApexSEO Elite v2026.6**. Evaluates any live public website for AI-search citation readiness (GEO/AEO), `robots.txt` per-bot crawler policies, `/llms.txt` compliance, JSON-LD entity structure, technical performance, and head-to-head competitor deltas.

## Why This Exists

Most SEO/audit MCP servers require paid third-party SaaS API keys (DataForSEO, Semrush, Ahrefs, Serper) or heavyweight local headless browsers. `apexseo-geo-mcp` executes **fast, deterministic, zero-key live audits** from edge-friendly Node.js with strict SSRF protection, enabling autonomous agents to diagnose and monetize technical GEO/AEO work on demand for **$0.01–$0.05 USDC per call** on Base Mainnet (`eip155:8453`).

## Tools & Pricing (Base Mainnet USDC)

| Tool | HTTP Route | Price | Capabilities |
| :--- | :--- | :--- | :--- |
| `geo_health` | `GET /api/health` | **FREE** | Live health, payout address, CDP auth readiness, SSRF posture |
| `geo_pricing` | `GET /api/pricing` | **FREE** | Live USDC pricing schedule & Streamable HTTP MCP coordinates |
| `ai_crawler_audit` | `POST /api/audit/crawlers` | **$0.01** | `robots.txt` per-bot matrix (`GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `Bingbot`, `Applebot-Extended`, `CCBot`), `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/.well-known/*` discovery |
| `geo_page_audit` | `POST /api/audit/page` | **$0.02** | Live TTFB, redirect chain, `X-Robots-Tag`, canonical/hreflang, security headers, question-heading density, structured lists/tables, empty-CSR shell check, E-E-A-T signals, `geoScore` (0–100), ICE fix roadmap |
| `schema_citation_check` | `POST /api/audit/schema` | **$0.01** | Extracts & validates `application/ld+json` `@graph` nodes, detects syntax/citation gaps (`Organization`, `SoftwareApplication`, `Product`, `Article`, `FAQPage`, `WebPage`), synthesizes ready-to-paste JSON-LD patch |
| `geo_competitor_compare` | `POST /api/audit/compare` | **$0.05** | Parallel live audit of `targetUrl` vs 1–3 `competitorUrls` computing win/loss deltas across `geoScore`, TTFB, `llms.txt`, schema depth & ranked ICE counter-strategy |

Plus MCP Prompt **`apexseo_elite_strategist`** (`prompts/list` & `prompts/get`) shipping the full `ApexSEO Elite v2026.6` autonomous strategy framework sourced from [`swarmscribe-qma2`](https://github.com/kwizzlesurp10-ctrl/swarmscribe-qma2).

## Connect via Streamable HTTP MCP

```json
{
  "mcpServers": {
    "apexseo-geo-mcp": {
      "type": "streamable-http",
      "url": "https://apexseo-geo-mcp.vercel.app/mcp"
    }
  }
}
```

Or discover & invoke via AgentCash / CLI:

```bash
npx agentcash@latest discover https://apexseo-geo-mcp.vercel.app
npx agentcash@latest fetch https://apexseo-geo-mcp.vercel.app/api/audit/page \
  -m POST -b '{"url":"https://example.com"}'
```

## Run Locally (Development, Tests, Stdio & Docker)

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm mcp:stdio
```

Build the stdio MCP container (tested by Glama):

```bash
docker build -t apexseo-geo-mcp .
docker run -i --rm apexseo-geo-mcp
```

## Security & Protocol Guarantees

- **Strict SSRF Protection (`lib/ssrf.ts`)**: Blocks loopback, RFC 1918 private subnets, carrier-grade NAT, link-local / cloud IMDS (`169.254.169.254`), ULA/IPv6 private ranges, DNS-rebinding lookups, embedded URL credentials, redirect hops to private IPs (max 5 redirects), and streams with a 2 MiB body cap + 8s timeout.
- **Fail-Closed x402 Enforcement (`lib/payment.ts`)**: Production CDP facilitator verification requires valid `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`; unauthenticated or underpaid calls strictly return `402` (`PAYMENT-REQUIRED`) / MCP `isError: true` structured challenges. Errors reject **before** `/settle`.
- **Streamable HTTP Browser GET Compliance**: `GET /mcp` serves `200 OK` JSON Server Card for browsers/registries and SSE stream when `Accept: text/event-stream` is requested.

## Author & Maintainer

- **Author**: Keith S. · **kwizzlesurp.com** · **Sevtech** · **Dragon&PandaDuo**
- **Website**: [https://kwizzlesurp.com](https://kwizzlesurp.com)
- **Contact**: kwizzlesurp10@gmail.com
- **Location**: Minneapolis, MN, USA
- **Base Mainnet Payout (`X402_PAY_TO`)**: `0x0d25A44f74868eCE53B305C97139CF4B62963410` (`eip155:8453` USDC)
- **License**: MIT ([LICENSE](./LICENSE))
