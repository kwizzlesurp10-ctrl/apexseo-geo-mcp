import { NextRequest } from "next/server";
import { findGeoTool } from "@/lib/catalog";
import { corsOptionsResponse, handleToolHttpRequest } from "@/lib/http-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(req: NextRequest) {
  return handleToolHttpRequest(req, findGeoTool("ai_crawler_audit")!);
}

export async function POST(req: NextRequest) {
  return handleToolHttpRequest(req, findGeoTool("ai_crawler_audit")!);
}
