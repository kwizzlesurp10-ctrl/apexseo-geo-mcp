import {
  fetchBaseUsdcSettlements,
  fetchRegistriesStatus,
  fetchX402TrustStatus,
} from "./aggregators";
import { MonitorStore } from "./db";
import { computeLatencyPercentiles, probeAllEndpoints } from "./probes";
import type {
  CronRunSummary,
  HealthOverallStatus,
  MonitorConfig,
  TriggerKind,
} from "./types";

/** Derive overall health status from endpoint and payment parity results. */
export function classifyOverallStatus(
  endpoints: CronRunSummary["endpoints"]
): HealthOverallStatus {
  if (endpoints.length === 0) return "down";
  const passed = endpoints.filter((e) => e.ok).length;
  const healthCheck = endpoints.find((e) => e.id === "api:health");
  const parityFailed = endpoints.some((e) => e.paymentParityOk === false);
  if ((healthCheck && !healthCheck.ok) || passed === 0 || parityFailed) {
    return "down";
  }
  return passed === endpoints.length ? "healthy" : "degraded";
}

/** Coordinates scheduled cron health runs with an overlap-prevention lock. */
export class MonitorScheduler {
  private inFlight: Promise<CronRunSummary> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextRunAt: string | null = null;
  private intervalMs: number;
  private readonly startedEpochMs = Date.now();

  constructor(
    private readonly config: MonitorConfig,
    private readonly store: MonitorStore
  ) {
    const saved = store.getSetting("interval_ms");
    const parsedSaved = saved ? Number(saved) : NaN;
    this.intervalMs = Number.isFinite(parsedSaved) && parsedSaved >= 0 ? parsedSaved : config.intervalMs;
  }

  getState() {
    return {
      running: this.inFlight !== null,
      intervalMs: this.intervalMs,
      nextRunAt: this.nextRunAt,
      targetBaseUrl: this.config.targetBaseUrl,
      uptimeSec: Math.round((Date.now() - this.startedEpochMs) / 1000),
    };
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
  }

  updateInterval(intervalMs: number): void {
    const sanitized = Math.max(0, Math.round(intervalMs));
    this.intervalMs = sanitized;
    this.store.setSetting("interval_ms", String(sanitized));
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.intervalMs <= 0) {
      this.nextRunAt = null;
      return;
    }
    this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.timer = setTimeout(() => {
      void this.runOnce("cron").finally(() => {
        if (this.intervalMs > 0) this.scheduleNext();
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async runOnce(trigger: TriggerKind): Promise<CronRunSummary> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const exec = async (): Promise<CronRunSummary> => {
      const t0 = performance.now();
      const startedAt = new Date().toISOString();

      const [endpoints, trust, registries, settlements] = await Promise.all([
        probeAllEndpoints(this.config.targetBaseUrl),
        fetchX402TrustStatus(),
        fetchRegistriesStatus(),
        fetchBaseUsdcSettlements(this.config.baseRpcUrl, this.config.lookbackBlocks),
      ]);

      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(1, Math.round(performance.now() - t0));
      const { p50, p95 } = computeLatencyPercentiles(endpoints.map((e) => e.latencyMs));
      const checksPassed = endpoints.filter((e) => e.ok).length;
      const overallStatus = classifyOverallStatus(endpoints);

      const saved = this.store.recordRun({
        startedAt,
        finishedAt,
        durationMs,
        trigger,
        overallStatus,
        checksPassed,
        checksTotal: endpoints.length,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        endpoints,
        trust,
        registries,
        settlements,
        alerts: [],
      });

      if (this.config.alertWebhookUrl && saved.alerts.length > 0) {
        void fetch(this.config.alertWebhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            service: "apexseo-geo-mcp",
            status: saved.overallStatus,
            alerts: saved.alerts,
            finishedAt: saved.finishedAt,
          }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
      }

      return saved;
    };

    this.inFlight = exec().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
