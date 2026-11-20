import { NextRequest } from "next/server";
import { CANONICAL_BRAND, resolvePublicBaseUrl } from "@/lib/env";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";

export const dynamic = "force-dynamic";
export const OPTIONS = corsOptionsResponse;

export function GET(req: NextRequest) {
  const base = resolvePublicBaseUrl(req.nextUrl.origin);
  const body = `Contact: mailto:${CANONICAL_BRAND.email}
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
Expires: 2027-11-20T00:00:00Z
`;
  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
