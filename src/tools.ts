/**
 * MCP tool registration. Each tool wraps a pure payload builder (payloads.ts)
 * and the HTTP client (client.ts), returning results as pretty-printed JSON.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WhatsAppConfig } from "./config.js";
import type { WhatsAppClient } from "./client.js";
import {
  buildButtonsMessage,
  buildListMessage,
  buildMarkAsRead,
  buildMediaMessage,
  buildTemplateMessage,
  buildTextMessage,
  markAsReadShape,
  sendButtonsShape,
  sendListShape,
  sendMediaShape,
  sendTemplateShape,
  sendTextShape,
  type MessagePayload,
} from "./payloads.js";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(toolName: string, err: unknown): ToolResult {
  let message: string;
  let hint: string | undefined;
  if (err instanceof Error) {
    message = err.message;
    hint = (err as { hint?: string }).hint;
  } else {
    message = String(err);
  }
  const lines = [`${toolName}: ${message}`];
  if (hint) lines.push(`Hint: ${hint}`);
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

/** Shape a raw send response (or dry-run object) into a tidy summary + raw. */
function sendSummary(payload: MessagePayload, response: unknown): ToolResult {
  const to = payload.to;
  let messageId: string | undefined;
  let status = "sent";
  if (response && typeof response === "object") {
    if ("dry_run" in response) {
      status = "dry_run";
    }
    const messages = (response as { messages?: Array<{ id?: string }> }).messages;
    if (Array.isArray(messages) && messages[0]?.id) messageId = messages[0].id;
  }
  return text({
    to,
    message_id: messageId ?? null,
    status,
    response,
  });
}

export function registerTools(server: McpServer, client: WhatsAppClient, config: WhatsAppConfig): void {
  const normalizeOpts = { defaultCountryCode: config.defaultCountryCode };
  const openWorld = { openWorldHint: true, destructiveHint: false } as const;

  server.registerTool(
    "send_text_message",
    {
      title: "Send WhatsApp text message",
      description:
        "Send a plain text WhatsApp message to a phone number. Only works inside the 24-hour customer-service window (i.e. the user messaged you in the last 24h). To start a brand-new conversation, use send_template_message instead.",
      inputSchema: sendTextShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildTextMessage(args, normalizeOpts);
        const res = await client.sendMessage(payload);
        return sendSummary(payload, res);
      } catch (err) {
        return errorResult("send_text_message", err);
      }
    },
  );

  server.registerTool(
    "send_template_message",
    {
      title: "Send WhatsApp template message",
      description:
        "Send a pre-approved WhatsApp message template. Templates are REQUIRED to start a conversation (or to re-engage a user after the 24-hour customer-service window has closed). Use body_parameters for simple {{1}},{{2}} placeholders, or components for advanced header/button parameters. Discover templates with list_message_templates.",
      inputSchema: sendTemplateShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildTemplateMessage(args, normalizeOpts);
        const res = await client.sendMessage(payload);
        return sendSummary(payload, res);
      } catch (err) {
        return errorResult("send_template_message", err);
      }
    },
  );

  server.registerTool(
    "send_media_message",
    {
      title: "Send WhatsApp media message",
      description:
        "Send an image, video, audio, document or sticker, either by a public HTTPS link or by a media_id from upload_media. Captions are supported for image/video/document only. Requires an open 24-hour customer-service window.",
      inputSchema: sendMediaShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildMediaMessage(args, normalizeOpts);
        const res = await client.sendMessage(payload);
        return sendSummary(payload, res);
      } catch (err) {
        return errorResult("send_media_message", err);
      }
    },
  );

  server.registerTool(
    "send_interactive_buttons",
    {
      title: "Send WhatsApp reply buttons",
      description:
        "Send up to 3 quick-reply buttons with a message. The user's tap is delivered to your webhook as a button reply (id + title). Requires an open 24-hour customer-service window.",
      inputSchema: sendButtonsShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildButtonsMessage(args, normalizeOpts);
        const res = await client.sendMessage(payload);
        return sendSummary(payload, res);
      } catch (err) {
        return errorResult("send_interactive_buttons", err);
      }
    },
  );

  server.registerTool(
    "send_interactive_list",
    {
      title: "Send WhatsApp list message",
      description:
        "Send a tappable list menu (up to 10 rows total across sections). The user's selection is delivered to your webhook as a list reply (id + title). Requires an open 24-hour customer-service window.",
      inputSchema: sendListShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildListMessage(args, normalizeOpts);
        const res = await client.sendMessage(payload);
        return sendSummary(payload, res);
      } catch (err) {
        return errorResult("send_interactive_list", err);
      }
    },
  );

  server.registerTool(
    "mark_as_read",
    {
      title: "Mark WhatsApp message as read",
      description:
        "Mark an incoming message as read (blue ticks), optionally also showing a typing indicator. Pass the wamid of the message you received.",
      inputSchema: markAsReadShape,
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const payload = buildMarkAsRead(args);
        const res = await client.markAsRead(payload);
        return text(res);
      } catch (err) {
        return errorResult("mark_as_read", err);
      }
    },
  );

  server.registerTool(
    "list_message_templates",
    {
      title: "List WhatsApp message templates",
      description:
        "List the message templates for your WhatsApp Business Account, including their approval status, category and language. Use this to find a template name/language to pass to send_template_message.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(25).describe("Max templates to return (1-100)"),
        status: z
          .enum(["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"])
          .optional()
          .describe("Filter by approval status"),
        name: z.string().min(1).optional().describe("Filter by (exact) template name"),
      },
      annotations: { readOnlyHint: true, ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        const res = await client.listTemplates({ limit: args.limit, status: args.status, name: args.name });
        return text(res);
      } catch (err) {
        return errorResult("list_message_templates", err);
      }
    },
  );

  server.registerTool(
    "get_business_profile",
    {
      title: "Get WhatsApp business profile",
      description:
        "Fetch the public WhatsApp business profile for your phone number (about, address, description, email, websites, vertical, profile picture).",
      inputSchema: {},
      annotations: { readOnlyHint: true, ...openWorld },
    },
    async (): Promise<ToolResult> => {
      try {
        const res = await client.getBusinessProfile();
        return text(res);
      } catch (err) {
        return errorResult("get_business_profile", err);
      }
    },
  );

  server.registerTool(
    "upload_media",
    {
      title: "Upload WhatsApp media",
      description:
        "Upload a media file to WhatsApp and get back a media_id you can reuse in send_media_message. Provide exactly one of file_path (a local file) or url (a remote file to fetch). file_path only works when the server is configured with WHATSAPP_UPLOAD_DIR and the file lives inside it; url must be a public https:// URL. The MIME type is inferred from the file extension when not given. Max 100MB.",
      inputSchema: {
        file_path: z
          .string()
          .min(1)
          .optional()
          .describe("Path to a local file inside WHATSAPP_UPLOAD_DIR to upload (disabled if that env is unset)"),
        url: z.string().url().optional().describe("Public https:// URL to fetch and upload"),
        mime_type: z.string().min(1).optional().describe("MIME type, e.g. image/jpeg (inferred if omitted)"),
      },
      annotations: { ...openWorld },
    },
    async (args): Promise<ToolResult> => {
      try {
        if (!!args.file_path === !!args.url) {
          throw new Error("Provide exactly one of `file_path` or `url`");
        }
        const res = await client.uploadMedia({
          filePath: args.file_path,
          url: args.url,
          mimeType: args.mime_type,
        });
        return text(res);
      } catch (err) {
        return errorResult("upload_media", err);
      }
    },
  );
}
