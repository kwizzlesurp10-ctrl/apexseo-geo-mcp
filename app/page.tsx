import { headers } from "next/headers";
import { Playground } from "./components/Playground";
import { GEO_TOOL_CATALOG } from "@/lib/catalog";
import { CANONICAL_BRAND, getPaymentConfig } from "@/lib/env";
import { ACTIVATION_MODES, APEXSEO_ELITE_METADATA } from "@/lib/prompt";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const inferredOrigin = host ? `${proto}://${host}` : undefined;
  const cfg = getPaymentConfig(inferredOrigin);

  const jsonLdGraph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${cfg.publicBaseUrl}/#organization`,
        name: `${CANONICAL_BRAND.author} — ${CANONICAL_BRAND.org}`,
        url: CANONICAL_BRAND.website,
        email: CANONICAL_BRAND.email,
        sameAs: [CANONICAL_BRAND.website, CANONICAL_BRAND.repository],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${cfg.publicBaseUrl}/#software`,
        name: "ApexSEO GEO & AI-Crawler Audit MCP",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform (Remote Streamable HTTP MCP & Node.js Stdio)",
        url: cfg.publicBaseUrl,
        description:
          "Keyless Base USDC x402 MCP & HTTP service for live AI-crawler (robots.txt, llms.txt), Technical GEO/AEO readiness, JSON-LD citation completeness, and competitor benchmarks.",
        author: { "@id": `${cfg.publicBaseUrl}/#organization` },
        dateModified: "2026-11-20",
        offers: {
          "@type": "Offer",
          price: "0.01",
          priceCurrency: "USD",
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${cfg.publicBaseUrl}/#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "How does ApexSEO GEO Audit MCP work without SaaS API keys?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Every audit runs deterministic live HTTP, DNS/SSRF validation, robots.txt RFC 9309 matrix analysis, llms.txt parsing, and HTML/JSON-LD citation scoring directly on demand, gated per call via x402 v2 Base Mainnet USDC ($0.01-$0.05).",
            },
          },
          {
            "@type": "Question",
            name: "Which AI crawlers and GEO signals are evaluated?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "The server audits GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended, Googlebot, Bingbot, Applebot-Extended, CCBot, and meta-externalagent alongside llms.txt, TTFB, X-Robots-Tag, question headings, E-E-A-T trust signals, and JSON-LD entity schemas.",
            },
          },
        ],
      },
    ],
  };

  const mcpClientSnippet = JSON.stringify(
    {
      mcpServers: {
        "apexseo-geo-mcp": {
          type: "streamable-http",
          url: `${cfg.publicBaseUrl}/mcp`,
        },
      },
    },
    null,
    2
  );

  return (
    <main className="container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdGraph) }}
      />

      <header style={{ marginBottom: "2rem" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <span className="badge">MCP Streamable HTTP</span>
          <span className="badge">x402 v2 · Base USDC (eip155:8453)</span>
          <span className="badge">Zero SaaS API Keys</span>
        </div>
        <h1 style={{ fontSize: "2.15rem", lineHeight: 1.2, margin: "0 0 0.75rem" }}>
          ApexSEO GEO &amp; AI-Crawler Audit MCP
        </h1>
        <p style={{ color: "var(--muted)", fontSize: "1.05rem", maxWidth: "78ch", margin: 0 }}>
          Built on the <strong>{APEXSEO_ELITE_METADATA.name} {APEXSEO_ELITE_METADATA.version}</strong>{" "}
          strategy engine. Audits any live public website for AI search engine citation readiness
          (GEO/AEO), <code>robots.txt</code> bot policies, <code>/llms.txt</code> compliance,
          JSON-LD entity completeness, technical performance, and head-to-head competitor deltas —
          settled per call in USDC on Base Mainnet.
        </p>
        <div style={{ marginTop: "0.9rem", fontSize: "0.86rem", color: "var(--muted)" }}>
          Operator: <strong>{CANONICAL_BRAND.author}</strong> ({CANONICAL_BRAND.org}) ·{" "}
          <span>Updated <time dateTime="2026-11-20">2026-11-20</time></span> ·{" "}
          <a href={`mailto:${CANONICAL_BRAND.email}`}>{CANONICAL_BRAND.email}</a> ·{" "}
          <a href={CANONICAL_BRAND.repository}>GitHub Source</a>
        </div>
      </header>

      <section aria-labelledby="what-tools-heading" style={{ marginTop: "2rem" }}>
        <h2 id="what-tools-heading">What tools &amp; per-call USDC pricing are available?</h2>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Tool / Endpoint</th>
                <th>Price (Base USDC)</th>
                <th>Purpose &amp; Deterministic Output</th>
              </tr>
            </thead>
            <tbody>
              {GEO_TOOL_CATALOG.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <code>{tool.name}</code>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                      {tool.method} <code>{tool.routePath}</code>
                    </div>
                  </td>
                  <td>
                    <strong style={{ color: tool.isFree ? "var(--success)" : "var(--accent)" }}>
                      {tool.isFree ? "FREE" : tool.priceUsd}
                    </strong>
                    {!tool.isFree && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {tool.amountAtomic} atomic
                      </div>
                    )}
                  </td>
                  <td>{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="how-connect-heading" style={{ marginTop: "2rem" }}>
        <h2 id="how-connect-heading">How do autonomous agents and IDEs connect?</h2>
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>MCP Client Configuration</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Add directly to Cursor, Claude Desktop, Windsurf, or any Streamable HTTP MCP host.
              Browser <code>GET /mcp</code> serves a <code>200 OK</code> JSON Server Card.
            </p>
            <pre className="codeblock">{mcpClientSnippet}</pre>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>AgentCash CLI &amp; Discovery URLs</h3>
            <ul style={{ paddingLeft: "1.1rem", margin: "0 0 0.75rem", fontSize: "0.92rem" }}>
              <li>
                MCP Streamable HTTP: <a href="/mcp"><code>{cfg.publicBaseUrl}/mcp</code></a>
              </li>
              <li>
                OpenAPI 3.1 + Pricing: <a href="/openapi.json"><code>/openapi.json</code></a>
              </li>
              <li>
                x402 Resource Catalog: <a href="/.well-known/x402"><code>/.well-known/x402</code></a>
              </li>
              <li>
                A2A Agent Card: <a href="/.well-known/agent-card.json"><code>/.well-known/agent-card.json</code></a>
              </li>
              <li>
                llms.txt Manifest: <a href="/llms.txt"><code>/llms.txt</code></a>
              </li>
            </ul>
            <pre className="codeblock">{`npx agentcash@latest discover ${cfg.publicBaseUrl}
npx agentcash@latest fetch ${cfg.publicBaseUrl}/api/audit/page -m POST -b '{"url":"https://example.com"}'`}</pre>
          </div>
        </div>
      </section>

      <section aria-labelledby="why-geo-heading" style={{ marginTop: "2rem" }}>
        <h2 id="why-geo-heading">Why do AI-Crawler &amp; GEO/AEO audits matter in 2026?</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Modern search visibility depends equally on classical crawlability (TTFB, canonicalization,
            indexability) and machine extraction inside AI Overviews, ChatGPT Search, Claude, and
            Perplexity. Sites routinely block live retrieval bots (<code>OAI-SearchBot</code>,{" "}
            <code>PerplexityBot</code>, <code>Claude-Web</code>) via stale wildcard rules or ship
            client-rendered shells invisible to citation extractors.
          </p>
          <ul>
            <li>
              <strong>Zero-Key Live Verification:</strong> Direct HTTPS fetches guarded by DNS-level
              SSRF private-IP and redirect validation — zero third-party SaaS credentials required.
            </li>
            <li>
              <strong>ApexSEO Elite Prompt Included:</strong> Exposes MCP prompt{" "}
              <code>apexseo_elite_strategist</code> across modes:{" "}
              <code>{ACTIVATION_MODES.join(" · ")}</code>.
            </li>
            <li>
              <strong>Strict Base USDC Settlement:</strong> Recipient{" "}
              <code>{cfg.payTo}</code> on <code>{cfg.network}</code> ({cfg.demoMode ? "Local Mode" : "Mainnet Enforced"}).
            </li>
          </ul>
        </div>
      </section>

      <Playground baseUrl={cfg.publicBaseUrl} />

      <footer
        style={{
          marginTop: "3rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid var(--border)",
          fontSize: "0.85rem",
          color: "var(--muted)",
        }}
      >
        <div>
          <strong>{CANONICAL_BRAND.author}</strong> · {CANONICAL_BRAND.org} ·{" "}
          {CANONICAL_BRAND.location}
        </div>
        <div style={{ marginTop: "0.35rem" }}>
          <a href="/privacy">Privacy</a> ·{" "}
          <a href="/.well-known/x402-trust.txt">x402-trust proof</a> ·{" "}
          <a href="/.well-known/security.txt">security.txt</a> ·{" "}
          <a href="/.well-known/funding.json">funding.json</a> ·{" "}
          <a href={CANONICAL_BRAND.website}>kwizzlesurp.com</a>
        </div>
      </footer>
    </main>
  );
}
