import { NextRequest } from "next/server";
import { resolvePublicBaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const base = resolvePublicBaseUrl(req.nextUrl.origin);
  const body = `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
