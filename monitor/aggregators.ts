import { BASE_MAINNET_NETWORK, BASE_MAINNET_USDC, CANONICAL_PAY_TO } from "../lib/env";
import { timedFetch } from "./probes";
import type {
  BaseSettlementSnapshot,
  RegistrySnapshot,
  UsdcTransferEvent,
  X402TrustEndpointRow,
  X402TrustSnapshot,
} from "./types";

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const APEX_TIER_LABELS: Record<string, string> = {
  "10000": "$0.01 (crawlers/schema)",
  "20000": "$0.02 (page)",
  "50000": "$0.05 (compare)",
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Format 6-decimal atomic USDC bigint string cleanly to USD string without float drift. */
export function formatUsdcAtomic(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${frac.slice(0, 4).replace(/0+$/, "").padEnd(2, "0")}`;
}

/** Parse x402-trust.com provider page HTML into structured status & endpoint rows. */
export function parseX402TrustHtml(html: string, providerUrl: string): X402TrustSnapshot {
  const text = stripTags(html);
  const verified = /✓\s*provider verified/i.test(text) || /verified provider/i.test(text);
  const epCountMatch = text.match(/\b(\d+)\s+listed endpoints?\b/i);
  const scoreMatch = text.match(/avg trust score\s*([0-9]+(?:\.[0-9]+)?|—)/i);

  const endpoints: X402TrustEndpointRow[] = [];
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const rowsHtml = tbodyMatch ? tbodyMatch[1] : html;
  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(rowsHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const idMatch = rowHtml.match(/href="\/endpoint\/(\d+)"/i);
    if (!idMatch) continue;
    const endpointId = idMatch[1];
    const pathMatch = rowHtml.match(/<span class="r-path">([^<]+)<\/span>/i);
    const epPath = (pathMatch?.[1] ?? "").trim() || `/endpoint/${endpointId}`;
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    const gradeCell = cells[1] ?? "";
    const gradeParts = gradeCell.split(/\s+/).filter(Boolean);
    const defaultPrice = epPath.includes("compare")
      ? "$0.05"
      : epPath.includes("page")
        ? "$0.02"
        : "$0.01";
    endpoints.push({
      endpointId,
      path: epPath,
      grade: gradeParts[0] ?? "?",
      score: gradeParts[1] ?? "—",
      uptime30d: cells[2] || "—",
      confidence: cells[3] || "—",
      price: cells[4] && cells[4] !== "—" ? cells[4] : defaultPrice,
    });
  }

  return {
    providerUrl,
    verified,
    endpointCount: epCountMatch ? Number(epCountMatch[1]) : endpoints.length || null,
    avgTrustScore: scoreMatch ? scoreMatch[1] : null,
    endpoints,
    fetchedAt: new Date().toISOString(),
  };
}

/** Extract grade letter and description from a Glama SVG score badge. */
export function parseGlamaBadgeSvg(svg: string): { grade: string | null; desc: string | null } {
  const titleMatch = svg.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = svg.match(/<desc>([\s\S]*?)<\/desc>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : stripTags(svg);
  const gradeMatch =
    title.match(/\brated\s+([A-F][+-]?|\d{1,3}%)/i) ??
    svg.match(/(?:^|[^0-9])(\d{1,3}%)/);
  const desc = descMatch ? stripTags(descMatch[1]).replace(/^Glama score badge for [^:]+:\s*/i, "") : null;
  return {
    grade: gradeMatch ? gradeMatch[1].toUpperCase() : null,
    desc,
  };
}

/** Extract public x402scan summary numbers when rendered in SSR/RSC HTML. */
export function parseX402ScanHtml(html: string): {
  txns: number | null;
  volumeUsd: string | null;
  buyers: number | null;
} {
  const txMatch = html.match(/(\d[\d,]*)\s*(?:txns|transactions)/i) ?? html.match(/"totalCount"\s*:\s*(\d+)/);
  const volMatch =
    html.match(/\$([0-9]+(?:\.[0-9]{2,4})?)/) ?? html.match(/"totalAmount"\s*:\s*([0-9.]+)/);
  const buyersMatch =
    html.match(/(\d[\d,]*)\s*buyers/i) ?? html.match(/"uniqueBuyers"\s*:\s*(\d+)/);
  return {
    txns: txMatch ? Number(txMatch[1].replace(/,/g, "")) : null,
    volumeUsd: volMatch ? volMatch[1] : null,
    buyers: buyersMatch ? Number(buyersMatch[1].replace(/,/g, "")) : null,
  };
}

/** Parse a raw Base USDC Transfer JSON-RPC log entry into typed transfer summary. */
export function parseUsdcTransferLog(log: {
  transactionHash?: string;
  blockNumber?: string;
  topics?: string[];
  data?: string;
}): UsdcTransferEvent | null {
  if (!log.transactionHash || !log.topics || log.topics.length < 3 || !log.data) {
    return null;
  }
  const fromRaw = log.topics[1];
  const from = `0x${fromRaw.slice(-40)}`;
  const amountBigInt = BigInt(log.data);
  const amountAtomic = amountBigInt.toString();
  const tierLabel = APEX_TIER_LABELS[amountAtomic] ?? null;
  return {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber ? Number.parseInt(log.blockNumber, 16) : 0,
    from,
    amountAtomic,
    amountUsd: `$${formatUsdcAtomic(amountBigInt)}`,
    matchesApexTier: tierLabel !== null,
    tierLabel,
  };
}

export async function fetchX402TrustStatus(): Promise<X402TrustSnapshot> {
  const providerUrl = "https://x402-trust.com/provider/apexseo-geo-mcp.vercel.app";
  const res = await timedFetch(
    providerUrl,
    { headers: { "user-agent": "curl/8.7.1", accept: "text/html" } },
    10_000
  );
  if (!res.ok) {
    return {
      providerUrl,
      verified: false,
      endpointCount: null,
      avgTrustScore: null,
      endpoints: [],
      fetchedAt: new Date().toISOString(),
      error: res.error ?? `HTTP ${res.status}`,
    };
  }
  return parseX402TrustHtml(res.text, providerUrl);
}

export async function fetchRegistriesStatus(): Promise<RegistrySnapshot> {
  const scanUrl = "https://www.x402scan.com/server/6edca183-9ad7-4ebc-93fa-4214e5a54162";
  const glamaServerPage = "https://glama.ai/mcp/servers/kwizzlesurp10-ctrl/apexseo-geo-mcp";
  const glamaConnectorPage =
    "https://glama.ai/mcp/connectors/app.vercel.apexseo-geo-mcp/apex-seo-geo-and-ai-crawler-audit-mcp";
  const glamaServerSvg = `${glamaServerPage}/badges/score.svg`;
  const glamaConnectorSvg = `${glamaConnectorPage}/badges/score.svg`;
  const registryUrl = "https://registry.modelcontextprotocol.io/v0.1/servers?search=apexseo-geo-mcp";
  const prUrl = "https://github.com/Haustorium12/gold-402/pull/518";
  const prApi = "https://api.github.com/repos/Haustorium12/gold-402/pulls/518";
  const ciApi = "https://api.github.com/repos/kwizzlesurp10-ctrl/apexseo-geo-mcp/actions/runs?per_page=3";

  const [scanRes, gSrvRes, gConRes, regRes, prRes, ciRes] = await Promise.all([
    timedFetch(scanUrl),
    timedFetch(glamaServerSvg),
    timedFetch(glamaConnectorSvg),
    timedFetch(registryUrl, { headers: { accept: "application/json" } }),
    timedFetch(prApi, { headers: { accept: "application/vnd.github+json", "user-agent": "apexseo-monitor" } }),
    timedFetch(ciApi, { headers: { accept: "application/vnd.github+json", "user-agent": "apexseo-monitor" } }),
  ]);

  const scanStats = scanRes.ok ? parseX402ScanHtml(scanRes.text) : { txns: null, volumeUsd: null, buyers: null };

  let regVersion: string | null = null;
  let regCount: number | null = null;
  if (regRes.ok) {
    try {
      const regJson = JSON.parse(regRes.text) as {
        servers?: Array<{
          server?: { version?: string };
          _meta?: Record<string, { isLatest?: boolean }>;
        }>;
      };
      const servers = Array.isArray(regJson.servers) ? regJson.servers : [];
      regCount = servers.length;
      const latestEntry =
        servers.find((s) => s._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest) ??
        servers[servers.length - 1];
      regVersion = latestEntry?.server?.version ?? null;
    } catch {
      /* leave nulls */
    }
  }

  let prState: string | null = null;
  let prMerged = false;
  let prLabels: string[] = [];
  if (prRes.ok) {
    try {
      const prJson = JSON.parse(prRes.text) as {
        state?: string;
        merged?: boolean;
        labels?: Array<{ name?: string }>;
      };
      prState = prJson.state ?? null;
      prMerged = Boolean(prJson.merged);
      prLabels = (prJson.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
    } catch {
      /* leave defaults */
    }
  }

  interface GithubWorkflowRun {
    name?: string;
    status?: string;
    conclusion?: string | null;
    head_sha?: string;
    html_url?: string;
    updated_at?: string;
  }
  let latestRun: GithubWorkflowRun | null = null;
  if (ciRes.ok) {
    try {
      const ciJson = JSON.parse(ciRes.text) as { workflow_runs?: GithubWorkflowRun[] };
      latestRun = ciJson.workflow_runs?.[0] ?? null;
    } catch {
      latestRun = null;
    }
  }

  return {
    x402scan: {
      url: scanUrl,
      httpStatus: scanRes.status,
      txns: scanStats.txns,
      volumeUsd: scanStats.volumeUsd,
      buyers: scanStats.buyers,
      ...(scanRes.ok ? {} : { error: scanRes.error ?? `HTTP ${scanRes.status}` }),
    },
    glama: {
      serverUrl: glamaServerPage,
      connectorUrl: glamaConnectorPage,
      ...(gSrvRes.ok
        ? {
            serverGrade: parseGlamaBadgeSvg(gSrvRes.text).grade,
            serverDesc: parseGlamaBadgeSvg(gSrvRes.text).desc,
          }
        : { serverGrade: null, serverDesc: null }),
      ...(gConRes.ok
        ? {
            connectorGrade: parseGlamaBadgeSvg(gConRes.text).grade,
            connectorDesc: parseGlamaBadgeSvg(gConRes.text).desc,
          }
        : { connectorGrade: null, connectorDesc: null }),
      ...(gSrvRes.ok || gConRes.ok ? {} : { error: gSrvRes.error ?? `HTTP ${gSrvRes.status}` }),
    },
    mcpRegistry: {
      url: registryUrl,
      httpStatus: regRes.status,
      version: regVersion,
      serverCount: regCount,
      ...(regRes.ok ? {} : { error: regRes.error ?? `HTTP ${regRes.status}` }),
    },
    gold402Pr: {
      url: prUrl,
      number: 518,
      state: prState,
      merged: prMerged,
      labels: prLabels,
      ...(prRes.ok ? {} : { error: prRes.error ?? `HTTP ${prRes.status}` }),
    },
    githubCi: {
      repo: "kwizzlesurp10-ctrl/apexseo-geo-mcp",
      latestWorkflow: latestRun?.name ?? null,
      status: latestRun?.status ?? null,
      conclusion: latestRun?.conclusion ?? null,
      sha: latestRun?.head_sha ? latestRun.head_sha.slice(0, 7) : null,
      htmlUrl: latestRun?.html_url ?? null,
      updatedAt: latestRun?.updated_at ?? null,
      ...(ciRes.ok ? {} : { error: ciRes.error ?? `HTTP ${ciRes.status}` }),
    },
  };
}

async function callBaseRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await timedFetch(
    rpcUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    10_000
  );
  if (!res.ok) {
    throw new Error(res.error ?? `RPC HTTP ${res.status}`);
  }
  const json = JSON.parse(res.text) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }
  if (json.result === undefined) {
    throw new Error("RPC missing result");
  }
  return json.result;
}

/** Poll Base Mainnet USDC incoming transfers to canonical payout wallet in safe chunks. */
export async function fetchBaseUsdcSettlements(
  rpcUrl: string,
  lookbackBlocks: number
): Promise<BaseSettlementSnapshot> {
  try {
    const latestHex = await callBaseRpc<string>(rpcUrl, "eth_blockNumber", []);
    const latestBlock = Number.parseInt(latestHex, 16);
    const fromBlock = Math.max(0, latestBlock - Math.max(100, lookbackBlocks));
    const paddedPayTo = `0x000000000000000000000000${CANONICAL_PAY_TO.slice(2).toLowerCase()}`;

    const chunkSize = 2_000;
    const chunks: Array<{ from: number; to: number }> = [];
    for (let cursor = fromBlock; cursor <= latestBlock; cursor += chunkSize) {
      chunks.push({ from: cursor, to: Math.min(latestBlock, cursor + chunkSize - 1) });
    }

    const logBatches = await Promise.all(
      chunks.map((chunk) =>
        callBaseRpc<Array<{ transactionHash?: string; blockNumber?: string; topics?: string[]; data?: string }>>(
          rpcUrl,
          "eth_getLogs",
          [
            {
              fromBlock: `0x${chunk.from.toString(16)}`,
              toBlock: `0x${chunk.to.toString(16)}`,
              address: BASE_MAINNET_USDC,
              topics: [ERC20_TRANSFER_TOPIC, null, paddedPayTo],
            },
          ]
        )
      )
    );

    const parsed = logBatches
      .flat()
      .map(parseUsdcTransferLog)
      .filter((t): t is UsdcTransferEvent => t !== null)
      .sort((a, b) => b.blockNumber - a.blockNumber);

    let totalAtomic = 0n;
    const uniquePayers = new Set<string>();
    let apexTierCount = 0;
    for (const tx of parsed) {
      totalAtomic += BigInt(tx.amountAtomic);
      uniquePayers.add(tx.from.toLowerCase());
      if (tx.matchesApexTier) apexTierCount += 1;
    }

    return {
      network: BASE_MAINNET_NETWORK,
      payTo: CANONICAL_PAY_TO,
      usdcContract: BASE_MAINNET_USDC,
      latestBlock,
      scannedFromBlock: fromBlock,
      scannedBlocks: latestBlock - fromBlock + 1,
      recentTransferCount: parsed.length,
      recentTotalUsdcAtomic: totalAtomic.toString(),
      recentTotalUsdcUsd: `$${formatUsdcAtomic(totalAtomic)}`,
      uniquePayersRecent: uniquePayers.size,
      matchingApexDenominationCount: apexTierCount,
      recentTransfers: parsed.slice(0, 15),
    };
  } catch (err) {
    return {
      network: BASE_MAINNET_NETWORK,
      payTo: CANONICAL_PAY_TO,
      usdcContract: BASE_MAINNET_USDC,
      latestBlock: null,
      scannedFromBlock: null,
      scannedBlocks: lookbackBlocks,
      recentTransferCount: 0,
      recentTotalUsdcAtomic: "0",
      recentTotalUsdcUsd: "$0.00",
      uniquePayersRecent: 0,
      matchingApexDenominationCount: 0,
      recentTransfers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
