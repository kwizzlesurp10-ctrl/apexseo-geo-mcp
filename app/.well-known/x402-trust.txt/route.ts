import { X402_TRUST_VERIFICATION } from "@/lib/env";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";

export const dynamic = "force-static";
export const OPTIONS = corsOptionsResponse;

export function GET() {
  return new Response(`${X402_TRUST_VERIFICATION}\n`, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
