import { buildIceItem, sortIcePlan, type IceActionItem } from "./prompt";
import { safeFetchUrl, validatePublicHttpUrl, type SafeFetchOptions, type SafeFetchResult } from "./ssrf";

export const MONITORED_BOTS = [
  { name: "GPTBot", vendor: "OpenAI (Training)" },
  { name: "OAI-SearchBot", vendor: "OpenAI (Search)" },
  { name: "ChatGPT-User", vendor: "OpenAI (Live Browsing)" },
  { name: "ClaudeBot", vendor: "Anthropic (Training/Search)" },
  { name: "Claude-Web", vendor: "Anthropic (Live Retrieval)" },
  { name: "PerplexityBot", vendor: "Perplexity AI" },
  { name: "Google-Extended", vendor: "Google Gemini / AI Training" },
  { name: "Googlebot", vendor: "Google Search & AI Overviews" },
  { name: "Bingbot", vendor: "Bing & Copilot Search" },
  { name: "Applebot-Extended", vendor: "Apple Intelligence" },
  { name: "CCBot", vendor: "Common Crawl" },
  { name: "meta-externalagent", vendor: "Meta AI" },
] as const;

export type BotAccessStatus = "allowed" | "blocked_root" | "partial" | "no_explicit_rule";

export interface BotRuleVerdict {
  bot: string;
  vendor: string;
  status: BotAccessStatus;
  matchedUserAgent: string | null;
  disallowRules: string[];
  allowRules: string[];
}

export interface LlmsTxtReport {
  present: boolean;
  url: string;
  status: number | null;
  llmsFullPresent: boolean;
  hasH1Title: boolean;
  hasBlockquoteSummary: boolean;
  sectionCount: number;
  linkCount: number;
  charLength: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface WellKnownPresence {
  x402: { present: boolean; status: number | null };
  mcp: { present: boolean; status: number | null };
  agentCard: { present: boolean; status: number | null };
}

export interface AiCrawlerAuditResult {
  origin: string;
  auditedAt: string;
  robotsTxt: {
    present: boolean;
    url: string;
    status: number | null;
    sitemapsDeclared: string[];
    crawlDelaySeconds: number | null;
    botMatrix: BotRuleVerdict[];
  };
  llmsTxt: LlmsTxtReport;
  sitemapXml: {
    present: boolean;
    url: string;
    status: number | null;
    urlEntryEstimate: number;
  };
  wellKnown: WellKnownPresence;
  summary: {
    aiBotsAllowedOrOpen: number;
    aiBotsBlocked: number;
    aiBotsPartial: number;
    aiCrawlerReadinessScore: number;
    grade: "A" | "B" | "C" | "D" | "F";
  };
  iceActionPlan: IceActionItem[];
}

interface RobotsGroup {
  userAgents: string[];
  allows: string[];
  disallows: string[];
  crawlDelay: number | null;
}

export function parseRobotsTxt(raw: string): {
  groups: RobotsGroup[];
  sitemaps: string[];
} {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let seenRuleInCurrent = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const clean = rawLine.replace(/#.*$/, "").trim();
    if (!clean) {
      if (current && seenRuleInCurrent) {
        current = null;
        seenRuleInCurrent = false;
      }
      continue;
    }

    const sepIdx = clean.indexOf(":");
    if (sepIdx === -1) continue;
    const key = clean.slice(0, sepIdx).trim().toLowerCase();
    const val = clean.slice(sepIdx + 1).trim();

    if (key === "sitemap") {
      if (val) sitemaps.push(val);
      continue;
    }

    if (key === "user-agent") {
      if (!current || seenRuleInCurrent) {
        current = { userAgents: [], allows: [], disallows: [], crawlDelay: null };
        groups.push(current);
        seenRuleInCurrent = false;
      }
      if (val) current.userAgents.push(val.toLowerCase());
      continue;
    }

    if (!current) continue;
    seenRuleInCurrent = true;
    if (key === "disallow" && val !== "") {
      current.disallows.push(val);
    } else if (key === "allow" && val !== "") {
      current.allows.push(val);
    } else if (key === "crawl-delay") {
      const parsed = Number.parseFloat(val);
      if (!Number.isNaN(parsed)) current.crawlDelay = parsed;
    }
  }

  return { groups, sitemaps: Array.from(new Set(sitemaps)) };
}

function evaluateBotVerdict(
  botName: string,
  vendor: string,
  groups: RobotsGroup[]
): BotRuleVerdict {
  const lower = botName.toLowerCase();
  const exactGroups = groups.filter((g) => g.userAgents.includes(lower));
  const wildcardGroups = groups.filter((g) => g.userAgents.includes("*"));

  const matched = exactGroups.length > 0 ? exactGroups : wildcardGroups;
  const matchedUserAgent =
    exactGroups.length > 0 ? botName : wildcardGroups.length > 0 ? "*" : null;

  const disallows = matched.flatMap((g) => g.disallows);
  const allows = matched.flatMap((g) => g.allows);

  let status: BotAccessStatus = "no_explicit_rule";
  if (matchedUserAgent) {
    const blocksRoot = disallows.includes("/");
    const allowsRoot = allows.includes("/");
    if (blocksRoot && !allowsRoot) {
      status = "blocked_root";
    } else if (disallows.length > 0) {
      status = "partial";
    } else {
      status = "allowed";
    }
  }

  return {
    bot: botName,
    vendor,
    status,
    matchedUserAgent,
    disallowRules: disallows,
    allowRules: allows,
  };
}

export function analyzeLlmsTxt(
  url: string,
  res: SafeFetchResult | null,
  llmsFullPresent: boolean
): LlmsTxtReport {
  if (!res || !res.ok || res.status >= 400 || res.bodyText.trim().length < 10) {
    return {
      present: false,
      url,
      status: res?.status ?? null,
      llmsFullPresent,
      hasH1Title: false,
      hasBlockquoteSummary: false,
      sectionCount: 0,
      linkCount: 0,
      charLength: 0,
      grade: "F",
    };
  }

  const text = res.bodyText;
  const trimmed = text.trim();
  // Detect accidental HTML fallback pages served with 200 OK
  if (/^\s*<!doctype\s+html/i.test(trimmed) || /^\s*<html[\s>]/i.test(trimmed)) {
    return {
      present: false,
      url,
      status: res.status,
      llmsFullPresent,
      hasH1Title: false,
      hasBlockquoteSummary: false,
      sectionCount: 0,
      linkCount: 0,
      charLength: 0,
      grade: "F",
    };
  }

  const hasH1Title = /^#\s+.+/m.test(trimmed);
  const hasBlockquoteSummary = /^>\s+.+/m.test(trimmed);
  const sectionCount = (trimmed.match(/^##\s+.+/gm) ?? []).length;
  const linkCount = (trimmed.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? []).length;

  let points = 0;
  if (hasH1Title) points += 25;
  if (hasBlockquoteSummary) points += 25;
  if (sectionCount >= 1) points += 20;
  if (linkCount >= 3) points += 20;
  if (llmsFullPresent) points += 10;

  const grade =
    points >= 90 ? "A" : points >= 70 ? "B" : points >= 50 ? "C" : points >= 25 ? "D" : "F";

  return {
    present: true,
    url,
    status: res.status,
    llmsFullPresent,
    hasH1Title,
    hasBlockquoteSummary,
    sectionCount,
    linkCount,
    charLength: trimmed.length,
    grade,
  };
}

function gradeFromScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 88) return "A";
  if (score >= 74) return "B";
  if (score >= 58) return "C";
  if (score >= 40) return "D";
  return "F";
}

async function safeTryFetch(
  url: string,
  options: SafeFetchOptions
): Promise<SafeFetchResult | null> {
  try {
    return await safeFetchUrl(url, {
      ...options,
      maxBytes: 512 * 1024,
      acceptHeader: "text/plain,application/xml,application/json,text/markdown;q=0.9,*/*;q=0.5",
    });
  } catch {
    return null;
  }
}

export async function runAiCrawlerAudit(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<AiCrawlerAuditResult> {
  const parsed = await validatePublicHttpUrl(targetUrl, options.lookupFn);
  const origin = parsed.origin;

  const robotsUrl = `${origin}/robots.txt`;
  const llmsUrl = `${origin}/llms.txt`;
  const llmsFullUrl = `${origin}/llms-full.txt`;
  const sitemapUrl = `${origin}/sitemap.xml`;
  const x402Url = `${origin}/.well-known/x402`;
  const mcpUrl = `${origin}/.well-known/mcp`;
  const mcpCardUrl = `${origin}/.well-known/mcp/server-card.json`;
  const agentCardUrl = `${origin}/.well-known/agent-card.json`;

  const [robotsRes, llmsRes, llmsFullRes, sitemapRes, x402Res, mcpRes, mcpCardRes, agentCardRes] =
    await Promise.all([
      safeTryFetch(robotsUrl, options),
      safeTryFetch(llmsUrl, options),
      safeTryFetch(llmsFullUrl, options),
      safeTryFetch(sitemapUrl, options),
      safeTryFetch(x402Url, options),
      safeTryFetch(mcpUrl, options),
      safeTryFetch(mcpCardUrl, options),
      safeTryFetch(agentCardUrl, options),
    ]);

  const robotsPresent =
    Boolean(robotsRes && robotsRes.ok && !/^\s*<!doctype\s+html/i.test(robotsRes.bodyText));
  const parsedRobots = robotsPresent
    ? parseRobotsTxt(robotsRes!.bodyText)
    : { groups: [], sitemaps: [] };

  const botMatrix = MONITORED_BOTS.map(({ name, vendor }) =>
    evaluateBotVerdict(name, vendor, parsedRobots.groups)
  );
  const crawlDelays = parsedRobots.groups
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== null);

  const llmsFullPresent = Boolean(
    llmsFullRes &&
      llmsFullRes.ok &&
      llmsFullRes.bodyText.trim().length > 20 &&
      !/^\s*<!doctype\s+html/i.test(llmsFullRes.bodyText)
  );
  const llmsTxt = analyzeLlmsTxt(llmsUrl, llmsRes, llmsFullPresent);

  const sitemapPresent = Boolean(
    sitemapRes &&
      sitemapRes.ok &&
      /<(urlset|sitemapindex)\b/i.test(sitemapRes.bodyText)
  );
  const urlEntryEstimate = sitemapPresent
    ? (sitemapRes!.bodyText.match(/<(url|sitemap)\b/gi) ?? []).length
    : 0;

  const mcpPresent = Boolean((mcpRes && mcpRes.ok) || (mcpCardRes && mcpCardRes.ok));
  const mcpStatus = mcpRes?.ok ? mcpRes.status : mcpCardRes?.status ?? mcpRes?.status ?? null;

  const wellKnown: WellKnownPresence = {
    x402: { present: Boolean(x402Res && x402Res.ok), status: x402Res?.status ?? null },
    mcp: { present: mcpPresent, status: mcpStatus },
    agentCard: { present: Boolean(agentCardRes && agentCardRes.ok), status: agentCardRes?.status ?? null },
  };

  // Compute deterministic AI Crawler Readiness Score (0-100)
  const searchRetrievalBots = new Set([
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Googlebot",
    "Bingbot",
    "Claude-Web",
  ]);
  const blockedBots = botMatrix.filter((b) => b.status === "blocked_root");
  const blockedSearchBots = blockedBots.filter((b) => searchRetrievalBots.has(b.bot));
  const allowedOrOpenCount = botMatrix.filter(
    (b) => b.status === "allowed" || b.status === "no_explicit_rule"
  ).length;
  const partialCount = botMatrix.filter((b) => b.status === "partial").length;

  let score = 45; // baseline reachability
  if (robotsPresent) score += 10;
  if (sitemapPresent || parsedRobots.sitemaps.length > 0) score += 10;
  if (llmsTxt.present) score += 20;
  if (llmsTxt.hasH1Title && llmsTxt.hasBlockquoteSummary && llmsTxt.linkCount >= 3) score += 5;
  if (llmsFullPresent) score += 5;
  if (wellKnown.mcp.present || wellKnown.x402.present || wellKnown.agentCard.present) score += 5;

  score -= blockedSearchBots.length * 8;
  score -= Math.max(0, blockedBots.length - blockedSearchBots.length) * 3;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Deterministic ApexSEO Elite ICE Remediation Plan
  const iceItems: IceActionItem[] = [];
  if (!llmsTxt.present) {
    iceItems.push(
      buildIceItem({
        action: "Publish /llms.txt adhering to llmstxt.org spec (H1 title, blockquote summary, curated markdown links)",
        category: "AI-Crawler",
        impact: 9,
        confidence: 9,
        effort: 2,
        timeline: "Week 1 (1-2 hrs)",
        rationale: "Gives ChatGPT, Claude, and Perplexity deterministic entry points to core authoritative docs and pricing pages.",
      })
    );
  } else if (llmsTxt.grade !== "A") {
    iceItems.push(
      buildIceItem({
        action: "Upgrade /llms.txt structure with H1, blockquote summary, >=3 section links, and /llms-full.txt",
        category: "AI-Crawler",
        impact: 7,
        confidence: 8,
        effort: 2,
        timeline: "Week 1",
        rationale: `/llms.txt currently grades ${llmsTxt.grade} (${llmsTxt.linkCount} links). Structured sections raise retrieval accuracy.`,
      })
    );
  }

  if (blockedSearchBots.length > 0) {
    iceItems.push(
      buildIceItem({
        action: `Unblock AI live-search retrieval bots in robots.txt: ${blockedSearchBots.map((b) => b.bot).join(", ")}`,
        category: "AI-Crawler",
        impact: 10,
        confidence: 10,
        effort: 1,
        timeline: "Immediate (<30 min)",
        rationale: "Blocking search-time bots (OAI-SearchBot, PerplexityBot, ChatGPT-User) directly removes live AI citation eligibility even if training bots are restricted.",
      })
    );
  }

  if (!robotsPresent) {
    iceItems.push(
      buildIceItem({
        action: "Add explicit /robots.txt allowing Googlebot, Bingbot, OAI-SearchBot, PerplexityBot & referencing Sitemap",
        category: "AI-Crawler",
        impact: 8,
        confidence: 9,
        effort: 1,
        timeline: "Week 1",
        rationale: "Absence of robots.txt leaves crawl policies ambiguous and omits canonical Sitemap discovery.",
      })
    );
  }

  if (!sitemapPresent && parsedRobots.sitemaps.length === 0) {
    iceItems.push(
      buildIceItem({
        action: "Expose valid /sitemap.xml with lastmod timestamps and declare Sitemap: directive in /robots.txt",
        category: "Technical",
        impact: 8,
        confidence: 9,
        effort: 2,
        timeline: "Week 1",
        rationale: "Freshness timestamps (<lastmod>) and clean index coverage accelerate AI Overview and search indexation.",
      })
    );
  }

  if (!wellKnown.agentCard.present && !wellKnown.mcp.present) {
    iceItems.push(
      buildIceItem({
        action: "Publish /.well-known/agent-card.json or /.well-known/mcp discovery descriptor for autonomous agents",
        category: "AI-Crawler",
        impact: 6,
        confidence: 8,
        effort: 2,
        timeline: "Weeks 2-3",
        rationale: "Standardized /.well-known descriptors make domain services machine-discoverable to MCP/A2A agent registries.",
      })
    );
  }

  return {
    origin,
    auditedAt: new Date().toISOString(),
    robotsTxt: {
      present: robotsPresent,
      url: robotsUrl,
      status: robotsRes?.status ?? null,
      sitemapsDeclared: parsedRobots.sitemaps,
      crawlDelaySeconds: crawlDelays.length ? Math.max(...crawlDelays) : null,
      botMatrix,
    },
    llmsTxt,
    sitemapXml: {
      present: sitemapPresent,
      url: sitemapUrl,
      status: sitemapRes?.status ?? null,
      urlEntryEstimate,
    },
    wellKnown,
    summary: {
      aiBotsAllowedOrOpen: allowedOrOpenCount,
      aiBotsBlocked: blockedBots.length,
      aiBotsPartial: partialCount,
      aiCrawlerReadinessScore: score,
      grade: gradeFromScore(score),
    },
    iceActionPlan: sortIcePlan(iceItems),
  };
}
