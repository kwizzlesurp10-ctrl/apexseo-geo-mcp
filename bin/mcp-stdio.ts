#!/usr/bin/env node
import readline from "node:readline";
import { handleMcpJsonRpc } from "../lib/mcp-core";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

// Explicit local opt-in only; paid tools require x402 payment unless running local trusted stdio mode
const enforcePayment = process.env.MCP_STDIO_LOCAL_FREE !== "true";

let workQueue = Promise.resolve();
let stdinClosed = false;
let pendingLines = 0;

function exitIfDrained() {
  if (stdinClosed && pendingLines === 0) {
    process.exit(0);
  }
}

async function processLine(trimmed: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON line" },
      }) + "\n"
    );
    return;
  }

  try {
    const response = await handleMcpJsonRpc(parsed, { enforcePayment });
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    const id =
      parsed && typeof parsed === "object" && "id" in parsed
        ? ((parsed as { id?: string | number | null }).id ?? null)
        : null;
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal MCP stdio error",
        },
      }) + "\n"
    );
  }
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  pendingLines += 1;
  workQueue = workQueue.then(async () => {
    try {
      await processLine(trimmed);
    } finally {
      pendingLines -= 1;
      exitIfDrained();
    }
  });
});

rl.on("close", () => {
  stdinClosed = true;
  exitIfDrained();
});
