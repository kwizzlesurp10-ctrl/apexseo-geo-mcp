import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AlertEvent, CronRunSummary, EndpointCheckResult } from "./types";

export interface UptimeStats {
  totalRuns24h: number;
  healthyRuns24h: number;
  uptimePct24h: number;
  avgLatencyMs24h: number;
}

/** Generate transition alerts by comparing the latest run against the immediately preceding run. */
export function evaluateAlerts(
  prevRun: CronRunSummary | null,
  currRun: CronRunSummary
): AlertEvent[] {
  const now = currRun.finishedAt;
  const alerts: AlertEvent[] = [];
  const prevById = new Map<string, EndpointCheckResult>();
  for (const ep of prevRun?.endpoints ?? []) {
    prevById.set(ep.id, ep);
  }

  for (const ep of currRun.endpoints) {
    const prev = prevById.get(ep.id);
    if (!ep.ok && (!prev || prev.ok)) {
      alerts.push({
        createdAt: now,
        severity: ep.paymentParityOk === false ? "critical" : "warn",
        source: ep.id,
        message: `${ep.label} failed (${ep.detail})`,
      });
    } else if (ep.ok && prev && !prev.ok) {
      alerts.push({
        createdAt: now,
        severity: "resolved",
        source: ep.id,
        message: `${ep.label} recovered (${ep.actualStatus}, ${ep.latencyMs}ms)`,
      });
    }
  }

  if (prevRun && prevRun.trust.verified && !currRun.trust.verified && !currRun.trust.error) {
    alerts.push({
      createdAt: now,
      severity: "critical",
      source: "x402-trust",
      message: "x402-trust.com provider verification badge lapsed!",
    });
  } else if (prevRun && !prevRun.trust.verified && currRun.trust.verified) {
    alerts.push({
      createdAt: now,
      severity: "resolved",
      source: "x402-trust",
      message: "x402-trust.com provider verification active",
    });
  }

  if (prevRun && prevRun.overallStatus === "healthy" && currRun.overallStatus !== "healthy") {
    alerts.push({
      createdAt: now,
      severity: currRun.overallStatus === "down" ? "critical" : "warn",
      source: "overall",
      message: `Service transitioned healthy -> ${currRun.overallStatus} (${currRun.checksPassed}/${currRun.checksTotal} checks passing)`,
    });
  } else if (prevRun && prevRun.overallStatus !== "healthy" && currRun.overallStatus === "healthy") {
    alerts.push({
      createdAt: now,
      severity: "resolved",
      source: "overall",
      message: `All ${currRun.checksTotal}/${currRun.checksTotal} checks healthy again`,
    });
  }

  return alerts;
}

/** SQLite-backed persistence layer for cron health runs, endpoint probes, and alerts. */
export class MonitorStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        overall_status TEXT NOT NULL,
        checks_passed INTEGER NOT NULL,
        checks_total INTEGER NOT NULL,
        p50_latency_ms INTEGER NOT NULL,
        p95_latency_ms INTEGER NOT NULL,
        summary_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS endpoint_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        check_id TEXT NOT NULL,
        category TEXT NOT NULL,
        status_code INTEGER,
        latency_ms INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        payment_parity_ok INTEGER,
        detail TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_endpoint_checks_run ON endpoint_checks(run_id);
      CREATE INDEX IF NOT EXISTS idx_cron_runs_finished ON cron_runs(finished_at);

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  getLatestRun(): CronRunSummary | null {
    const row = this.db
      .prepare("SELECT id, summary_json FROM cron_runs ORDER BY id DESC LIMIT 1")
      .get() as { id: number; summary_json: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.summary_json) as CronRunSummary;
    return { ...parsed, id: row.id };
  }

  recordRun(run: CronRunSummary): CronRunSummary {
    const prev = this.getLatestRun();
    const alerts = run.alerts.length > 0 ? run.alerts : evaluateAlerts(prev, run);
    const enriched: CronRunSummary = { ...run, alerts };

    const insertRun = this.db.prepare(`
      INSERT INTO cron_runs (
        started_at, finished_at, duration_ms, trigger,
        overall_status, checks_passed, checks_total,
        p50_latency_ms, p95_latency_ms, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = insertRun.run(
      enriched.startedAt,
      enriched.finishedAt,
      enriched.durationMs,
      enriched.trigger,
      enriched.overallStatus,
      enriched.checksPassed,
      enriched.checksTotal,
      enriched.p50LatencyMs,
      enriched.p95LatencyMs,
      JSON.stringify(enriched)
    );
    const runId = Number(info.lastInsertRowid);

    const insertEp = this.db.prepare(`
      INSERT INTO endpoint_checks (
        run_id, check_id, category, status_code, latency_ms,
        ok, payment_parity_ok, detail, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ep of enriched.endpoints) {
      insertEp.run(
        runId,
        ep.id,
        ep.category,
        ep.actualStatus,
        ep.latencyMs,
        ep.ok ? 1 : 0,
        ep.paymentParityOk === undefined ? null : ep.paymentParityOk ? 1 : 0,
        ep.detail,
        ep.checkedAt
      );
    }

    const insertAlert = this.db.prepare(`
      INSERT INTO alerts (run_id, created_at, severity, source, message)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const alert of alerts) {
      insertAlert.run(runId, alert.createdAt, alert.severity, alert.source, alert.message);
    }

    this.pruneOldRuns(2000);
    return { ...enriched, id: runId };
  }

  private pruneOldRuns(maxKeep: number): void {
    const cutoff = this.db
      .prepare("SELECT id FROM cron_runs ORDER BY id DESC LIMIT 1 OFFSET ?")
      .get(maxKeep) as { id?: number } | undefined;
    if (!cutoff?.id) return;
    this.db.prepare("DELETE FROM endpoint_checks WHERE run_id <= ?").run(cutoff.id);
    this.db.prepare("DELETE FROM alerts WHERE run_id <= ?").run(cutoff.id);
    this.db.prepare("DELETE FROM cron_runs WHERE id <= ?").run(cutoff.id);
  }

  listHistory(limit = 60): Array<{
    id: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    trigger: string;
    overallStatus: string;
    checksPassed: number;
    checksTotal: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, started_at, finished_at, duration_ms, trigger,
                overall_status, checks_passed, checks_total,
                p50_latency_ms, p95_latency_ms
         FROM cron_runs ORDER BY id DESC LIMIT ?`
      )
      .all(Math.max(1, Math.min(500, limit))) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      startedAt: String(r.started_at),
      finishedAt: String(r.finished_at),
      durationMs: Number(r.duration_ms),
      trigger: String(r.trigger),
      overallStatus: String(r.overall_status),
      checksPassed: Number(r.checks_passed),
      checksTotal: Number(r.checks_total),
      p50LatencyMs: Number(r.p50_latency_ms),
      p95LatencyMs: Number(r.p95_latency_ms),
    }));
  }

  listAlerts(limit = 50): AlertEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, created_at, severity, source, message
         FROM alerts ORDER BY id DESC LIMIT ?`
      )
      .all(Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      runId: Number(r.run_id),
      createdAt: String(r.created_at),
      severity: String(r.severity) as AlertEvent["severity"],
      source: String(r.source),
      message: String(r.message),
    }));
  }

  getUptime24h(): UptimeStats {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN overall_status = 'healthy' THEN 1 ELSE 0 END) AS healthy,
                AVG(p50_latency_ms) AS avg_p50
         FROM cron_runs WHERE finished_at >= ?`
      )
      .get(since) as { total?: number; healthy?: number | null; avg_p50?: number | null } | undefined;

    const total = Number(row?.total ?? 0);
    const healthy = Number(row?.healthy ?? 0);
    return {
      totalRuns24h: total,
      healthyRuns24h: healthy,
      uptimePct24h: total > 0 ? Math.round((healthy / total) * 1000) / 10 : 100,
      avgLatencyMs24h: Math.round(Number(row?.avg_p50 ?? 0)),
    };
  }

  close(): void {
    this.db.close();
  }
}
