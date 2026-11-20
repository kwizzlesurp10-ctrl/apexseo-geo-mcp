import type { Metadata } from "next";
import { CANONICAL_BRAND } from "@/lib/env";

export const metadata: Metadata = {
  title: "Privacy Policy | ApexSEO GEO & AI-Crawler Audit MCP",
  description:
    "Stateless data handling and privacy policy for ApexSEO GEO & AI-Crawler Audit MCP and x402 API.",
};

export default function PrivacyPage() {
  return (
    <main className="container">
      <h1>Privacy Policy — ApexSEO GEO &amp; AI-Crawler Audit MCP</h1>
      <p style={{ color: "var(--muted)" }}>
        Effective Date: 2026-11-20 · Operator: {CANONICAL_BRAND.author} ({CANONICAL_BRAND.org})
      </p>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>1. Stateless Live-Site Auditing</h2>
        <p>
          Every MCP tool call and HTTP API endpoint performs ephemeral, stateless live HTTP/DNS
          checks against the public URL submitted in your request. Submitted URLs, HTML payloads,
          and generated audit JSON responses are processed in memory for the duration of the request
          and are not persisted to user-tracking databases or resold to third parties.
        </p>

        <h2>2. On-Chain x402 Payment Verification</h2>
        <p>
          Paid audit calls settle per request in Base Mainnet (<code>eip155:8453</code>) USDC via
          the Coinbase Developer Platform x402 facilitator (<code>api.cdp.coinbase.com</code>). Only
          public blockchain settlement receipts and payment signatures required for verification are
          exchanged with the facilitator.
        </p>

        <h2>3. Security &amp; Abuse Prevention</h2>
        <p>
          Standard serverless request telemetry (HTTP status codes, timestamps, latency) may be
          retained briefly by hosting infrastructure (Vercel) for uptime and abuse defense. Private
          or internal IP ranges and metadata endpoints are strictly blocked before network egress.
        </p>

        <h2>4. Contact</h2>
        <p>
          Operator: {CANONICAL_BRAND.author} · {CANONICAL_BRAND.org} ·{" "}
          <a href={`mailto:${CANONICAL_BRAND.email}`}>{CANONICAL_BRAND.email}</a> ·{" "}
          {CANONICAL_BRAND.location}
        </p>
      </section>
    </main>
  );
}
