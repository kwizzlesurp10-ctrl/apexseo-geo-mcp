import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import {
  BASE_MAINNET_NETWORK,
  BASE_MAINNET_USDC,
  CANONICAL_PAY_TO,
} from "../lib/env";
import {
  formatUsdcAtomic,
  parseGlamaBadgeSvg,
  parseUsdcTransferLog,
  parseX402ScanHtml,
  parseX402TrustHtml,
} from "../monitor/aggregators";
import { MonitorStore, evaluateAlerts } from "../monitor/db";
import { computeLatencyPercentiles, verifyX402Parity } from "../monitor/probes";
import { MonitorScheduler, classifyOverallStatus } from "../monitor/scheduler";
import { createMonitorServer } from "../monitor/server";
import type { CronRunSummary, MonitorConfig } from "../monitor/types";

function makeSampleRun(overrides: Partial<CronRunSummary> = {}): CronRunSummary {
  const nowIso = new Date().toISOString();
  const startedIso = new Date(Date.now() - 1000).toISOString();
  return {
    startedAt: startedIso,
    finishedAt: nowIso,
    durationMs: 420,
    trigger: "cron",
    overallStatus: "healthy",
    checksPassed: 2,
    checksTotal: 2,
    p50LatencyMs: 90,
    p95LatencyMs: 180,
    endpoints: [
      {
        id: "api:health",
        label: "GET /api/health",
        category: "api",
        url: "https://apexseo-geo-mcp.vercel.app/api/health",
        method: "GET",
        expectedStatus: 200,
        actualStatus: 200,
        latencyMs: 90,
        ok: true,
        detail: "ok=true",
        checkedAt: nowIso,
      },
      {
        id: "x402:geo_page_audit",
        label: "geo_page_audit ($0.02)",
        category: "x402",
        url: "https://apexseo-geo-mcp.vercel.app/api/audit/page",
        method: "POST",
        expectedStatus: 402,
        actualStatus: 402,
        latencyMs: 180,
        ok: true,
        paymentParityOk: true,
        detail: "402 parity OK",
        checkedAt: nowIso,
      },
    ],
    trust: {
      providerUrl: "https://x402-trust.com/provider/apexseo-geo-mcp.vercel.app",
      verified: true,
      endpointCount: 4,
      avgTrustScore: "—",
      endpoints: [],
      fetchedAt: nowIso,
    },
    registries: {
      x402scan: { url: "https://www.x402scan.com", httpStatus: 200, txns: 137, volumeUsd: "16.60", buyers: 21 },
      glama: {
        serverUrl: "",
        connectorUrl: "",
        serverGrade: "A",
        serverDesc: "6 tools",
        connectorGrade: "A",
        connectorDesc: "verified",
      },
      mcpRegistry: { url: "", httpStatus: 200, version: "0.1.1", serverCount: 1 },
      gold402Pr: { url: "", number: 518, state: "open", merged: false, labels: ["gate-passed"] },
      githubCi: {
        repo: "kwizzlesurp10-ctrl/apexseo-geo-mcp",
        latestWorkflow: "CI",
        status: "completed",
        conclusion: "success",
        sha: "1cad87e",
        htmlUrl: null,
        updatedAt: null,
      },
    },
    settlements: {
      network: BASE_MAINNET_NETWORK,
      payTo: CANONICAL_PAY_TO,
      usdcContract: BASE_MAINNET_USDC,
      latestBlock: 100,
      scannedFromBlock: 90,
      scannedBlocks: 11,
      recentTransferCount: 0,
      recentTotalUsdcAtomic: "0",
      recentTotalUsdcUsd: "$0.00",
      uniquePayersRecent: 0,
      matchingApexDenominationCount: 0,
      recentTransfers: [],
    },
    alerts: [],
    ...overrides,
  };
}

describe("monitor probes and parsers", () => {
  it("validates x402 PAYMENT-REQUIRED header parity and catches drift", () => {
    const validChallenge: PaymentRequired = {
      x402Version: 2,
      resource: {
        url: "https://apexseo-geo-mcp.vercel.app/api/audit/page",
        description: "Page audit",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: BASE_MAINNET_NETWORK,
          amount: "20000",
          asset: BASE_MAINNET_USDC,
          payTo: CANONICAL_PAY_TO,
          maxTimeoutSeconds: 300,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    };
    const encoded = encodePaymentRequiredHeader(validChallenge);
    const okRes = verifyX402Parity(encoded, "", "20000");
    expect(okRes.parityOk).toBe(true);
    expect(okRes.amountAtomic).toBe("20000");

    const drifted = {
      ...validChallenge,
      accepts: [
        {
          ...validChallenge.accepts[0],
          payTo: "0x0000000000000000000000000000000000000001",
        },
      ],
    };
    const badRes = verifyX402Parity(encodePaymentRequiredHeader(drifted), "", "20000");
    expect(badRes.parityOk).toBe(false);
    expect(badRes.detail).toContain("payTo=");
  });

  it("computes P50 and P95 latency percentiles cleanly", () => {
    expect(computeLatencyPercentiles([])).toEqual({ p50: 0, p95: 0 });
    expect(computeLatencyPercentiles([400, 100, 200, 300])).toEqual({ p50: 200, p95: 400 });
  });

  it("parses x402-trust provider HTML, Glama SVG, x402scan stats, and USDC Transfer logs", () => {
    const html = `
      <div>✓ provider verified · 4 listed endpoints · avg trust score 88.5</div>
      <table><tbody><tr><td data-sort="ApexSEO GEO Page Audit"><a class="idstrip" href="/endpoint/415257"><span class="r-host">ApexSEO GEO Page Audit</span><span class="r-path">/api/audit/page</span></a></td><td class="gcell"><span>A</span> <span>91.2</span></td><td>99.8%</td><td>0.92</td><td>—</td></tr></tbody></table>
    `;
    const trust = parseX402TrustHtml(html, "https://x402-trust.com/provider/apexseo-geo-mcp.vercel.app");
    expect(trust.verified).toBe(true);
    expect(trust.endpointCount).toBe(4);
    expect(trust.endpoints).toHaveLength(1);
    expect(trust.endpoints[0]).toMatchObject({
      endpointId: "415257",
      path: "/api/audit/page",
      grade: "A",
      score: "91.2",
      uptime30d: "99.8%",
      confidence: "0.92",
      price: "$0.02",
    });

    expect(
      parseGlamaBadgeSvg(
        "<svg><title>apexseo-geo-mcp – MCP server rated A on Glama</title><desc>Glama score badge for k/a: 6 tools, maintenance rated B.</desc></svg>"
      )
    ).toEqual({ grade: "A", desc: "6 tools, maintenance rated B." });
    expect(parseX402ScanHtml("<span>137 txns</span> $16.60 <span>21 buyers</span>")).toEqual({
      txns: 137,
      volumeUsd: "16.60",
      buyers: 21,
    });

    const tx = parseUsdcTransferLog({
      transactionHash: "0xabc123",
      blockNumber: "0x10",
      topics: [
        "0xddf252ad",
        "0x0000000000000000000000001111111111111111111111111111111111111111",
        "0x0000000000000000000000000d25a44f74868ece53b305c97139cf4b62963410",
      ],
      data: "0x4e20", // 20000 atomic = $0.02
    });
    expect(tx).toMatchObject({
      blockNumber: 16,
      from: "0x1111111111111111111111111111111111111111",
      amountAtomic: "20000",
      amountUsd: "$0.02",
      matchesApexTier: true,
      tierLabel: "$0.02 (page)",
    });
    expect(formatUsdcAtomic(16_600_000n)).toBe("16.60");
  });
});

describe("MonitorStore SQLite persistence, alerts, and local HTTP server", () => {
  it("tracks run history, transition alerts, settings, and HTTP API routes cleanly", async () => {
    const store = new MonitorStore(":memory:");
    const r1 = store.recordRun(makeSampleRun());
    expect(r1.id).toBe(1);
    expect(r1.alerts).toHaveLength(0);

    const failedRun = makeSampleRun({
      overallStatus: "down",
      checksPassed: 1,
      endpoints: [
        makeSampleRun().endpoints[0],
        {
          ...makeSampleRun().endpoints[1],
          ok: false,
          actualStatus: 500,
          paymentParityOk: false,
          detail: "expected 402, got 500",
        },
      ],
    });
    const alerts = evaluateAlerts(r1, failedRun);
    expect(alerts.some((a) => a.severity === "critical" && a.source === "x402:geo_page_audit")).toBe(true);
    expect(alerts.some((a) => a.severity === "critical" && a.source === "overall")).toBe(true);

    store.recordRun(failedRun);
    expect(store.listHistory(10)).toHaveLength(2);
    expect(store.listAlerts(10).length).toBeGreaterThanOrEqual(2);
    expect(store.getUptime24h().uptimePct24h).toBe(50);

    expect(classifyOverallStatus(failedRun.endpoints)).toBe("down");
    expect(classifyOverallStatus(makeSampleRun().endpoints)).toBe("healthy");

    const cfg: MonitorConfig = {
      targetBaseUrl: "https://apexseo-geo-mcp.vercel.app",
      host: "127.0.0.1",
      port: 0,
      intervalMs: 300_000,
      baseRpcUrl: "https://mainnet.base.org",
      lookbackBlocks: 2000,
      dbPath: ":memory:",
    };
    const scheduler = new MonitorScheduler(cfg, store);
    const server = createMonitorServer(store, scheduler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const htmlRes = await fetch(`${base}/`);
      expect(htmlRes.status).toBe(200);
      expect(await htmlRes.text()).toContain("ApexSEO Monitor");

      const statusJson = (await fetch(`${base}/api/status`).then((r) => r.json())) as {
        ok: boolean;
        latestRun: { checksTotal: number };
      };
      expect(statusJson.ok).toBe(true);
      expect(statusJson.latestRun.checksTotal).toBe(2);

      const badCfg = await fetch(`${base}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalMs: -1 }),
      });
      expect(badCfg.status).toBe(400);

      const goodCfg = await fetch(`${base}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalMs: 60_000 }),
      });
      expect(goodCfg.status).toBe(200);
      expect(store.getSetting("interval_ms")).toBe("60000");

      const exportRes = await fetch(`${base}/api/export`);
      expect(exportRes.status).toBe(200);
      expect(exportRes.headers.get("content-disposition")).toContain("apexseo-monitor-export.json");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
