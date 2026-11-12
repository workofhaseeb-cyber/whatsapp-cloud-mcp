import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../src/server.js";
import type { WhatsAppConfig } from "../src/config.js";

const TOOL_NAMES = [
  "send_text_message",
  "send_template_message",
  "send_media_message",
  "send_interactive_buttons",
  "send_interactive_list",
  "mark_as_read",
  "list_message_templates",
  "get_business_profile",
  "upload_media",
];

function dryConfig(): WhatsAppConfig {
  return {
    accessToken: undefined,
    phoneNumberId: undefined,
    businessAccountId: undefined,
    apiVersion: "v27.0",
    baseUrl: "https://graph.facebook.com",
    dryRun: true,
    defaultCountryCode: "971",
    timeoutMs: 5000,
  };
}

async function connectedClient(config = dryConfig()): Promise<Client> {
  const server = createServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function firstText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content[0]!.text;
}

describe("MCP server", () => {
  it("lists all nine tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  it("send_text_message returns a dry-run payload", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "send_text_message",
      arguments: { to: "+971501234567", body: "hello" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(result));
    expect(parsed.status).toBe("dry_run");
    expect(parsed.to).toBe("971501234567");
    expect(parsed.response.dry_run).toBe(true);
    expect(parsed.response.body.text.body).toBe("hello");
    await client.close();
  });

  it("returns isError for an invalid phone number", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "send_text_message",
      arguments: { to: "not-a-number", body: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/send_text_message:/);
    await client.close();
  });
});
