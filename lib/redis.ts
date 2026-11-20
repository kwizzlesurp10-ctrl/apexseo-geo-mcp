/**
 * High-performance, zero-dependency Upstash Redis REST analytics client.
 * Fail-open design: network or Redis errors never block audits or tool execution.
 */

export interface UpstashAnalyticsEvent {
  tool: string;
  isFree: boolean;
  status: "success" | "402_probe" | "execution_error" | "settlement_error";
  amountAtomic?: string;
  payer?: string;
  txHash?: string;
  durationMs?: number;
}

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** Execute a low-level Upstash Redis pipeline command via REST API */
async function executeUpstashCommand(command: (string | number)[]): Promise<unknown> {
  const cfg = getRedisConfig();
  if (!cfg) return null;

  try {
    const res = await fetch(`${cfg.url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3000), // Strict 3s ceiling to avoid blocking server responses
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    return json.result;
  } catch {
    // Fail-open: Redis analytics issues never interrupt service
    return null;
  }
}

/** Execute a batch pipeline of Upstash Redis REST commands */
async function executeUpstashPipeline(commands: (string | number)[][]): Promise<unknown[] | null> {
  const cfg = getRedisConfig();
  if (!cfg) return null;

  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown }>;
    return json.map((j) => j.result);
  } catch {
    return null;
  }
}

/** Record a tool call or settlement event asynchronously */
export function recordToolAnalytics(event: UpstashAnalyticsEvent): void {
  const cfg = getRedisConfig();
  if (!cfg) return;

  const today = new Date().toISOString().slice(0, 10);
  const commands: (string | number)[][] = [
    // 1. Overall & per-tool invocation counters
    ["INCR", "apexseo:calls:total"],
    ["INCR", `apexseo:calls:${event.tool}`],
    ["INCR", `apexseo:daily:${today}:total`],
    ["INCR", `apexseo:daily:${today}:${event.tool}`],
  ];

  // 2. Track 402 payment probes vs successful executions
  if (event.status === "402_probe") {
    commands.push(["INCR", "apexseo:probes:402"]);
    commands.push(["INCR", `apexseo:daily:${today}:probes:402`]);
  } else if (event.status === "success") {
    commands.push(["INCR", "apexseo:calls:success"]);
    commands.push(["INCR", `apexseo:daily:${today}:success`]);

    // 3. Paid settlement tracking (atomic Base USDC)
    if (!event.isFree && event.amountAtomic && event.amountAtomic !== "0") {
      const atomicNum = Number.parseInt(event.amountAtomic, 10);
      if (Number.isFinite(atomicNum) && atomicNum > 0) {
        commands.push(["INCRBY", "apexseo:settled:atomic_usdc", atomicNum]);
        commands.push(["INCRBY", `apexseo:daily:${today}:atomic_usdc`, atomicNum]);
      }
      if (event.payer) {
        // Track unique paying agents / wallets
        commands.push(["SADD", "apexseo:payers:set", event.payer.toLowerCase()]);
        commands.push(["ZINCRBY", "apexseo:payers:volume", event.amountAtomic, event.payer.toLowerCase()]);
      }
      if (event.txHash) {
        // Log recent settled transaction hash with 30-day TTL list
        commands.push(["LPUSH", "apexseo:recent:txns", JSON.stringify({
          tool: event.tool,
          payer: event.payer,
          txHash: event.txHash,
          amountAtomic: event.amountAtomic,
          at: new Date().toISOString(),
        })]);
        commands.push(["LTRIM", "apexseo:recent:txns", 0, 99]);
      }
    }
  }

  // Fire and forget; never await or block response path
  void executeUpstashPipeline(commands).catch(() => {});
}

/** Read aggregated Redis analytics for diagnostics and dashboard inspection */
export async function getUpstashAnalyticsSummary(): Promise<{
  connected: boolean;
  totalCalls: number;
  totalSettledUsdc: string;
  uniquePayers: number;
  recentTxnsCount: number;
}> {
  const cfg = getRedisConfig();
  if (!cfg) {
    return {
      connected: false,
      totalCalls: 0,
      totalSettledUsdc: "$0.00",
      uniquePayers: 0,
      recentTxnsCount: 0,
    };
  }

  const results = await executeUpstashPipeline([
    ["GET", "apexseo:calls:total"],
    ["GET", "apexseo:settled:atomic_usdc"],
    ["SCARD", "apexseo:payers:set"],
    ["LLEN", "apexseo:recent:txns"],
  ]);

  if (!results) {
    return {
      connected: false,
      totalCalls: 0,
      totalSettledUsdc: "$0.00",
      uniquePayers: 0,
      recentTxnsCount: 0,
    };
  }

  const totalCalls = Number(results[0] ?? 0);
  const totalAtomic = BigInt(results[1]?.toString() || "0");
  const uniquePayers = Number(results[2] ?? 0);
  const recentTxnsCount = Number(results[3] ?? 0);

  const whole = totalAtomic / 1_000_000n;
  const frac = (totalAtomic % 1_000_000n).toString().padStart(6, "0").slice(0, 4);

  return {
    connected: true,
    totalCalls,
    totalSettledUsdc: `$${whole.toString()}.${frac.replace(/0+$/, "").padEnd(2, "0")}`,
    uniquePayers,
    recentTxnsCount,
  };
}
