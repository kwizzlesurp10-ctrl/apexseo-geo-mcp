import { describe, expect, it } from "vitest";
import {
  analyzeHtmlPageAudit,
  analyzeHtmlSchemaCitations,
  runCompetitorCompare,
} from "@/lib/auditor";
import { parseRobotsTxt, runAiCrawlerAudit } from "@/lib/crawler";
import type { SafeFetchResult } from "@/lib/ssrf";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function makeResult(url: string, bodyText: string, status = 200, headers: Record<string, string> = {}): SafeFetchResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    status,
    ok: status >= 200 && status < 300,
    ttfbMs: 120,
    totalMs: 150,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    redirectChain: [],
    bodyText,
    byteLength: Buffer.byteLength(bodyText, "utf8"),
    truncated: false,
  };
}

describe("AI Crawler & GEO Audit Engine", () => {
  it("parses robots.txt per-bot rules and detects AI crawler blocks vs llms.txt quality", async () => {
    const robotsBody = `
User-agent: GPTBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: *
Disallow: /private/

Sitemap: https://target.example/sitemap.xml
`;
    const llmsBody = `# Target Docs
> Official developer & pricing reference for Target Platform.

## Docs
- [Quickstart](https://target.example/docs)
- [Pricing](https://target.example/pricing)
- [API Reference](https://target.example/api)
`;

    const fetchMock = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response(robotsBody, { status: 200 });
      if (url.endsWith("/llms.txt")) return new Response(llmsBody, { status: 200 });
      if (url.endsWith("/llms-full.txt")) return new Response("Full LLM markdown content here...", { status: 200 });
      if (url.endsWith("/sitemap.xml")) {
        return new Response("<urlset><url><loc>https://target.example/</loc></url></urlset>", { status: 200 });
      }
      if (url.endsWith("/.well-known/x402")) return new Response("{}", { status: 200 });
      return new Response("Not Found", { status: 404 });
    };

    const parsed = parseRobotsTxt(robotsBody);
    expect(parsed.sitemaps).toEqual(["https://target.example/sitemap.xml"]);

    const audit = await runAiCrawlerAudit("https://target.example/blog", {
      lookupFn: publicLookup,
      fetchFn: fetchMock,
    });

    const gptBot = audit.robotsTxt.botMatrix.find((b) => b.bot === "GPTBot");
    const oaiSearch = audit.robotsTxt.botMatrix.find((b) => b.bot === "OAI-SearchBot");
    const perplexity = audit.robotsTxt.botMatrix.find((b) => b.bot === "PerplexityBot");

    expect(gptBot?.status).toBe("blocked_root");
    expect(oaiSearch?.status).toBe("allowed");
    expect(perplexity?.status).toBe("partial");
    expect(audit.llmsTxt.present).toBe(true);
    expect(audit.llmsTxt.grade).toBe("A");
    expect(audit.wellKnown.x402.present).toBe(true);
    expect(audit.summary.aiCrawlerReadinessScore).toBeGreaterThan(75);
  });

  it("scores rich semantic HTML + JSON-LD high and flags CSR empty shells / noindex / schema errors", () => {
    const richHtml = `<!doctype html>
<html lang="en">
<head>
  <title>Enterprise GEO Platform | Benchmarks &amp; AI Search Readiness</title>
  <meta name="description" content="Measure AI Overviews citations, robots.txt bot rules, and structured entity coverage across live domains in real time." />
  <link rel="canonical" href="https://rich.example/platform" />
  <meta property="og:title" content="Enterprise GEO Platform" />
  <meta property="og:description" content="Real-time GEO readiness" />
  <meta property="og:image" content="https://rich.example/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="author" content="Keith S." />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Rich Co",
        url: "https://rich.example",
        logo: "https://rich.example/logo.png",
        sameAs: ["https://github.com/rich"],
        description: "GEO intelligence provider",
      },
      {
        "@type": "FAQPage",
        mainEntity: [{ "@type": "Question", name: "What is GEO?" }],
      },
    ],
  })}</script>
</head>
<body>
  <h1>Enterprise Generative Engine Optimization</h1>
  <p>Last updated <time datetime="2026-11-20">2026-11-20</time></p>
  <h2>How do AI search crawlers evaluate your technical architecture?</h2>
  <p>${"word ".repeat(220)}</p>
  <h2>What structured signals lift AI Overview citations?</h2>
  <ul><li>Valid JSON-LD @graph</li><li>Explicit OAI-SearchBot rules</li></ul>
  <table><tr><th>Metric</th><th>Target</th></tr><tr><td>TTFB</td><td>&lt;400ms</td></tr></table>
  <p>${"entity ".repeat(180)}</p>
  <a href="/contact">Contact</a>
  <a href="https://schema.org">Schema.org</a>
</body>
</html>`;

    const richAudit = analyzeHtmlPageAudit(
      makeResult("https://rich.example/platform", richHtml, 200, {
        "content-encoding": "br",
        "strict-transport-security": "max-age=31536000",
        "content-security-policy": "default-src 'self'",
      })
    );
    expect(richAudit.geoScore).toBeGreaterThanOrEqual(85);
    expect(["A", "B"]).toContain(richAudit.grade);
    expect(richAudit.directives.canonicalMatchesFinalUrl).toBe(true);
    expect(richAudit.structure.questionHeadingsCount).toBe(2);

    const schemaReport = analyzeHtmlSchemaCitations(
      makeResult("https://rich.example/platform", richHtml)
    );
    expect(schemaReport.detectedTypes).toContain("Organization");
    expect(schemaReport.detectedTypes).toContain("FAQPage");
    expect(schemaReport.schemaScore).toBeGreaterThanOrEqual(85);

    const poorHtml = `<!doctype html><html><head>
      <meta name="robots" content="noindex" />
      <script type="application/ld+json">{ broken json </script>
    </head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;

    const poorAudit = analyzeHtmlPageAudit(makeResult("https://poor.example/", poorHtml));
    expect(poorAudit.directives.noindexDetected).toBe(true);
    expect(poorAudit.structure.likelyClientSideEmptyShell).toBe(true);
    expect(poorAudit.geoScore).toBeLessThan(40);
    expect(poorAudit.iceActionPlan.length).toBeGreaterThan(2);

    const poorSchema = analyzeHtmlSchemaCitations(makeResult("https://poor.example/", poorHtml));
    expect(poorSchema.parseErrors.length).toBe(1);
    expect(poorSchema.recommendedJsonLdPatch["@context"]).toBe("https://schema.org");
  });

  it("compares target against competitors and tolerates partial upstream errors", async () => {
    const targetHtml = `<!doctype html><html lang="en"><head><title>Target Product</title><meta name="description" content="Target product description text spanning enough characters for search engines." /></head><body><h1>Target</h1><p>${"alpha ".repeat(120)}</p></body></html>`;
    const rivalHtml = `<!doctype html><html lang="en"><head><title>Rival Leader Platform for AI Citations</title><meta name="description" content="Comprehensive rival platform description exceeding minimum meta description recommendations." /><link rel="canonical" href="https://rival.example/" /><script type="application/ld+json">{"@type":"Organization","name":"Rival","url":"https://rival.example","logo":"https://rival.example/l.png","sameAs":["https://x.com/rival"],"description":"Leader"}</script></head><body><h1>Rival</h1><h2>Why choose Rival?</h2><ul><li>Fast</li></ul><p>${"content ".repeat(400)}</p></body></html>`;

    const fetchMock = async (url: string) => {
      if (url === "https://target.example/") return new Response(targetHtml, { status: 200 });
      if (url === "https://rival.example/") return new Response(rivalHtml, { status: 200 });
      if (url === "https://rival.example/llms.txt") {
        return new Response("# Rival\n> Leader\n\n## Links\n- [Docs](https://rival.example/d)\n- [Pricing](https://rival.example/p)\n- [Blog](https://rival.example/b)", { status: 200 });
      }
      if (url.startsWith("https://down.example/")) throw new Error("ECONNREFUSED");
      return new Response("Not Found", { status: 404 });
    };

    const comparison = await runCompetitorCompare(
      "https://target.example/",
      ["https://rival.example/", "https://down.example/"],
      { lookupFn: publicLookup, fetchFn: fetchMock }
    );

    expect(comparison.target.ok).toBe(true);
    expect(comparison.competitors[0].ok).toBe(true);
    expect(comparison.competitors[1].ok).toBe(false);
    expect(comparison.deltasVsCompetitorBest.geoScoreDelta).toBeLessThan(0);
    expect(comparison.gapsToClose.some((g) => g.includes("/llms.txt"))).toBe(true);
  });
});
