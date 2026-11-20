/** Self-contained dark slate local dashboard HTML matching ApexSEO aesthetics. */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ApexSEO // Cron Health &amp; x402 Analytics Monitor</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b12;
      --surface: #0f1624;
      --surface-alt: #131d2f;
      --border: #1e2d45;
      --text: #e6edf7;
      --muted: #93a4bd;
      --accent: #38bdf8;
      --accent-strong: #0ea5e9;
      --ok: #34d399;
      --warn: #fbbf24;
      --bad: #f87171;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.5;
      font-size: 14px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono { font-family: var(--mono); }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 20px 20px 56px; }
    .topbar {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
      gap: 14px; padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 20px;
    }
    .brand { display: flex; flex-direction: column; gap: 4px; }
    .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
    .brand .sub { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, select {
      background: var(--surface-alt); color: var(--text); border: 1px solid var(--border);
      border-radius: 8px; padding: 7px 12px; font-size: 12.5px; cursor: pointer; font-family: inherit;
    }
    button.primary { background: var(--accent-strong); border-color: var(--accent); color: #04101d; font-weight: 700; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      border: 1px solid var(--border); background: var(--surface-alt);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .healthy { color: var(--ok); border-color: rgba(52,211,153,.35); }
    .healthy .dot { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
    .degraded { color: var(--warn); border-color: rgba(251,191,36,.35); }
    .degraded .dot { background: var(--warn); }
    .down { color: var(--bad); border-color: rgba(248,113,113,.4); }
    .down .dot { background: var(--bad); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
    .kpi-label { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; }
    .kpi-val { font-size: 24px; font-weight: 700; margin: 4px 0 2px; font-family: var(--mono); }
    .kpi-sub { font-size: 12px; color: var(--muted); }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .card-hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
    .card-hd h2 { margin: 0; font-size: 15px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .tab { padding: 4px 9px; font-size: 11.5px; border-radius: 6px; }
    .tab.active { background: rgba(56,189,248,.16); border-color: var(--accent); color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-family: var(--mono); border: 1px solid var(--border); }
    .b-ok { color: var(--ok); background: rgba(52,211,153,.09); border-color: rgba(52,211,153,.3); }
    .b-warn { color: var(--warn); background: rgba(251,191,36,.09); border-color: rgba(251,191,36,.3); }
    .b-bad { color: var(--bad); background: rgba(248,113,113,.09); border-color: rgba(248,113,113,.3); }
    .spark-wrap { width: 100%; overflow: hidden; }
    .reg-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .reg-item { background: var(--surface-alt); border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; }
    .reg-name { font-weight: 700; font-size: 13px; margin-bottom: 4px; display: flex; justify-content: space-between; }
    .muted { color: var(--muted); }
    @media (max-width: 560px) { .grid-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<div class="wrap">
  <header class="topbar">
    <div class="brand">
      <h1>
        ApexSEO Monitor
        <span id="overall-pill" class="pill"><span class="dot"></span><span>loading</span></span>
      </h1>
      <div class="sub">
        <span class="mono" id="target-url">https://apexseo-geo-mcp.vercel.app</span>
        <span>·</span>
        <span id="next-run">Next cron: —</span>
        <span>·</span>
        <span id="last-run">Last run: —</span>
      </div>
    </div>
    <div class="controls">
      <select id="interval-select" title="Cron interval">
        <option value="30000">Every 30s</option>
        <option value="60000">Every 1m</option>
        <option value="300000">Every 5m</option>
        <option value="900000">Every 15m</option>
        <option value="0">Cron Paused</option>
      </select>
      <button id="run-btn" class="primary">Run Cron Check Now</button>
      <button id="export-btn">Export JSON</button>
    </div>
  </header>

  <section class="kpi-grid" id="kpis"></section>

  <section class="card" style="margin-bottom:16px;">
    <div class="card-hd">
      <h2>Cron Execution Timeline &amp; P50 Latency</h2>
      <span class="muted mono" id="timeline-meta">0 runs recorded</span>
    </div>
    <div class="spark-wrap" id="sparkline"></div>
  </section>

  <section class="card" style="margin-bottom:16px;">
    <div class="card-hd">
      <h2>Live Endpoints, MCP &amp; x402 402-Parity Matrix</h2>
      <div class="tabs" id="probe-tabs">
        <button class="tab active" data-cat="all">All</button>
        <button class="tab" data-cat="x402">x402 402</button>
        <button class="tab" data-cat="mcp">MCP</button>
        <button class="tab" data-cat="discovery">Discovery</button>
        <button class="tab" data-cat="api">API</button>
        <button class="tab" data-cat="failed">Failures</button>
      </div>
    </div>
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Check</th><th>Method</th><th>Status</th><th>Latency</th><th>x402 Parity / Detail</th>
          </tr>
        </thead>
        <tbody id="probe-rows"></tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-bottom:16px;">
    <div class="card-hd">
      <h2>Directories, Trust Verification &amp; CI</h2>
      <span class="muted mono" id="ci-meta">—</span>
    </div>
    <div class="reg-list" id="registries"></div>
  </section>

  <div class="grid-2">
    <section class="card">
      <div class="card-hd">
        <h2>x402-trust Endpoint Grades</h2>
        <span id="trust-badge" class="badge">—</span>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Endpoint</th><th>Grade</th><th>Score</th><th>30d Uptime</th><th>Conf.</th><th>Price</th></tr></thead>
          <tbody id="trust-rows"></tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-hd">
        <h2>Base Mainnet USDC Payout Feed (<span class="mono">0x0d25...63410</span>)</h2>
        <span class="muted mono" id="base-meta">—</span>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Block</th><th>From</th><th>Amount</th><th>Tier Match</th><th>Tx</th></tr></thead>
          <tbody id="base-rows"></tbody>
        </table>
      </div>
    </section>
  </div>

  <div class="grid-2">
    <section class="card">
      <div class="card-hd"><h2>Recent Cron Runs</h2></div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Finished</th><th>Trigger</th><th>Status</th><th>Checks</th><th>P50 / P95</th><th>Dur.</th></tr></thead>
          <tbody id="history-rows"></tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><h2>Alert &amp; State Transition Log</h2></div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Time</th><th>Severity</th><th>Source</th><th>Message</th></tr></thead>
          <tbody id="alert-rows"></tbody>
        </table>
      </div>
    </section>
  </div>
</div>

<script>
const state = { filter: 'all', status: null, history: [], alerts: [] };

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function relTime(iso) {
  if (!iso) return '—';
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) return diffSec >= 0 ? 'in ' + diffSec + 's' : Math.abs(diffSec) + 's ago';
  const mins = Math.round(diffSec / 60);
  return mins >= 0 ? 'in ' + mins + 'm' : Math.abs(mins) + 'm ago';
}

function statusBadge(ok, text) {
  return '<span class="badge ' + (ok ? 'b-ok' : 'b-bad') + '">' + esc(text) + '</span>';
}

function renderAll() {
  const s = state.status;
  if (!s || !s.latestRun) return;
  const run = s.latestRun;
  const sched = s.scheduler;
  const up = s.uptime24h;

  const pill = document.getElementById('overall-pill');
  pill.className = 'pill ' + esc(run.overallStatus);
  pill.innerHTML = '<span class="dot"></span><span>' + esc(run.overallStatus) + (sched.running ? ' (polling...)' : '') + '</span>';

  document.getElementById('target-url').textContent = sched.targetBaseUrl;
  document.getElementById('next-run').textContent = 'Next cron: ' + (sched.nextRunAt ? relTime(sched.nextRunAt) : 'paused');
  document.getElementById('last-run').textContent = 'Last run: ' + relTime(run.finishedAt) + ' (' + run.durationMs + 'ms)';
  document.getElementById('interval-select').value = String(sched.intervalMs);

  const paidEndpoints = run.endpoints.filter(e => e.category === 'x402');
  const paidOk = paidEndpoints.filter(e => e.paymentParityOk).length;
  const stl = run.settlements;

  const kpis = [
    ['Endpoint Health', run.checksPassed + '/' + run.checksTotal, run.overallStatus === 'healthy' ? 'All live probes passing' : 'Check failed rows below'],
    ['Latency P50 / P95', run.p50LatencyMs + ' / ' + run.p95LatencyMs + 'ms', '24h avg P50: ' + up.avgLatencyMs24h + 'ms'],
    ['24h Cron Uptime', up.uptimePct24h + '%', up.healthyRuns24h + '/' + up.totalRuns24h + ' healthy ticks'],
    ['x402 402 Parity', paidOk + '/' + paidEndpoints.length, 'Base eip155:8453 USDC verified'],
    ['x402 Trust', run.trust.verified ? 'VERIFIED ✓' : 'UNVERIFIED', (run.trust.endpointCount ?? 0) + ' monitored endpoints'],
    ['Base Payout Wallet', stl.recentTotalUsdcUsd, stl.recentTransferCount + ' txns / ' + stl.matchingApexDenominationCount + ' Apex-tier (' + (stl.scannedBlocks || 0) + ' blks)']
  ];
  document.getElementById('kpis').innerHTML = kpis.map(([lbl, val, sub]) =>
    '<div class="card"><div class="kpi-label">' + esc(lbl) + '</div><div class="kpi-val">' + esc(val) + '</div><div class="kpi-sub">' + esc(sub) + '</div></div>'
  ).join('');

  // Sparkline
  const histAsc = [...state.history].slice(0, 48).reverse();
  document.getElementById('timeline-meta').textContent = state.history.length + ' runs shown';
  const maxLat = Math.max(100, ...histAsc.map(h => h.p50LatencyMs || 0));
  const w = 1000, ht = 74;
  const bars = histAsc.map((h, idx) => {
    const bw = Math.max(8, Math.floor(w / Math.max(12, histAsc.length)) - 3);
    const x = idx * (bw + 3);
    const bh = Math.max(6, Math.round(((h.p50LatencyMs || 1) / maxLat) * (ht - 14)));
    const y = ht - bh;
    const fill = h.overallStatus === 'healthy' ? '#34d399' : h.overallStatus === 'degraded' ? '#fbbf24' : '#f87171';
    return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="2" fill="' + fill + '"><title>#' + esc(h.id) + ' ' + esc(h.overallStatus) + ' ' + esc(h.p50LatencyMs) + 'ms (' + esc(h.checksPassed) + '/' + esc(h.checksTotal) + ')</title></rect>';
  }).join('');
  document.getElementById('sparkline').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + ht + '" width="100%" height="74" preserveAspectRatio="none">' + bars + '</svg>';

  // Probe rows
  const filtered = run.endpoints.filter(ep => {
    if (state.filter === 'all') return true;
    if (state.filter === 'failed') return !ep.ok;
    return ep.category === state.filter;
  });
  document.getElementById('probe-rows').innerHTML = filtered.map(ep =>
    '<tr>' +
      '<td><strong>' + esc(ep.label) + '</strong><div class="muted mono" style="font-size:11px">' + esc(ep.url) + '</div></td>' +
      '<td class="mono">' + esc(ep.method) + '</td>' +
      '<td>' + statusBadge(ep.ok, ep.actualStatus ?? 'ERR') + ' <span class="muted mono">exp ' + esc(ep.expectedStatus) + '</span></td>' +
      '<td class="mono">' + esc(ep.latencyMs) + 'ms</td>' +
      '<td class="mono" style="font-size:12px">' + esc(ep.detail) + '</td>' +
    '</tr>'
  ).join('');

  // Registries
  const r = run.registries;
  document.getElementById('ci-meta').textContent = (r.githubCi.latestWorkflow || 'GitHub CI') + ': ' + (r.githubCi.conclusion || r.githubCi.status || 'unknown');
  const regCards = [
    {
      name: 'x402scan',
      badge: statusBadge(r.x402scan.httpStatus === 200, r.x402scan.httpStatus ?? 'ERR'),
      body: (r.x402scan.txns !== null ? r.x402scan.txns + ' txns · $' + (r.x402scan.volumeUsd ?? '—') : '4 paid routes live'),
      url: r.x402scan.url
    },
    {
      name: 'Glama Discovery',
      badge: statusBadge(Boolean(r.glama.connectorGrade || r.glama.serverGrade), 'Conn ' + (r.glama.connectorGrade ?? '—') + ' / Repo ' + (r.glama.serverGrade ?? '—')),
      body: esc(r.glama.connectorDesc || r.glama.serverDesc || 'Glama badge ratings'),
      url: r.glama.serverUrl
    },
    {
      name: 'Official MCP Registry',
      badge: statusBadge(Boolean(r.mcpRegistry.version), r.mcpRegistry.version ? 'v' + r.mcpRegistry.version : '—'),
      body: (r.mcpRegistry.serverCount ?? 0) + ' active server record(s)',
      url: r.mcpRegistry.url
    },
    {
      name: '24K Labs / gold-402 PR',
      badge: statusBadge(r.gold402Pr.merged || r.gold402Pr.labels.includes('gate-passed'), r.gold402Pr.merged ? 'MERGED' : (r.gold402Pr.state || '—')),
      body: 'PR #' + r.gold402Pr.number + ' · ' + (r.gold402Pr.labels.join(', ') || 'pending'),
      url: r.gold402Pr.url
    },
    {
      name: 'GitHub Actions CI',
      badge: statusBadge(r.githubCi.conclusion === 'success', r.githubCi.conclusion || r.githubCi.status || '—'),
      body: (r.githubCi.latestWorkflow || 'workflow') + ' @ ' + (r.githubCi.sha || '—'),
      url: r.githubCi.htmlUrl || ('https://github.com/' + r.githubCi.repo + '/actions')
    }
  ];
  document.getElementById('registries').innerHTML = regCards.map(c =>
    '<div class="reg-item"><div class="reg-name"><a href="' + esc(c.url) + '" target="_blank" rel="noreferrer">' + esc(c.name) + '</a>' + c.badge + '</div><div class="muted" style="font-size:12px">' + esc(c.body) + '</div></div>'
  ).join('');

  // x402-trust rows
  const tb = document.getElementById('trust-badge');
  tb.className = 'badge ' + (run.trust.verified ? 'b-ok' : 'b-bad');
  tb.textContent = run.trust.verified ? '✓ provider verified' : (run.trust.error || 'unverified');
  document.getElementById('trust-rows').innerHTML = (run.trust.endpoints || []).length === 0
    ? '<tr><td colspan="6" class="muted">' + esc(run.trust.error || 'No endpoints parsed yet') + '</td></tr>'
    : run.trust.endpoints.map(ep =>
        '<tr><td class="mono"><a href="https://x402-trust.com/endpoint/' + esc(ep.endpointId) + '" target="_blank" rel="noreferrer">' + esc(ep.path) + '</a></td><td>' + esc(ep.grade) + '</td><td class="mono">' + esc(ep.score) + '</td><td class="mono">' + esc(ep.uptime30d) + '</td><td class="mono">' + esc(ep.confidence) + '</td><td class="mono">' + esc(ep.price) + '</td></tr>'
      ).join('');

  // Base USDC feed
  document.getElementById('base-meta').textContent = stl.error ? ('RPC error: ' + stl.error) : ('Blk ' + stl.latestBlock + ' (-' + stl.scannedBlocks + ')');
  document.getElementById('base-rows').innerHTML = stl.recentTransfers.length === 0
    ? '<tr><td colspan="5" class="muted">' + esc(stl.error || 'No incoming USDC transfers in scanned block window') + '</td></tr>'
    : stl.recentTransfers.map(tx =>
        '<tr><td class="mono">' + esc(tx.blockNumber) + '</td><td class="mono">' + esc(tx.from.slice(0, 6) + '..' + tx.from.slice(-4)) + '</td><td class="mono">' + esc(tx.amountUsd) + '</td><td>' + (tx.matchesApexTier ? statusBadge(true, tx.tierLabel) : '<span class="muted">other fleet</span>') + '</td><td><a class="mono" href="https://basescan.org/tx/' + esc(tx.txHash) + '" target="_blank" rel="noreferrer">' + esc(tx.txHash.slice(0, 8)) + '..</a></td></tr>'
      ).join('');

  // History rows
  document.getElementById('history-rows').innerHTML = state.history.slice(0, 14).map(h =>
    '<tr><td class="mono">' + esc(relTime(h.finishedAt)) + '</td><td class="mono">' + esc(h.trigger) + '</td><td>' + statusBadge(h.overallStatus === 'healthy', h.overallStatus) + '</td><td class="mono">' + esc(h.checksPassed) + '/' + esc(h.checksTotal) + '</td><td class="mono">' + esc(h.p50LatencyMs) + '/' + esc(h.p95LatencyMs) + 'ms</td><td class="mono">' + esc(h.durationMs) + 'ms</td></tr>'
  ).join('');

  // Alerts
  document.getElementById('alert-rows').innerHTML = state.alerts.length === 0
    ? '<tr><td colspan="4" class="muted">No state transitions or failures recorded.</td></tr>'
    : state.alerts.slice(0, 14).map(a => {
        const cls = a.severity === 'resolved' ? 'b-ok' : a.severity === 'warn' ? 'b-warn' : 'b-bad';
        return '<tr><td class="mono">' + esc(relTime(a.createdAt)) + '</td><td><span class="badge ' + cls + '">' + esc(a.severity) + '</span></td><td class="mono">' + esc(a.source) + '</td><td>' + esc(a.message) + '</td></tr>';
      }).join('');
}

async function refresh() {
  const [st, hi, al] = await Promise.all([
    fetch('/api/status').then(r => r.json()),
    fetch('/api/history?limit=48').then(r => r.json()),
    fetch('/api/alerts?limit=30').then(r => r.json())
  ]);
  state.status = st;
  state.history = hi.runs || [];
  state.alerts = al.alerts || [];
  renderAll();
}

document.getElementById('probe-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cat]');
  if (!btn) return;
  state.filter = btn.getAttribute('data-cat');
  document.querySelectorAll('#probe-tabs .tab').forEach(el => el.classList.toggle('active', el === btn));
  renderAll();
});

document.getElementById('run-btn').addEventListener('click', async () => {
  const btn = document.getElementById('run-btn');
  btn.disabled = true; btn.textContent = 'Running...';
  try {
    await fetch('/api/run-now', { method: 'POST' });
    await refresh();
  } finally {
    btn.disabled = false; btn.textContent = 'Run Cron Check Now';
  }
});

document.getElementById('interval-select').addEventListener('change', async (e) => {
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intervalMs: Number(e.target.value) })
  });
  await refresh();
});

document.getElementById('export-btn').addEventListener('click', () => {
  window.location.href = '/api/export';
});

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
}
