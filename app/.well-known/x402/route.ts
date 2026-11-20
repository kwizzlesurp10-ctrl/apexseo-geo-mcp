import { NextRequest, NextResponse } from "next/server";
import { buildWellKnownX402 } from "@/lib/discovery";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";

export const dynamic = "force-dynamic";
export const OPTIONS = corsOptionsResponse;

export function GET(req: NextRequest) {
  return NextResponse.json(buildWellKnownX402(req.nextUrl.origin), {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=60" },
  });
}
