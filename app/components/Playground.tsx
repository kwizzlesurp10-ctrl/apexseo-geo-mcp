"use client";

import { useState } from "react";

interface ProbeResult {
  label: string;
  httpStatus: number;
  paymentRequiredHeaderPresent: boolean;
  body: unknown;
}

export function Playground({ baseUrl }: { baseUrl: string }) {
  const [targetUrl, setTargetUrl] = useState("https://example.com");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runProbe(label: string, path: string, method: "GET" | "POST") {
    setLoading(true);
    try {
      const res = await fetch(path, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify({ url: targetUrl }) : undefined,
      });
      const paymentHeader = Boolean(res.headers.get("payment-required"));
      const body = await res.json();
      setResult({
        label,
        httpStatus: res.status,
        paymentRequiredHeaderPresent: paymentHeader,
        body,
      });
    } catch (err) {
      setResult({
        label,
        httpStatus: 0,
        paymentRequiredHeaderPresent: false,
        body: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h3 style={{ marginTop: 0 }}>Live Protocol &amp; x402 Challenge Inspector</h3>
      <p style={{ color: "var(--muted)", marginTop: "0.25rem", fontSize: "0.92rem" }}>
        Test free endpoints directly or inspect live HTTP <code>402 PAYMENT-REQUIRED</code>{" "}
        Bazaar challenges against <code>{baseUrl}</code>.
      </p>

      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <input
          className="url-input"
          style={{ flex: "1 1 280px" }}
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          aria-label="Target URL for audit challenge inspection"
        />
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => runProbe("GET /api/health (Free)", "/api/health", "GET")}
        >
          Probe Health
        </button>
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => runProbe("GET /api/pricing (Free)", "/api/pricing", "GET")}
        >
          Probe Pricing
        </button>
        <button
          className="btn"
          disabled={loading}
          onClick={() => runProbe("POST /api/audit/page ($0.02 x402)", "/api/audit/page", "POST")}
        >
          Inspect 402 Challenge
        </button>
      </div>

      {result && (
        <div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            <strong>{result.label}</strong> — HTTP{" "}
            <code
              style={{
                color: result.httpStatus === 200 ? "var(--success)" : "var(--warn)",
              }}
            >
              {result.httpStatus}
            </code>{" "}
            | <code>PAYMENT-REQUIRED</code> header:{" "}
            <code>{result.paymentRequiredHeaderPresent ? "present" : "absent"}</code>
          </div>
          <pre className="codeblock">{JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
