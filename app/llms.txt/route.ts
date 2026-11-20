import { NextRequest } from "next/server";
import { buildLlmsTxt } from "@/lib/discovery";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";

export const dynamic = "force-dynamic";
export const OPTIONS = corsOptionsResponse;

export function GET(req: NextRequest) {
  return new Response(buildLlmsTxt(req.nextUrl.origin), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
