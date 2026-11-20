# apexseo-geo-mcp

Keyless Base Mainnet (`eip155:8453`) USDC x402 API, remote Streamable HTTP MCP server, and stdio MCP server powered by **ApexSEO Elite v2026.6**. Evaluates live public websites for AI-crawler policies (`robots.txt`, `/llms.txt`, `/sitemap.xml`), GEO/AEO page readiness, JSON-LD citation completeness, and head-to-head competitor deltas.

## Commands & Tooling

- **Package manager**: `pnpm@12.15.0` (Node 22+ required; `monitor/db.ts` uses built-in `node:sqlite`, and `Dockerfile` uses `node:22-alpine`).
- **Next.js app**: `pnpm dev` | `pnpm build` | `pnpm start`
- **Typecheck & tests**: `pnpm typecheck` (`tsc --noEmit`) | `pnpm test` (`vitest run` over `tests/**/*.test.ts`)
- **Stdio MCP bundle**: `pnpm build:mcp` (esbuild -> `dist/mcp-stdio.mjs`) | `pnpm mcp:stdio`
- **Local cron & analytics monitor**: `pnpm build:monitor` (esbuild -> `dist/monitor.mjs`) | `pnpm monitor` | `pnpm monitor:check` (`--once`)

## Repository Layout

- `lib/catalog.ts` — Canonical `GEO_TOOL_CATALOG` defining all 6 tools (`geo_health`, `geo_pricing`, `ai_crawler_audit`, `geo_page_audit`, `schema_citation_check`, `geo_competitor_compare`), Zod/JSON schemas, atomic Base USDC amounts (`0`, `10000`, `20000`, `50000`), and `execute` handlers.
- `lib/crawler.ts` — Live AI-crawler audit (`runAiCrawlerAudit`) checking 12 bots (`MONITORED_BOTS`), `/robots.txt`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, and `/.well-known/*`.
- `lib/auditor.ts` — Cheerio-based live page audit (`runGeoPageAudit`), JSON-LD `@graph` validator/patcher (`runSchemaCitationCheck`), and parallel competitor benchmark (`runCompetitorCompare`).
- `lib/ssrf.ts` — Strict SSRF protection (`validatePublicHttpUrl`, `safeFetchUrl`, `isPrivateOrReservedIp`): blocks loopback, RFC1918, CGNAT, link-local/IMDS (`169.254.0.0/16`), IPv6 ULA/link-local, IPv4-mapped IPv6, embedded URL credentials, and private DNS resolutions; validates each manual redirect hop (max 5); enforces 8s timeout and 2 MiB body cap.
- `lib/payment.ts` & `lib/cdp-jwt.ts` — x402 v2 payment verification & settlement against Coinbase CDP facilitator (`api.cdp.coinbase.com/platform/v2/x402`) with short-lived ES256/EdDSA Bearer JWTs (`signCdpJwt`).
- `lib/http-handler.ts` — Shared Next.js tool HTTP handler (`handleToolHttpRequest`), CORS headers (`CORS_HEADERS`, `corsOptionsResponse`), and `402`/`200`/`400`/`502` responses.
- `lib/mcp-core.ts`, `lib/envelope.ts`, `lib/prompt.ts` — Transport-agnostic JSON-RPC 2.0 MCP server (`handleMcpJsonRpc`, protocol `2025-03-26`), standard MCP envelopes (`wrapToolResult`, `wrapToolError`), and the `apexseo_elite_strategist` prompt backed by `data/apexseo-elite.json`.
- `lib/discovery.ts` & `lib/env.ts` — Server card (`buildMcpServerCard`), `/.well-known/x402`, A2A agent card, OpenAPI 3.1 (`x-payment-info`), `/llms.txt`, `funding.json`, canonical branding (`CANONICAL_BRAND`), payout address (`CANONICAL_PAY_TO`), and `X402_TRUST_VERIFICATION`.
- `bin/mcp-stdio.ts` — Line-delimited JSON-RPC stdio server (`dist/mcp-stdio.mjs` bin entrypoint). Enforces x402 unless `MCP_STDIO_LOCAL_FREE=true`; drains `workQueue` via `exitIfDrained` before exiting on stdin EOF.
- `app/` — Next.js App Router:
  - Paid/free tool HTTP routes: `app/api/health/route.ts`, `app/api/pricing/route.ts`, `app/api/audit/{crawlers,page,schema,compare}/route.ts`
  - MCP endpoint: `app/mcp/route.ts` and connector claim `app/mcp/.well-known/glama.json/route.ts`
  - Discovery & metadata: `app/openapi.json/route.ts`, `app/llms.txt/route.ts`, `app/robots.txt/route.ts`, `app/sitemap.xml/route.ts`, `app/.well-known/{x402,x402-trust.txt,mcp,mcp.json,mcp/server-card.json,agent-card.json,agents.json,glama.json,funding.json,security.txt}/route.ts`
  - Frontend: `app/page.tsx`, `app/components/Playground.tsx`, `app/privacy/page.tsx`
- `monitor/` — Standalone local health/parity cron monitor, SQLite store (`monitor/data/apexseo-monitor.db`, gitignored), x402-trust/Glama/x402scan/MCP Registry/GitHub/Base USDC settlement aggregators, and localhost dashboard server (`cli.ts`, `probes.ts`, `aggregators.ts`, `scheduler.ts`, `db.ts`, `server.ts`, `ui.ts`, `types.ts`).
- `tests/` — Vitest unit/protocol tests (`ssrf.test.ts`, `crawler-audit.test.ts`, `payment-mcp.test.ts`, `monitor.test.ts`).

## Engineering & Protocol Invariants

1. **x402 Probe-First & Settle-After-Execute Order**:
   - Paid endpoints and paid MCP `tools/call` requests without a payment signature (`PAYMENT-SIGNATURE` / `X-PAYMENT` on HTTP, or `_meta["x402/payment"]` on MCP) MUST immediately return a `402` challenge (`PAYMENT-REQUIRED` header + Bazaar extension) or MCP `isError: true` challenge (`_meta["x402/payment-required"]` + `structuredContent`) **before** argument/JSON validation so x402 scanners discover payment terms on `GET` or empty `POST {}` probes.
   - When a payment signature is present: validate inputs (`zodSchema`) -> `verifyPaymentBeforeExecution` -> execute audit -> `settleVerifiedPayment`. Never settle if execution throws `SsrfBlockedError`, `TargetFetchError`, or any execution error.
   - Production Coinbase CDP URL (`api.cdp.coinbase.com`) MUST fail closed with `FACILITATOR_AUTH_REQUIRED` if `CDP_API_KEY_ID` or `CDP_API_KEY_SECRET` is unset.
2. **Strict SSRF Boundary**:
   - Every live outbound fetch of a user-supplied URL must go through `safeFetchUrl` / `validatePublicHttpUrl` in `lib/ssrf.ts`—never call raw `fetch()` directly in auditors or crawlers.
3. **Streamable HTTP `/mcp` & Registry Discovery**:
   - Plain `GET /mcp` (without `Accept: text/event-stream`) MUST return `200 OK` `application/json` (`buildMcpServerCard`). SSE `GET` returns `text/event-stream`, and `POST` dispatches `handleMcpJsonRpc`.
   - Keep `GET /.well-known/x402-trust.txt`, `GET /mcp/.well-known/glama.json`, `GET /.well-known/glama.json`, and `server.json` (`$schema` `2025-12-11`, `description` <= 100 chars) intact.
   - Keep version strings aligned across `package.json`, `server.json`, `lib/catalog.ts`, `lib/mcp-core.ts`, and `lib/discovery.ts` when bumping releases.
4. **Testing & Local State**:
   - Path alias `@/*` resolves to the repository root in both `tsconfig.json` and `vitest.config.ts`.
   - Unit tests must stay deterministic and offline by injecting mock `lookupFn`, `fetchFn`, and `facilitatorFetch` hooks (or `:memory:` SQLite in `MonitorStore`).
   - Never commit `.env*` files or `monitor/data`.
