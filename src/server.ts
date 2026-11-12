/**
 * Builds the configured McpServer instance (transport-agnostic).
 */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type WhatsAppConfig } from "./config.js";
import { WhatsAppClient } from "./client.js";
import { registerTools } from "./tools.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };
export const VERSION = pkg.version ?? "0.0.0";

export interface CreateServerOptions {
  /** Injectable fetch implementation, forwarded to WhatsAppClient (handy for tests). */
  fetch?: typeof fetch;
}

/** Create an McpServer wired to the WhatsApp Cloud API with all tools registered. */
export function createServer(config: WhatsAppConfig = loadConfig(), options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "whatsapp-cloud-mcp", version: VERSION },
    {
      instructions:
        "Send WhatsApp messages via the official WhatsApp Cloud API. Remember: free-form messages only work within the 24-hour customer-service window (after the user last messaged you). To start or re-open a conversation, send an approved template with send_template_message. Use dry-run to preview requests safely.",
    },
  );
  const client = new WhatsAppClient(config, { fetch: options.fetch });
  registerTools(server, client, config);
  return server;
}
