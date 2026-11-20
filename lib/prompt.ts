import apexseoAgent from "../data/apexseo-elite.json";

export type ActivationMode =
  | "FULL_SITE_AUDIT"
  | "STRATEGY_ROADMAP"
  | "KEYWORD_INTENT_UNIVERSE"
  | "CONTENT_GAP_BRIEF"
  | "AI_OVERVIEW_OPTIMIZATION"
  | "TECHNICAL_REMEDIATION"
  | "COMPETITOR_DOMINATION_ANALYSIS"
  | "MONTHLY_PULSE_REVIEW";

export interface IceActionItem {
  action: string;
  category: "AI-Crawler" | "Technical" | "Schema/Entity" | "GEO/Content" | "E-E-A-T" | "Competitive";
  impact: number; // 1-10
  confidence: number; // 1-10
  effort: number; // 1-10 (1 = quick win)
  iceScore: number; // round((impact * confidence) / effort, 1)
  timeline: string;
  rationale: string;
}

export const APEXSEO_ELITE_METADATA = {
  id: apexseoAgent.id,
  name: apexseoAgent.name,
  version: "v2026.6",
  class: apexseoAgent.class,
  performative: apexseoAgent.performative,
  inject: apexseoAgent.inject,
  heat: apexseoAgent.heat,
  sourceRepo: "kwizzlesurp10-ctrl/swarmscribe-qma2",
  sourceBranch: "add-grok-prompts-2026-11",
} as const;

export const APEXSEO_ELITE_PROMPT: string = apexseoAgent.prompt;

export const ACTIVATION_MODES: readonly ActivationMode[] = [
  "FULL_SITE_AUDIT",
  "AI_OVERVIEW_OPTIMIZATION",
  "TECHNICAL_REMEDIATION",
  "COMPETITOR_DOMINATION_ANALYSIS",
  "CONTENT_GAP_BRIEF",
  "KEYWORD_INTENT_UNIVERSE",
  "STRATEGY_ROADMAP",
  "MONTHLY_PULSE_REVIEW",
];

export function buildIceItem(params: {
  action: string;
  category: IceActionItem["category"];
  impact: number;
  confidence: number;
  effort: number;
  timeline: string;
  rationale: string;
}): IceActionItem {
  const safeEffort = Math.max(1, Math.min(10, params.effort));
  const impact = Math.max(1, Math.min(10, params.impact));
  const confidence = Math.max(1, Math.min(10, params.confidence));
  const iceScore = Math.round(((impact * confidence) / safeEffort) * 10) / 10;
  return {
    action: params.action,
    category: params.category,
    impact,
    confidence,
    effort: safeEffort,
    iceScore,
    timeline: params.timeline,
    rationale: params.rationale,
  };
}

export function sortIcePlan(items: IceActionItem[]): IceActionItem[] {
  return [...items].sort((a, b) => b.iceScore - a.iceScore || b.impact - a.impact);
}

export function renderApexSeoPromptMessage(options?: {
  targetUrl?: string;
  mode?: ActivationMode;
  focus?: string;
}): string {
  const lines = [APEXSEO_ELITE_PROMPT];
  if (options?.mode || options?.targetUrl || options?.focus) {
    lines.push("\n---\n## Active Session Parameters");
    if (options.mode) lines.push(`- Activation Mode: \`${options.mode}\``);
    if (options.targetUrl) lines.push(`- Target URL: ${options.targetUrl}`);
    if (options.focus) lines.push(`- Focus Scope: ${options.focus}`);
    lines.push(
      "- Available Live MCP Audit Tools: `ai_crawler_audit`, `geo_page_audit`, `schema_citation_check`, `geo_competitor_compare`"
    );
  }
  return lines.join("\n");
}
