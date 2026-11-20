import path from "node:path";
import { MonitorStore, type UptimeStats } from "./db";
import { MonitorScheduler } from "./scheduler";
import { createMonitorServer } from "./server";
import type { CronRunSummary, MonitorConfig } from "./types";

function parseArgs(argv: string[]): {
  once: boolean;
  json: boolean;
  config: MonitorConfig;
} {
  let once = false;
  let json = false;
  let port = Number(process.env.MONITOR_PORT ?? 3042);
  let intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 300_000);
  let targetBaseUrl = process.env.APEXSEO_TARGET_URL ?? "https://apexseo-geo-mcp.vercel.app";
  let baseRpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  let lookbackBlocks = Number(process.env.MONITOR_LOOKBACK_BLOCKS ?? 6_000);
  let dbPath =
    process.env.MONITOR_DB_PATH ??
    path.join(process.cwd(), "monitor", "data", "apexseo-monitor.db");

  for (const arg of argv) {
    if (arg === "--once") once = true;
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--port=")) port = Number(arg.slice(7));
    else if (arg.startsWith("--interval=")) intervalMs = Number(arg.slice(11)) * 1000;
    else if (arg.startsWith("--url=")) targetBaseUrl = arg.slice(6);
    else if (arg.startsWith("--blocks=")) lookbackBlocks = Number(arg.slice(9));
    else if (arg.startsWith("--db=")) dbPath = arg.slice(5);
  }

  return {
    once,
    json,
    config: {
      targetBaseUrl: targetBaseUrl.replace(/\/+$/, ""),
      host: "127.0.0.1",
      port: Number.isFinite(port) && port > 0 ? port : 3042,
      intervalMs: Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : 300_000,
      baseRpcUrl,
      lookbackBlocks: Number.isFinite(lookbackBlocks) && lookbackBlocks > 0 ? lookbackBlocks : 6_000,
      dbPath,
      alertWebhookUrl: process.env.ALERT_WEBHOOK_URL?.trim() || undefined,
    },
  };
}

/** Format a clean fixed-width terminal status report for ApexSEO cron health & analytics. */
export function formatTerminalReport(run: CronRunSummary, uptime: UptimeStats): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push(
    ` APEXSEO CRON & ANALYTICS MONITOR | ${run.overallStatus.toUpperCase()} | ${run.checksPassed}/${run.checksTotal} PASS | P50 ${run.p50LatencyMs}ms / P95 ${run.p95LatencyMs}ms`
  );
  lines.push(
    ` 24h Uptime: ${uptime.uptimePct24h}% (${uptime.healthyRuns24h}/${uptime.totalRuns24h} runs) | Duration: ${run.durationMs}ms | ${run.finishedAt}`
  );
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `${"CHECK".padEnd(32)} ${"METH".padEnd(5)} ${"CODE".padEnd(5)} ${"LAT".padEnd(7)} DETAIL`
  );
  for (const ep of run.endpoints) {
    const icon = ep.ok ? "OK " : "ERR";
    const status = ep.actualStatus === null ? "ERR" : String(ep.actualStatus);
    lines.push(
      `${(`${icon} ${ep.label}`).slice(0, 32).padEnd(32)} ${ep.method.padEnd(5)} ${status.padEnd(5)} ${(ep.latencyMs + "ms").padEnd(7)} ${ep.detail}`
    );
  }
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    ` x402-trust: ${run.trust.verified ? "VERIFIED" : "UNVERIFIED"} (${run.trust.endpointCount ?? 0} endpoints) | MCP Reg: ${run.registries.mcpRegistry.version ?? "—"} | gold-402 PR #518: ${run.registries.gold402Pr.state ?? "—"} [${run.registries.gold402Pr.labels.join(",")}]`
  );
  lines.push(
    ` Glama: server ${run.registries.glama.serverGrade ?? "—"} / connector ${run.registries.glama.connectorGrade ?? "—"} | Base USDC (${run.settlements.scannedBlocks} blks): ${run.settlements.recentTransferCount} txns (${run.settlements.recentTotalUsdcUsd}, ${run.settlements.matchingApexDenominationCount} Apex-tier)`
  );
  lines.push("================================================================================");
  return lines.join("\n");
}

async function main() {
  const { once, json, config } = parseArgs(process.argv.slice(2));
  const store = new MonitorStore(config.dbPath);
  const scheduler = new MonitorScheduler(config, store);

  if (once) {
    const run = await scheduler.runOnce("cli");
    const uptime = store.getUptime24h();
    if (json) {
      console.log(JSON.stringify({ run, uptime }, null, 2));
    } else {
      console.log(formatTerminalReport(run, uptime));
    }
    store.close();
    process.exit(run.overallStatus === "healthy" ? 0 : 1);
  }

  const server = createMonitorServer(store, scheduler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });

  console.log(`ApexSEO Monitor UI listening at http://${config.host}:${config.port}`);
  scheduler.start();
  const initialRun = await scheduler.runOnce("cron");
  console.log(formatTerminalReport(initialRun, store.getUptime24h()));

  const shutdown = () => {
    scheduler.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isEntrypoint = process.argv[1]?.includes("monitor");
if (isEntrypoint) {
  void main();
}
