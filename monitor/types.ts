export type HealthOverallStatus = "healthy" | "degraded" | "down";
export type CheckCategory = "api" | "x402" | "mcp" | "discovery";
export type TriggerKind = "cron" | "manual" | "cli";
export type AlertSeverity = "warn" | "critical" | "resolved";

export interface MonitorConfig {
  targetBaseUrl: string;
  host: string;
  port: number;
  intervalMs: number;
  baseRpcUrl: string;
  lookbackBlocks: number;
  dbPath: string;
  alertWebhookUrl?: string;
}

export interface EndpointCheckResult {
  id: string;
  label: string;
  category: CheckCategory;
  url: string;
  method: "GET" | "POST";
  expectedStatus: number;
  actualStatus: number | null;
  latencyMs: number;
  ok: boolean;
  detail: string;
  paymentParityOk?: boolean;
  payTo?: string;
  amountAtomic?: string;
  network?: string;
  asset?: string;
  checkedAt: string;
}

export interface X402TrustEndpointRow {
  endpointId: string;
  path: string;
  grade: string;
  score: string;
  uptime30d: string;
  confidence: string;
  price: string;
}

export interface X402TrustSnapshot {
  providerUrl: string;
  verified: boolean;
  endpointCount: number | null;
  avgTrustScore: string | null;
  endpoints: X402TrustEndpointRow[];
  fetchedAt: string;
  error?: string;
}

export interface RegistrySnapshot {
  x402scan: {
    url: string;
    httpStatus: number | null;
    txns: number | null;
    volumeUsd: string | null;
    buyers: number | null;
    error?: string;
  };
  glama: {
    serverUrl: string;
    connectorUrl: string;
    serverGrade: string | null;
    serverDesc: string | null;
    connectorGrade: string | null;
    connectorDesc: string | null;
    error?: string;
  };
  mcpRegistry: {
    url: string;
    httpStatus: number | null;
    version: string | null;
    serverCount: number | null;
    error?: string;
  };
  gold402Pr: {
    url: string;
    number: number;
    state: string | null;
    merged: boolean;
    labels: string[];
    error?: string;
  };
  githubCi: {
    repo: string;
    latestWorkflow: string | null;
    status: string | null;
    conclusion: string | null;
    sha: string | null;
    htmlUrl: string | null;
    updatedAt: string | null;
    error?: string;
  };
}

export interface UsdcTransferEvent {
  txHash: string;
  blockNumber: number;
  from: string;
  amountAtomic: string;
  amountUsd: string;
  matchesApexTier: boolean;
  tierLabel: string | null;
}

export interface BaseSettlementSnapshot {
  network: string;
  payTo: string;
  usdcContract: string;
  latestBlock: number | null;
  scannedFromBlock: number | null;
  scannedBlocks: number;
  recentTransferCount: number;
  recentTotalUsdcAtomic: string;
  recentTotalUsdcUsd: string;
  uniquePayersRecent: number;
  matchingApexDenominationCount: number;
  recentTransfers: UsdcTransferEvent[];
  error?: string;
}

export interface AlertEvent {
  id?: number;
  runId?: number;
  createdAt: string;
  severity: AlertSeverity;
  source: string;
  message: string;
}

export interface CronRunSummary {
  id?: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trigger: TriggerKind;
  overallStatus: HealthOverallStatus;
  checksPassed: number;
  checksTotal: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  endpoints: EndpointCheckResult[];
  trust: X402TrustSnapshot;
  registries: RegistrySnapshot;
  settlements: BaseSettlementSnapshot;
  alerts: AlertEvent[];
}
