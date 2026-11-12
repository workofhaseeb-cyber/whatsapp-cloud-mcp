/**
 * Error types for the WhatsApp Cloud MCP server.
 */

/** Raised when required configuration (token / phone-number-id / waba-id) is missing. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Shape of a Graph API error body (`{ error: { ... } }`). */
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { messaging_product?: string; details?: string };
  fbtrace_id?: string;
}

/**
 * Human-friendly hints for the most common WhatsApp Cloud API error codes.
 * The key is either the `code` or `"code/subcode"`.
 */
const HINTS: Record<number, string> = {
  190: "Access token is expired, invalid or revoked. Generate a new token in Meta for Developers (prefer a long-lived System User token).",
  10: "The app or token is missing a required permission. Ensure whatsapp_business_messaging (and whatsapp_business_management) are granted.",
  200: "The app or token is missing a required permission. Ensure whatsapp_business_messaging (and whatsapp_business_management) are granted.",
  100: "Invalid parameter. Double-check the recipient number, template name/language and the message payload fields.",
  131047:
    "More than 24 hours have passed since the user's last message. You can only re-open the conversation with an approved template message.",
  131026: "Message undeliverable. The recipient may not have WhatsApp, has not accepted the terms, or the number is wrong.",
  131056: "Too many messages to this exact pair (business + recipient) in a short time. Slow down and retry with backoff.",
  130429: "Cloud API throughput limit reached (rate limited). Retry later with exponential backoff.",
  132001: "Template does not exist in this language, or is not approved. Check list_message_templates for name/status/language.",
  131051: "Unsupported message type for this recipient or context.",
  131009: "One of the parameter values is invalid. Verify formats (phone, URLs, currency, date_time).",
  133010: "Phone number is not registered on the WhatsApp Cloud API. Complete number registration in Meta for Developers.",
};

function hintFor(code?: number, subcode?: number): string | undefined {
  if (subcode && HINTS[subcode]) return HINTS[subcode];
  if (code !== undefined && HINTS[code]) return HINTS[code];
  return undefined;
}

/** Error raised when the Graph API returns a non-2xx response. */
export class WhatsAppApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly hint?: string;
  readonly details?: string;

  constructor(status: number, body: GraphErrorBody | undefined, fallbackMessage?: string) {
    const message = body?.message ?? fallbackMessage ?? `WhatsApp Cloud API request failed (HTTP ${status})`;
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.type = body?.type;
    this.fbtraceId = body?.fbtrace_id;
    this.details = body?.error_data?.details;
    this.hint = hintFor(body?.code, body?.error_subcode);
  }

  /** Build from a parsed HTTP response body. */
  static fromGraph(status: number, parsed: unknown, fallbackMessage?: string): WhatsAppApiError {
    const body =
      parsed && typeof parsed === "object" && "error" in parsed
        ? ((parsed as { error: GraphErrorBody }).error ?? undefined)
        : undefined;
    return new WhatsAppApiError(status, body, fallbackMessage);
  }
}
