import * as cheerio from "cheerio";
import { runAiCrawlerAudit, type AiCrawlerAuditResult } from "./crawler";
import { buildIceItem, sortIcePlan, type IceActionItem } from "./prompt";
import { safeFetchUrl, type RedirectHop, type SafeFetchOptions, type SafeFetchResult } from "./ssrf";

export interface SchemaNodeReport {
  index: number;
  types: string[];
  presentKeys: string[];
  missingRecommended: string[];
  rawSummary: Record<string, unknown>;
}

export interface SchemaCitationResult {
  requestedUrl: string;
  finalUrl: string;
  auditedAt: string;
  httpStatus: number;
  jsonLdBlockCount: number;
  parseErrors: string[];
  detectedTypes: string[];
  nodeReports: SchemaNodeReport[];
  socialFallback: {
    hasOgTitle: boolean;
    hasOgDescription: boolean;
    hasOgImage: boolean;
    hasTwitterCard: boolean;
  };
  schemaScore: number;
  citationReadiness: "high" | "moderate" | "low";
  recommendedJsonLdPatch: Record<string, unknown>;
  iceActionPlan: IceActionItem[];
}

export interface PageAuditResult {
  requestedUrl: string;
  finalUrl: string;
  origin: string;
  auditedAt: string;
  fetch: {
    status: number;
    ttfbMs: number;
    totalMs: number;
    byteLength: number;
    truncated: boolean;
    redirectCount: number;
    redirectChain: RedirectHop[];
    contentType: string | null;
    contentEncoding: string | null;
    cacheControl: string | null;
  };
  directives: {
    xRobotsTag: string | null;
    metaRobots: string | null;
    noindexDetected: boolean;
    nofollowDetected: boolean;
    canonicalUrl: string | null;
    canonicalMatchesFinalUrl: boolean;
    htmlLang: string | null;
    hreflangAlternates: Array<{ lang: string; href: string }>;
  };
  securityHeaders: {
    strictTransportSecurity: boolean;
    contentSecurityPolicy: boolean;
    xContentTypeOptions: boolean;
    xFrameOptions: boolean;
  };
  metadata: {
    title: string | null;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionLength: number;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    ogType: string | null;
    twitterCard: string | null;
  };
  structure: {
    h1Count: number;
    h1Texts: string[];
    h2Count: number;
    h3Count: number;
    questionHeadingsCount: number;
    wordCount: number;
    paragraphCount: number;
    listCount: number;
    tableCount: number;
    likelyClientSideEmptyShell: boolean;
  };
  mediaAndLinks: {
    imageCount: number;
    imagesMissingAlt: number;
    altCoveragePct: number;
    internalLinkCount: number;
    externalLinkCount: number;
    nofollowLinkCount: number;
  };
  eeatSignals: {
    hasAuthorSignal: boolean;
    hasModifiedDateSignal: boolean;
    hasContactOrLegalLink: boolean;
    jsonLdTypes: string[];
  };
  subscores: {
    indexabilityAndDirectives: number;
    technicalSpeedAndSecurity: number;
    contentAndAiStructure: number;
    entityAndSchemaSignals: number;
    eeatAndFreshness: number;
  };
  geoScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  iceActionPlan: IceActionItem[];
}

export interface CompetitorSnapshot {
  url: string;
  ok: boolean;
  error?: string;
  geoScore?: number;
  grade?: string;
  ttfbMs?: number;
  wordCount?: number;
  questionHeadingsCount?: number;
  structuredElementsCount?: number;
  schemaTypesCount?: number;
  aiCrawlerScore?: number;
  llmsTxtPresent?: boolean;
  aiBotsBlocked?: number;
}

export interface CompetitorCompareResult {
  auditedAt: string;
  target: CompetitorSnapshot;
  competitors: CompetitorSnapshot[];
  deltasVsCompetitorBest: {
    geoScoreDelta: number | null;
    aiCrawlerScoreDelta: number | null;
    ttfbDeltaMs: number | null;
    wordCountDelta: number | null;
    schemaTypesDelta: number | null;
  };
  gapsToClose: string[];
  advantagesToPress: string[];
  iceActionPlan: IceActionItem[];
}

const SCHEMA_REQUIREMENTS: Record<string, string[][]> = {
  Organization: [["name"], ["url"], ["logo"], ["sameAs"], ["description", "contactPoint", "email"]],
  WebSite: [["name"], ["url"], ["publisher", "potentialAction"]],
  SoftwareApplication: [
    ["name"],
    ["applicationCategory"],
    ["operatingSystem"],
    ["offers"],
    ["description"],
    ["url"],
  ],
  Product: [["name"], ["description"], ["image"], ["offers"], ["brand", "aggregateRating"]],
  Article: [["headline"], ["author"], ["datePublished"], ["dateModified"], ["publisher"], ["image"]],
  BlogPosting: [["headline"], ["author"], ["datePublished"], ["dateModified"], ["publisher"], ["image"]],
  NewsArticle: [["headline"], ["author"], ["datePublished"], ["dateModified"], ["publisher"], ["image"]],
  TechArticle: [["headline"], ["author"], ["datePublished"], ["dateModified"], ["publisher"]],
  FAQPage: [["mainEntity"]],
  WebPage: [["name"], ["url"], ["description"], ["isPartOf", "breadcrumb"]],
};

const QUESTION_HEADING_RE =
  /(\?$|\b(who|what|why|how|when|where|which|can|does|is|are|should|vs\.?|versus|best|pricing)\b)/i;

function gradeFromScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 88) return "A";
  if (score >= 74) return "B";
  if (score >= 58) return "C";
  if (score >= 40) return "D";
  return "F";
}

function flattenJsonLdNodes(value: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLdNodes(item, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      flattenJsonLdNodes(obj["@graph"], acc);
    }
    if (obj["@type"] !== undefined) {
      acc.push(obj);
    }
  }
  return acc;
}

export function extractJsonLdFromHtml($: cheerio.CheerioAPI): {
  blockCount: number;
  parseErrors: string[];
  nodes: Record<string, unknown>[];
  detectedTypes: string[];
} {
  const scripts = $('script[type="application/ld+json"]');
  const parseErrors: string[] = [];
  const nodes: Record<string, unknown>[] = [];

  scripts.each((idx, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    const cleaned = raw.replace(/^<!--/, "").replace(/-->$/, "").trim();
    try {
      const parsed: unknown = JSON.parse(cleaned);
      flattenJsonLdNodes(parsed, nodes);
    } catch (err) {
      parseErrors.push(
        `Block #${idx + 1}: ${err instanceof Error ? err.message : "Invalid JSON-LD syntax"}`
      );
    }
  });

  const typeSet = new Set<string>();
  for (const node of nodes) {
    const t = node["@type"];
    if (typeof t === "string") typeSet.add(t);
    else if (Array.isArray(t)) {
      for (const item of t) if (typeof item === "string") typeSet.add(item);
    }
  }

  return {
    blockCount: scripts.length,
    parseErrors,
    nodes,
    detectedTypes: Array.from(typeSet),
  };
}

function getMetaContent($: cheerio.CheerioAPI, selector: string): string | null {
  const val = $(selector).first().attr("content")?.trim();
  return val && val.length > 0 ? val : null;
}

function normalizeUrlComparison(a: string | null, b: string): boolean {
  if (!a) return false;
  try {
    const ua = new URL(a, b);
    const ub = new URL(b);
    return (
      ua.origin === ub.origin &&
      ua.pathname.replace(/\/+$/, "") === ub.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

export function analyzeHtmlSchemaCitations(res: SafeFetchResult): SchemaCitationResult {
  const $ = cheerio.load(res.bodyText);
  const { blockCount, parseErrors, nodes, detectedTypes } = extractJsonLdFromHtml($);

  const nodeReports: SchemaNodeReport[] = nodes.map((node, index) => {
    const rawType = node["@type"];
    const types = Array.isArray(rawType)
      ? rawType.filter((x): x is string => typeof x === "string")
      : typeof rawType === "string"
        ? [rawType]
        : [];
    const presentKeys = Object.keys(node).filter(
      (k) => node[k] !== null && node[k] !== undefined && node[k] !== ""
    );

    const missingSet = new Set<string>();
    for (const typeName of types) {
      const reqGroups = SCHEMA_REQUIREMENTS[typeName];
      if (!reqGroups) continue;
      for (const group of reqGroups) {
        const hasAny = group.some((field) => presentKeys.includes(field));
        if (!hasAny) missingSet.add(group.join(" or "));
      }
    }

    return {
      index,
      types,
      presentKeys,
      missingRecommended: Array.from(missingSet),
      rawSummary: {
        name: node.name ?? node.headline ?? null,
        url: node.url ?? null,
      },
    };
  });

  const title = $("title").first().text().trim() || "Brand / Page Title";
  const description =
    getMetaContent($, 'meta[name="description"]') ||
    getMetaContent($, 'meta[property="og:description"]') ||
    "Concise entity description for AI citation extraction.";
  const ogImage = getMetaContent($, 'meta[property="og:image"]');
  const canonical = $('link[rel="canonical"]').first().attr("href")?.trim() || res.finalUrl;
  const origin = new URL(res.finalUrl).origin;

  const hasOgTitle = Boolean(getMetaContent($, 'meta[property="og:title"]'));
  const hasOgDescription = Boolean(getMetaContent($, 'meta[property="og:description"]'));
  const hasOgImage = Boolean(ogImage);
  const hasTwitterCard = Boolean(getMetaContent($, 'meta[name="twitter:card"]'));

  let score = 15; // baseline HTML reachability
  if (blockCount > 0) score += 25;
  if (parseErrors.length === 0 && blockCount > 0) score += 10;
  if (detectedTypes.length >= 2) score += 15;
  else if (detectedTypes.length === 1) score += 8;

  const totalMissing = nodeReports.reduce((acc, n) => acc + n.missingRecommended.length, 0);
  if (nodeReports.length > 0) {
    score += Math.max(0, 25 - totalMissing * 4);
  }
  if (hasOgTitle && hasOgDescription && hasOgImage) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const citationReadiness = score >= 78 ? "high" : score >= 50 ? "moderate" : "low";

  const recommendedJsonLdPatch: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: title.split(/[|\-–:]/)[0]?.trim() || title,
        url: origin,
        sameAs: [],
        ...(ogImage ? { logo: ogImage } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: title,
        publisher: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description,
        isPartOf: { "@id": `${origin}/#website` },
        dateModified: new Date().toISOString().slice(0, 10),
      },
    ],
  };

  const iceItems: IceActionItem[] = [];
  if (parseErrors.length > 0) {
    iceItems.push(
      buildIceItem({
        action: `Fix ${parseErrors.length} invalid JSON-LD syntax error(s) in script[type="application/ld+json"]`,
        category: "Schema/Entity",
        impact: 10,
        confidence: 10,
        effort: 1,
        timeline: "Immediate",
        rationale: "Syntax errors cause Google and AI knowledge extractors to discard the entire JSON-LD block.",
      })
    );
  }
  if (blockCount === 0) {
    iceItems.push(
      buildIceItem({
        action: "Deploy recommendedJsonLdPatch (@graph Organization + WebSite + WebPage entity linking)",
        category: "Schema/Entity",
        impact: 9,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "Zero JSON-LD entities found. Connected @graph schema anchors brand identity inside AI Overviews & Perplexity.",
      })
    );
  } else if (totalMissing > 0) {
    iceItems.push(
      buildIceItem({
        action: `Populate ${totalMissing} missing citation property gap(s) across existing JSON-LD entities (e.g. sameAs, dateModified, author/publisher)`,
        category: "Schema/Entity",
        impact: 8,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "Rich entity disambiguation properties (sameAs, dateModified, offers, mainEntity) lift AI answer citation probability.",
      })
    );
  }
  if (!hasOgTitle || !hasOgDescription || !hasOgImage) {
    iceItems.push(
      buildIceItem({
        action: "Complete OpenGraph tags (og:title, og:description, og:image) for social/AI preview grounding",
        category: "GEO/Content",
        impact: 6,
        confidence: 9,
        effort: 1,
        timeline: "Week 1",
        rationale: "AI browsers and link-preview agents fall back to OpenGraph metadata when summarizing citations.",
      })
    );
  }

  return {
    requestedUrl: res.requestedUrl,
    finalUrl: res.finalUrl,
    auditedAt: new Date().toISOString(),
    httpStatus: res.status,
    jsonLdBlockCount: blockCount,
    parseErrors,
    detectedTypes,
    nodeReports,
    socialFallback: { hasOgTitle, hasOgDescription, hasOgImage, hasTwitterCard },
    schemaScore: score,
    citationReadiness,
    recommendedJsonLdPatch,
    iceActionPlan: sortIcePlan(iceItems),
  };
}

export function analyzeHtmlPageAudit(res: SafeFetchResult): PageAuditResult {
  const $ = cheerio.load(res.bodyText);
  const origin = new URL(res.finalUrl).origin;

  const xRobotsTag = res.headers["x-robots-tag"] ?? null;
  const metaRobots =
    getMetaContent($, 'meta[name="robots"]') || getMetaContent($, 'meta[name="googlebot"]');
  const combinedRobots = `${xRobotsTag ?? ""} ${metaRobots ?? ""}`.toLowerCase();
  const noindexDetected = /\bnoindex\b/i.test(combinedRobots);
  const nofollowDetected = /\bnofollow\b/i.test(combinedRobots);

  const canonicalRaw = $('link[rel="canonical"]').first().attr("href")?.trim() || null;
  const canonicalUrl = canonicalRaw ? new URL(canonicalRaw, res.finalUrl).toString() : null;
  const canonicalMatchesFinalUrl = normalizeUrlComparison(canonicalUrl, res.finalUrl);
  const htmlLang = $("html").first().attr("lang")?.trim() || null;

  const hreflangAlternates: Array<{ lang: string; href: string }> = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang")?.trim();
    const href = $(el).attr("href")?.trim();
    if (lang && href) hreflangAlternates.push({ lang, href });
  });

  const title = $("title").first().text().trim() || null;
  const metaDescription = getMetaContent($, 'meta[name="description"]');
  const ogTitle = getMetaContent($, 'meta[property="og:title"]');
  const ogDescription = getMetaContent($, 'meta[property="og:description"]');
  const ogImage = getMetaContent($, 'meta[property="og:image"]');
  const ogType = getMetaContent($, 'meta[property="og:type"]');
  const twitterCard = getMetaContent($, 'meta[name="twitter:card"]');

  const h1Els = $("h1");
  const h1Texts = h1Els
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, 5);
  const h2Count = $("h2").length;
  const h3Count = $("h3").length;

  let questionHeadingsCount = 0;
  $("h1, h2, h3").each((_, el) => {
    const txt = $(el).text().trim();
    if (QUESTION_HEADING_RE.test(txt)) questionHeadingsCount += 1;
  });

  // Extract visible word count after stripping non-content tags
  const bodyClone = $("body").clone();
  bodyClone.find("script, style, noscript, svg, template").remove();
  const visibleText = bodyClone.text().replace(/\s+/g, " ").trim();
  const words = visibleText ? visibleText.split(" ").filter(Boolean) : [];
  const wordCount = words.length;
  const paragraphCount = $("p").length;
  const listCount = $("ul, ol").length;
  const tableCount = $("table").length;
  const likelyClientSideEmptyShell =
    res.ok && wordCount < 60 && (/<script\b/i.test(res.bodyText) || $("#root, #__next, #app").length > 0);

  // Media and links
  const imgs = $("img");
  let imagesMissingAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") imagesMissingAlt += 1;
  });
  const imageCount = imgs.length;
  const altCoveragePct =
    imageCount === 0 ? 100 : Math.round(((imageCount - imagesMissingAlt) / imageCount) * 100);

  let internalLinkCount = 0;
  let externalLinkCount = 0;
  let nofollowLinkCount = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (rel.includes("nofollow")) nofollowLinkCount += 1;
    try {
      const resolved = new URL(href, res.finalUrl);
      if (resolved.origin === origin) internalLinkCount += 1;
      else externalLinkCount += 1;
    } catch {
      // ignore malformed href
    }
  });

  // E-E-A-T and schema
  const jsonLd = extractJsonLdFromHtml($);
  const hasAuthorSignal = Boolean(
    getMetaContent($, 'meta[name="author"]') ||
      $('[rel="author"], [itemprop="author"], .author, .byline').length > 0 ||
      jsonLd.nodes.some((n) => Boolean(n.author))
  );
  const hasModifiedDateSignal = Boolean(
    getMetaContent($, 'meta[property="article:modified_time"]') ||
      getMetaContent($, 'meta[name="last-modified"]') ||
      $("time[datetime]").length > 0 ||
      jsonLd.nodes.some((n) => Boolean(n.dateModified || n.datePublished))
  );
  const hasContactOrLegalLink =
    $("a[href]").filter((_, el) => {
      const h = ($(el).attr("href") ?? "").toLowerCase();
      return /\/(about|contact|privacy|terms|security|team|author)\b/.test(h);
    }).length > 0;

  const securityHeaders = {
    strictTransportSecurity: Boolean(res.headers["strict-transport-security"]),
    contentSecurityPolicy: Boolean(res.headers["content-security-policy"]),
    xContentTypeOptions: Boolean(res.headers["x-content-type-options"]),
    xFrameOptions: Boolean(res.headers["x-frame-options"]),
  };

  // Transparent deterministic subscores (each 0-100)
  let indexScore = res.ok ? 40 : 0;
  if (!noindexDetected) indexScore += 30;
  if (canonicalUrl) indexScore += 15;
  if (canonicalMatchesFinalUrl) indexScore += 10;
  if (htmlLang) indexScore += 5;

  let techScore = 30;
  if (res.finalUrl.startsWith("https://")) techScore += 15;
  if (res.ttfbMs <= 400) techScore += 25;
  else if (res.ttfbMs <= 900) techScore += 15;
  else if (res.ttfbMs <= 1800) techScore += 6;
  if (res.redirectChain.length === 0) techScore += 10;
  else if (res.redirectChain.length === 1) techScore += 5;
  if (res.headers["content-encoding"]) techScore += 5;
  const secCount = Object.values(securityHeaders).filter(Boolean).length;
  techScore += Math.min(15, secCount * 4);

  let contentScore = 10;
  if (title && title.length >= 25 && title.length <= 68) contentScore += 15;
  else if (title) contentScore += 7;
  if (metaDescription && metaDescription.length >= 90 && metaDescription.length <= 165) contentScore += 15;
  else if (metaDescription) contentScore += 7;
  if (h1Els.length === 1) contentScore += 12;
  else if (h1Els.length > 1) contentScore += 5;
  if (h2Count >= 2) contentScore += 10;
  if (questionHeadingsCount >= 1) contentScore += 10;
  if (wordCount >= 350) contentScore += 15;
  else if (wordCount >= 150) contentScore += 8;
  if (listCount + tableCount >= 1) contentScore += 8;
  if (altCoveragePct >= 90) contentScore += 5;
  if (likelyClientSideEmptyShell) contentScore = Math.max(0, contentScore - 25);

  let entityScore = 10;
  if (jsonLd.blockCount > 0 && jsonLd.parseErrors.length === 0) entityScore += 45;
  if (jsonLd.detectedTypes.length >= 2) entityScore += 20;
  if (ogTitle && ogDescription) entityScore += 15;
  if (ogImage && twitterCard) entityScore += 10;

  let eeatScore = 20;
  if (hasAuthorSignal) eeatScore += 25;
  if (hasModifiedDateSignal) eeatScore += 25;
  if (hasContactOrLegalLink) eeatScore += 20;
  if (externalLinkCount >= 1) eeatScore += 10;

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const subscores = {
    indexabilityAndDirectives: clamp(indexScore),
    technicalSpeedAndSecurity: clamp(techScore),
    contentAndAiStructure: clamp(contentScore),
    entityAndSchemaSignals: clamp(entityScore),
    eeatAndFreshness: clamp(eeatScore),
  };

  const geoScore = Math.round(
    subscores.indexabilityAndDirectives * 0.2 +
      subscores.technicalSpeedAndSecurity * 0.2 +
      subscores.contentAndAiStructure * 0.3 +
      subscores.entityAndSchemaSignals * 0.15 +
      subscores.eeatAndFreshness * 0.15
  );

  // Build ApexSEO Elite ICE plan
  const ice: IceActionItem[] = [];
  if (noindexDetected) {
    ice.push(
      buildIceItem({
        action: "Remove unintended noindex directive from meta robots / X-Robots-Tag",
        category: "Technical",
        impact: 10,
        confidence: 10,
        effort: 1,
        timeline: "Immediate",
        rationale: "noindex completely excludes the page from Google Search and AI Overviews grounding.",
      })
    );
  }
  if (likelyClientSideEmptyShell) {
    ice.push(
      buildIceItem({
        action: "Enable SSR/SSG pre-rendering for primary landing content (currently renders empty client shell <60 words)",
        category: "Technical",
        impact: 10,
        confidence: 9,
        effort: 5,
        timeline: "Sprint 1",
        rationale: "AI retrieval bots (GPTBot, ClaudeBot, PerplexityBot) mostly skip heavy client-side JS execution.",
      })
    );
  }
  if (jsonLd.blockCount === 0) {
    ice.push(
      buildIceItem({
        action: "Embed Organization + WebPage/Product JSON-LD structured data for AI citation grounding",
        category: "Schema/Entity",
        impact: 9,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "Structured entities disambiguate brand facts for generative search answers.",
      })
    );
  }
  if (!canonicalUrl || !canonicalMatchesFinalUrl) {
    ice.push(
      buildIceItem({
        action: "Add self-referencing <link rel=\"canonical\"> matching final resolved URL",
        category: "Technical",
        impact: 8,
        confidence: 9,
        effort: 1,
        timeline: "Week 1",
        rationale: "Prevents URL parameter / trailing-slash fragmentation from diluting citation authority.",
      })
    );
  }
  if (questionHeadingsCount === 0) {
    ice.push(
      buildIceItem({
        action: "Reframe 2-4 H2/H3 subheadings as direct searcher questions paired with concise 40-60 word answer blocks + comparison table",
        category: "GEO/Content",
        impact: 8,
        confidence: 8,
        effort: 2,
        timeline: "Week 1",
        rationale: "Question-answer heading pairs and HTML tables are disproportionately extracted verbatim into AI Overviews and Perplexity answers.",
      })
    );
  }
  if (!hasAuthorSignal || !hasModifiedDateSignal) {
    ice.push(
      buildIceItem({
        action: "Surface explicit author attribution, credentials, and visible dateModified timestamp (schema + HTML)",
        category: "E-E-A-T",
        impact: 7,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "2026 Core Quality & E-E-A-T models reward verifiable authorship and freshness metadata.",
      })
    );
  }
  if (res.ttfbMs > 800) {
    ice.push(
      buildIceItem({
        action: `Reduce HTML TTFB from ${res.ttfbMs}ms to <400ms via edge caching / CDN stale-while-revalidate`,
        category: "Technical",
        impact: 7,
        confidence: 9,
        effort: 3,
        timeline: "Weeks 1-2",
        rationale: "Faster server response improves composite Core Web Vitals (LCP/INP) and crawler budget efficiency.",
      })
    );
  }
  if (!metaDescription || !title) {
    ice.push(
      buildIceItem({
        action: "Craft unique primary-intent <title> (50-60 chars) and compelling <meta name=\"description\"> (130-155 chars)",
        category: "GEO/Content",
        impact: 8,
        confidence: 9,
        effort: 1,
        timeline: "Immediate",
        rationale: "Title and meta description establish primary topical relevance and SERP/AI citation snippet framing.",
      })
    );
  }

  return {
    requestedUrl: res.requestedUrl,
    finalUrl: res.finalUrl,
    origin,
    auditedAt: new Date().toISOString(),
    fetch: {
      status: res.status,
      ttfbMs: res.ttfbMs,
      totalMs: res.totalMs,
      byteLength: res.byteLength,
      truncated: res.truncated,
      redirectCount: res.redirectChain.length,
      redirectChain: res.redirectChain,
      contentType: res.headers["content-type"] ?? null,
      contentEncoding: res.headers["content-encoding"] ?? null,
      cacheControl: res.headers["cache-control"] ?? null,
    },
    directives: {
      xRobotsTag,
      metaRobots,
      noindexDetected,
      nofollowDetected,
      canonicalUrl,
      canonicalMatchesFinalUrl,
      htmlLang,
      hreflangAlternates,
    },
    securityHeaders,
    metadata: {
      title,
      titleLength: title?.length ?? 0,
      metaDescription,
      metaDescriptionLength: metaDescription?.length ?? 0,
      ogTitle,
      ogDescription,
      ogImage,
      ogType,
      twitterCard,
    },
    structure: {
      h1Count: h1Els.length,
      h1Texts,
      h2Count,
      h3Count,
      questionHeadingsCount,
      wordCount,
      paragraphCount,
      listCount,
      tableCount,
      likelyClientSideEmptyShell,
    },
    mediaAndLinks: {
      imageCount,
      imagesMissingAlt,
      altCoveragePct,
      internalLinkCount,
      externalLinkCount,
      nofollowLinkCount,
    },
    eeatSignals: {
      hasAuthorSignal,
      hasModifiedDateSignal,
      hasContactOrLegalLink,
      jsonLdTypes: jsonLd.detectedTypes,
    },
    subscores,
    geoScore,
    grade: gradeFromScore(geoScore),
    iceActionPlan: sortIcePlan(ice),
  };
}

export async function runSchemaCitationCheck(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<SchemaCitationResult> {
  const res = await safeFetchUrl(targetUrl, options);
  return analyzeHtmlSchemaCitations(res);
}

export async function runGeoPageAudit(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<PageAuditResult> {
  const res = await safeFetchUrl(targetUrl, options);
  return analyzeHtmlPageAudit(res);
}

async function auditOneDomainSnapshot(
  url: string,
  options: SafeFetchOptions
): Promise<CompetitorSnapshot> {
  const [pageSettled, crawlerSettled] = await Promise.allSettled([
    runGeoPageAudit(url, options),
    runAiCrawlerAudit(url, options),
  ]);

  if (pageSettled.status === "rejected") {
    return {
      url,
      ok: false,
      error:
        pageSettled.reason instanceof Error
          ? pageSettled.reason.message
          : String(pageSettled.reason),
    };
  }

  const p = pageSettled.value;
  const c: AiCrawlerAuditResult | null =
    crawlerSettled.status === "fulfilled" ? crawlerSettled.value : null;

  return {
    url: p.finalUrl,
    ok: true,
    geoScore: p.geoScore,
    grade: p.grade,
    ttfbMs: p.fetch.ttfbMs,
    wordCount: p.structure.wordCount,
    questionHeadingsCount: p.structure.questionHeadingsCount,
    structuredElementsCount: p.structure.listCount + p.structure.tableCount,
    schemaTypesCount: p.eeatSignals.jsonLdTypes.length,
    aiCrawlerScore: c?.summary.aiCrawlerReadinessScore,
    llmsTxtPresent: c?.llmsTxt.present,
    aiBotsBlocked: c?.summary.aiBotsBlocked,
  };
}

export async function runCompetitorCompare(
  targetUrl: string,
  competitorUrls: string[],
  options: SafeFetchOptions = {}
): Promise<CompetitorCompareResult> {
  const uniqueCompetitors = Array.from(new Set(competitorUrls.map((u) => u.trim()).filter(Boolean))).slice(
    0,
    3
  );

  const [target, ...competitors] = await Promise.all([
    auditOneDomainSnapshot(targetUrl, options),
    ...uniqueCompetitors.map((u) => auditOneDomainSnapshot(u, options)),
  ]);

  const validComps = competitors.filter((c) => c.ok);
  type NumericSnapshotField =
    | "geoScore"
    | "aiCrawlerScore"
    | "ttfbMs"
    | "wordCount"
    | "schemaTypesCount";
  const maxComp = (key: NumericSnapshotField): number | null => {
    const vals: number[] = [];
    for (const c of validComps) {
      const v = c[key];
      if (typeof v === "number") vals.push(v);
    }
    return vals.length ? Math.max(...vals) : null;
  };
  const minComp = (key: NumericSnapshotField): number | null => {
    const vals: number[] = [];
    for (const c of validComps) {
      const v = c[key];
      if (typeof v === "number") vals.push(v);
    }
    return vals.length ? Math.min(...vals) : null;
  };

  const bestCompGeo = maxComp("geoScore");
  const bestCompCrawler = maxComp("aiCrawlerScore");
  const fastestCompTtfb = minComp("ttfbMs");
  const maxCompWords = maxComp("wordCount");
  const maxCompSchema = maxComp("schemaTypesCount");

  const deltasVsCompetitorBest = {
    geoScoreDelta:
      target.geoScore !== undefined && bestCompGeo !== null ? target.geoScore - bestCompGeo : null,
    aiCrawlerScoreDelta:
      target.aiCrawlerScore !== undefined && bestCompCrawler !== null
        ? target.aiCrawlerScore - bestCompCrawler
        : null,
    ttfbDeltaMs:
      target.ttfbMs !== undefined && fastestCompTtfb !== null ? target.ttfbMs - fastestCompTtfb : null,
    wordCountDelta:
      target.wordCount !== undefined && maxCompWords !== null ? target.wordCount - maxCompWords : null,
    schemaTypesDelta:
      target.schemaTypesCount !== undefined && maxCompSchema !== null
        ? target.schemaTypesCount - maxCompSchema
        : null,
  };

  const gapsToClose: string[] = [];
  const advantagesToPress: string[] = [];
  const ice: IceActionItem[] = [];

  if (
    deltasVsCompetitorBest.geoScoreDelta !== null &&
    deltasVsCompetitorBest.geoScoreDelta < 0
  ) {
    gapsToClose.push(
      `Target trails top competitor GEO score by ${Math.abs(deltasVsCompetitorBest.geoScoreDelta)} pts`
    );
    ice.push(
      buildIceItem({
        action: `Close ${Math.abs(deltasVsCompetitorBest.geoScoreDelta)}-pt GEO readiness gap via question headings, schema entities, and E-E-A-T freshness`,
        category: "Competitive",
        impact: 9,
        confidence: 9,
        effort: 3,
        timeline: "Weeks 1-2",
        rationale: "Matching or exceeding competitor page structure + entity density captures shared AI citation slots.",
      })
    );
  } else if (
    deltasVsCompetitorBest.geoScoreDelta !== null &&
    deltasVsCompetitorBest.geoScoreDelta > 0
  ) {
    advantagesToPress.push(
      `Target leads all audited competitors in GEO score by +${deltasVsCompetitorBest.geoScoreDelta} pts`
    );
  }

  const compsWithLlms = validComps.filter((c) => c.llmsTxtPresent);
  if (!target.llmsTxtPresent && compsWithLlms.length > 0) {
    gapsToClose.push(
      `${compsWithLlms.length} competitor(s) already ship /llms.txt while target lacks one`
    );
    ice.push(
      buildIceItem({
        action: "Publish /llms.txt immediately to eliminate competitor AI-retrieval discovery edge",
        category: "AI-Crawler",
        impact: 9,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "Competitors expose curated /llms.txt links while your domain relies on generic crawling.",
      })
    );
  } else if (target.llmsTxtPresent && compsWithLlms.length === 0 && validComps.length > 0) {
    advantagesToPress.push("Target publishes /llms.txt while zero audited competitors do");
  }

  const compsBlockingAi = validComps.filter((c) => (c.aiBotsBlocked ?? 0) > 0);
  if (compsBlockingAi.length > 0 && (target.aiBotsBlocked ?? 0) === 0) {
    advantagesToPress.push(
      `${compsBlockingAi.length} competitor(s) accidentally block AI crawlers in robots.txt — press citation advantage on head comparison queries`
    );
  }

  if (deltasVsCompetitorBest.schemaTypesDelta !== null && deltasVsCompetitorBest.schemaTypesDelta < 0) {
    gapsToClose.push(
      `Competitors expose ${Math.abs(deltasVsCompetitorBest.schemaTypesDelta)} more Schema.org @type(s)`
    );
    ice.push(
      buildIceItem({
        action: "Expand JSON-LD @graph (FAQPage, SoftwareApplication/Product, Organization) to surpass competitor schema depth",
        category: "Schema/Entity",
        impact: 8,
        confidence: 8,
        effort: 2,
        timeline: "Week 1",
        rationale: "Richer Schema.org entity graphs increase eligibility for rich AI Overviews citations.",
      })
    );
  }

  return {
    auditedAt: new Date().toISOString(),
    target,
    competitors,
    deltasVsCompetitorBest,
    gapsToClose,
    advantagesToPress,
    iceActionPlan: sortIcePlan(ice),
  };
}
