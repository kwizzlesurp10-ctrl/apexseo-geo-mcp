import { NextRequest } from "next/server";
import { resolvePublicBaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const base = resolvePublicBaseUrl(req.nextUrl.origin);
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = ["", "/mcp", "/openapi.json", "/llms.txt", "/privacy", "/.well-known/x402"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${base}${u}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>
`;
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
