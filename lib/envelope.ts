export interface McpToolEnvelope {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export function wrapToolResult(
  data: unknown,
  meta?: Record<string, unknown>
): McpToolEnvelope {
  const envelope: McpToolEnvelope = {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    envelope.structuredContent = data as Record<string, unknown>;
  }
  if (meta) {
    envelope._meta = meta;
  }
  return envelope;
}

export function wrapToolError(
  message: string,
  extra?: {
    structuredContent?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }
): McpToolEnvelope {
  const text = extra?.structuredContent
    ? JSON.stringify(extra.structuredContent)
    : message;

  const envelope: McpToolEnvelope = {
    isError: true,
    content: [{ type: "text", text }],
  };
  if (extra?.structuredContent) {
    envelope.structuredContent = extra.structuredContent;
  }
  if (extra?.meta) {
    envelope._meta = extra.meta;
  }
  return envelope;
}
