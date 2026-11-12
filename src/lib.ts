/**
 * Public library surface. Import from "whatsapp-cloud-mcp" to use the builders,
 * client, webhook helpers and server factory programmatically.
 */
export {
  loadConfig,
  isTruthy,
  DEFAULT_API_VERSION,
  DEFAULT_GRAPH_BASE_URL,
  type WhatsAppConfig,
} from "./config.js";

export {
  normalizePhoneNumber,
  toWhatsAppId,
  PhoneNumberError,
  type NormalizeOptions,
} from "./phone.js";

export {
  LIMITS,
  MEDIA_TYPES,
  // raw zod shapes
  sendTextShape,
  sendTemplateShape,
  sendMediaShape,
  sendButtonsShape,
  sendListShape,
  markAsReadShape,
  templateComponent,
  // builders
  buildTextMessage,
  buildTemplateMessage,
  buildMediaMessage,
  buildButtonsMessage,
  buildListMessage,
  buildMarkAsRead,
  // types
  type MediaType,
  type MessagePayload,
  type SendTextInput,
  type SendTemplateInput,
  type SendMediaInput,
  type SendButtonsInput,
  type SendListInput,
  type MarkAsReadInput,
} from "./payloads.js";

export {
  WhatsAppClient,
  inferMime,
  assertUploadPathAllowed,
  assertUploadUrlAllowed,
  type FetchLike,
  type DryRunResult,
  type UploadMediaInput,
  type ListTemplatesOptions,
  type WhatsAppClientOptions,
} from "./client.js";

export {
  WhatsAppApiError,
  ConfigError,
  type GraphErrorBody,
} from "./errors.js";

export {
  verifyWebhookSignature,
  handleVerificationRequest,
  parseWebhookPayload,
  type WebhookEvent,
  type MessageEvent,
  type StatusEvent,
  type ButtonReply,
  type ListReply,
  type WebhookMedia,
  type WebhookLocation,
  type MessageContext,
} from "./webhook.js";

export { registerTools } from "./tools.js";
export { createServer, VERSION, type CreateServerOptions } from "./server.js";
