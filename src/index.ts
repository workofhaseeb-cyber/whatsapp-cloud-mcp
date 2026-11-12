#!/usr/bin/env node
/**
 * Entry point: starts the WhatsApp Cloud MCP server over stdio.
 *
 * All human-facing logging goes to stderr so it never corrupts the JSON-RPC
 * stream on stdout.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer, VERSION } from "./server.js";

const HELP = `whatsapp-cloud-mcp ${VERSION}

Model Context Protocol server for the official WhatsApp Cloud API.

Usage:
  whatsapp-cloud-mcp            Start the MCP server over stdio
  whatsapp-cloud-mcp --help     Show this help
  whatsapp-cloud-mcp --version  Print the version

Environment:
  WHATSAPP_ACCESS_TOKEN         Cloud API access token (required to send)
  WHATSAPP_PHONE_NUMBER_ID      Sender phone-number id (required to send)
  WHATSAPP_BUSINESS_ACCOUNT_ID  WABA id (required for list_message_templates)
  WHATSAPP_API_VERSION          Graph API version (default v27.0)
  WHATSAPP_DEFAULT_COUNTRY_CODE Country code for national numbers (e.g. 971)
  WHATSAPP_DRY_RUN              1/true to preview requests without sending
  WHATSAPP_TIMEOUT_MS           Request timeout in ms (default 15000)
  WHATSAPP_GRAPH_BASE_URL       Graph base URL (default https://graph.facebook.com)

Docs: https://github.com/workofhaseeb-cyber/whatsapp-cloud-mcp
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.connect(transport);
  process.stderr.write(
    `whatsapp-cloud-mcp ${VERSION} started on stdio${config.dryRun ? " [DRY RUN — no messages will be sent]" : ""}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`whatsapp-cloud-mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
