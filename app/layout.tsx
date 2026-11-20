import type { Metadata } from "next";
import { CANONICAL_BRAND, resolvePublicBaseUrl } from "@/lib/env";
import "./globals.css";

export function generateMetadata(): Metadata {
  const baseUrl = resolvePublicBaseUrl();
  return {
    title: "ApexSEO GEO & AI-Crawler Audit MCP | Keyless x402 Base USDC API",
    description:
      "Keyless remote Streamable HTTP MCP and x402 Base USDC API auditing AI-crawler access (robots.txt, llms.txt), technical GEO/AEO readiness, JSON-LD citations, and competitor deltas.",
    metadataBase: new URL(baseUrl),
    alternates: { canonical: "/" },
    icons: { icon: "/icon.png" },
    authors: [{ name: CANONICAL_BRAND.author, url: CANONICAL_BRAND.website }],
    openGraph: {
      type: "website",
      url: baseUrl,
      title: "ApexSEO GEO & AI-Crawler Audit MCP",
      description:
        "Audit any live site for GPTBot, ClaudeBot, PerplexityBot access, /llms.txt, JSON-LD entities, and composite GEO scores. Pay per call in Base USDC ($0.01-$0.05).",
      siteName: "ApexSEO GEO Audit MCP",
    },
    twitter: {
      card: "summary_large_image",
      title: "ApexSEO GEO & AI-Crawler Audit MCP",
      description:
        "Keyless Base USDC x402 MCP & HTTP suite for AI-Search (GEO/AEO) and crawler readiness.",
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
