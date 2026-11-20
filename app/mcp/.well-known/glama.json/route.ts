import { NextResponse } from "next/server";
import { CORS_HEADERS, corsOptionsResponse } from "@/lib/http-handler";

export const dynamic = "force-static";
export const OPTIONS = corsOptionsResponse;

export function GET() {
  return NextResponse.json(
    {
      $schema: "https://glama.ai/mcp/schemas/connector.json",
      claim: "glama_claim_cDkoeQzE_Pr9_A1lGY71xgeDoaY7xZSI",
    },
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "cache-control": "public, max-age=300",
      },
    }
  );
}
