import http from "node:http";
import { MonitorStore } from "./db";
import { MonitorScheduler } from "./scheduler";
import { renderDashboardHtml } from "./ui";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    if (chunks.reduce((acc, c) => acc + c.length, 0) > 64 * 1024) {
      throw new Error("Payload too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Create the localhost-only HTTP server exposing UI + cron/analytics REST APIs. */
export function createMonitorServer(
  store: MonitorStore,
  scheduler: MonitorScheduler
): http.Server {
  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && reqUrl.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(renderDashboardHtml());
        return;
      }

      if (method === "GET" && reqUrl.pathname === "/api/status") {
        return sendJson(res, 200, {
          ok: true,
          scheduler: scheduler.getState(),
          uptime24h: store.getUptime24h(),
          latestRun: store.getLatestRun(),
        });
      }

      if (method === "GET" && reqUrl.pathname === "/api/history") {
        const limit = Number(reqUrl.searchParams.get("limit") ?? 60);
        return sendJson(res, 200, {
          ok: true,
          runs: store.listHistory(Number.isFinite(limit) ? limit : 60),
        });
      }

      if (method === "GET" && reqUrl.pathname === "/api/alerts") {
        const limit = Number(reqUrl.searchParams.get("limit") ?? 50);
        return sendJson(res, 200, {
          ok: true,
          alerts: store.listAlerts(Number.isFinite(limit) ? limit : 50),
        });
      }

      if (method === "POST" && reqUrl.pathname === "/api/run-now") {
        const run = await scheduler.runOnce("manual");
        return sendJson(res, 200, { ok: true, run });
      }

      if (method === "POST" && reqUrl.pathname === "/api/config") {
        const body = await readJsonBody(req);
        const intervalMs = Number(body.intervalMs);
        if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 86_400_000) {
          return sendJson(res, 400, { ok: false, error: "intervalMs must be 0..86400000" });
        }
        scheduler.updateInterval(intervalMs);
        return sendJson(res, 200, { ok: true, scheduler: scheduler.getState() });
      }

      if (method === "GET" && reqUrl.pathname === "/api/export") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="apexseo-monitor-export.json"',
          "cache-control": "no-store",
        });
        res.end(
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              scheduler: scheduler.getState(),
              uptime24h: store.getUptime24h(),
              latestRun: store.getLatestRun(),
              history: store.listHistory(100),
              alerts: store.listAlerts(100),
            },
            null,
            2
          )
        );
        return;
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
