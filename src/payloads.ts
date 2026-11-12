/**
 * Pure payload builders for the WhatsApp Cloud API `/{phone-number-id}/messages` endpoint.
 * No network access here — everything is easy to unit-test and to show in dry-run mode.
 */
import { z } from "zod";
import { toWhatsAppId, type NormalizeOptions } from "./phone.js";

// Limits documented by Meta for the Cloud API.
export const LIMITS = {
  textBody: 4096,
  caption: 1024,
  interactiveBody: 1024,
  interactiveHeader: 60,
  interactiveFooter: 60,
  buttonTitle: 20,
  buttonId: 256,
  maxButtons: 3,
  listButton: 20,
  listRowTitle: 24,
  listRowDescription: 72,
  listSectionTitle: 24,
  maxListRows: 10,
  maxListSections: 10,
} as const;

const phone = z.string().min(1).describe("Recipient phone number, ideally E.164 (e.g. +971501234567)");
const replyTo = z
  .string()
  .min(1)
  .optional()
  .describe("Optional wamid of a message to reply to (shown as a quoted reply)");

export const sendTextShape = {
  to: phone,
  body: z.string().min(1).max(LIMITS.textBody).describe("Message text (max 4096 chars)"),
  preview_url: z.boolean().optional().describe("Render a link preview for the first URL in the body"),
  reply_to_message_id: replyTo,
};

const templateParameter = z.union([
  z.object({ type: z.literal("text"), text: z.string().min(1), parameter_name: z.string().optional() }),
  z.object({
    type: z.literal("currency"),
    currency: z.object({ fallback_value: z.string(), code: z.string().length(3), amount_1000: z.number().int() }),
  }),
  z.object({ type: z.literal("date_time"), date_time: z.object({ fallback_value: z.string() }) }),
  z.object({ type: z.literal("image"), image: z.object({ link: z.string().url() }) }),
  z.object({ type: z.literal("document"), document: z.object({ link: z.string().url(), filename: z.string().optional() }) }),
  z.object({ type: z.literal("video"), video: z.object({ link: z.string().url() }) }),
  z.object({ type: z.literal("payload"), payload: z.string() }),
]);

export const templateComponent = z.object({
  type: z.enum(["header", "body", "button"]),
  sub_type: z.enum(["quick_reply", "url", "copy_code"]).optional(),
  index: z.union([z.number().int().min(0), z.string()]).optional(),
  parameters: z.array(templateParameter).optional(),
});

export const sendTemplateShape = {
  to: phone,
  template_name: z.string().min(1).describe("Approved template name, e.g. hello_world"),
  language_code: z.string().min(2).default("en_US").describe("Template language code, e.g. en_US or ar"),
  body_parameters: z
    .array(z.string())
    .optional()
    .describe("Shortcut: values for {{1}}, {{2}}… in the template body"),
  components: z
    .array(templateComponent)
    .optional()
    .describe("Full components array (header/body/button parameters) for advanced templates"),
};

export const MEDIA_TYPES = ["image", "document", "video", "audio", "sticker"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const sendMediaShape = {
  to: phone,
  media_type: z.enum(MEDIA_TYPES).describe("Kind of media to send"),
  link: z.string().url().optional().describe("Public HTTPS URL of the media"),
  media_id: z.string().min(1).optional().describe("ID returned by upload_media (use instead of link)"),
  caption: z.string().max(LIMITS.caption).optional().describe("Caption (image, video, document only)"),
  filename: z.string().optional().describe("File name shown for documents"),
  reply_to_message_id: replyTo,
};

export const sendButtonsShape = {
  to: phone,
  body: z.string().min(1).max(LIMITS.interactiveBody).describe("Main message text"),
  buttons: z
    .array(
      z.object({
        id: z.string().min(1).max(LIMITS.buttonId).describe("Payload returned to your webhook when tapped"),
        title: z.string().min(1).max(LIMITS.buttonTitle).describe("Button label (max 20 chars)"),
      }),
    )
    .min(1)
    .max(LIMITS.maxButtons)
    .describe("1–3 quick-reply buttons"),
  header: z.string().max(LIMITS.interactiveHeader).optional().describe("Optional text header"),
  footer: z.string().max(LIMITS.interactiveFooter).optional().describe("Optional footer text"),
  reply_to_message_id: replyTo,
};

export const sendListShape = {
  to: phone,
  body: z.string().min(1).max(LIMITS.interactiveBody),
  button_text: z.string().min(1).max(LIMITS.listButton).describe("Label of the button that opens the list"),
  sections: z
    .array(
      z.object({
        title: z.string().max(LIMITS.listSectionTitle).optional(),
        rows: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              title: z.string().min(1).max(LIMITS.listRowTitle),
              description: z.string().max(LIMITS.listRowDescription).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .max(LIMITS.maxListSections),
  header: z.string().max(LIMITS.interactiveHeader).optional(),
  footer: z.string().max(LIMITS.interactiveFooter).optional(),
};

export const markAsReadShape = {
  message_id: z.string().min(1).describe("wamid of the incoming message"),
  show_typing: z.boolean().optional().describe("Also show a typing indicator to the user"),
};

type Infer<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
export type SendTextInput = Infer<typeof sendTextShape>;
export type SendTemplateInput = z.input<z.ZodObject<typeof sendTemplateShape>>;
export type SendMediaInput = Infer<typeof sendMediaShape>;
export type SendButtonsInput = Infer<typeof sendButtonsShape>;
export type SendListInput = Infer<typeof sendListShape>;
export type MarkAsReadInput = Infer<typeof markAsReadShape>;

export type MessagePayload = Record<string, unknown> & { messaging_product: "whatsapp" };

function envelope(to: string, opts: NormalizeOptions, replyToId?: string): MessagePayload {
  const base: MessagePayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWhatsAppId(to, opts),
  };
  if (replyToId) base.context = { message_id: replyToId };
  return base;
}

export function buildTextMessage(input: SendTextInput, opts: NormalizeOptions = {}): MessagePayload {
  return {
    ...envelope(input.to, opts, input.reply_to_message_id),
    type: "text",
    text: { body: input.body, preview_url: input.preview_url ?? false },
  };
}

export function buildTemplateMessage(input: SendTemplateInput, opts: NormalizeOptions = {}): MessagePayload {
  const components: unknown[] = input.components ? [...input.components] : [];
  if (input.body_parameters?.length) {
    if (components.some((c) => (c as { type?: string }).type === "body")) {
      throw new Error("Use either body_parameters or a body entry in components, not both");
    }
    components.push({
      type: "body",
      parameters: input.body_parameters.map((text) => ({ type: "text", text })),
    });
  }
  const template: Record<string, unknown> = {
    name: input.template_name,
    language: { code: input.language_code ?? "en_US" },
  };
  if (components.length) template.components = components;
  return { ...envelope(input.to, opts), type: "template", template };
}

export function buildMediaMessage(input: SendMediaInput, opts: NormalizeOptions = {}): MessagePayload {
  if (!!input.link === !!input.media_id) {
    throw new Error("Provide exactly one of `link` or `media_id`");
  }
  if (input.link && !input.link.startsWith("https://")) {
    throw new Error("Media `link` must be a public https:// URL");
  }
  if (input.caption && (input.media_type === "audio" || input.media_type === "sticker")) {
    throw new Error(`Captions are not supported for ${input.media_type} messages`);
  }
  if (input.filename && input.media_type !== "document") {
    throw new Error("`filename` is only supported for document messages");
  }
  const media: Record<string, unknown> = input.link ? { link: input.link } : { id: input.media_id };
  if (input.caption) media.caption = input.caption;
  if (input.filename) media.filename = input.filename;
  return {
    ...envelope(input.to, opts, input.reply_to_message_id),
    type: input.media_type,
    [input.media_type]: media,
  };
}

export function buildButtonsMessage(input: SendButtonsInput, opts: NormalizeOptions = {}): MessagePayload {
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const b of input.buttons) {
    if (ids.has(b.id)) throw new Error(`Duplicate button id "${b.id}"`);
    if (titles.has(b.title)) throw new Error(`Duplicate button title "${b.title}"`);
    ids.add(b.id);
    titles.add(b.title);
  }
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: input.body },
    action: {
      buttons: input.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
    },
  };
  if (input.header) interactive.header = { type: "text", text: input.header };
  if (input.footer) interactive.footer = { text: input.footer };
  return { ...envelope(input.to, opts, input.reply_to_message_id), type: "interactive", interactive };
}

export function buildListMessage(input: SendListInput, opts: NormalizeOptions = {}): MessagePayload {
  const rowCount = input.sections.reduce((n, s) => n + s.rows.length, 0);
  if (rowCount > LIMITS.maxListRows) {
    throw new Error(`A list message can contain at most ${LIMITS.maxListRows} rows in total (got ${rowCount})`);
  }
  if (input.sections.length > 1 && input.sections.some((s) => !s.title)) {
    throw new Error("Every section needs a title when there is more than one section");
  }
  const ids = new Set<string>();
  for (const s of input.sections)
    for (const r of s.rows) {
      if (ids.has(r.id)) throw new Error(`Duplicate row id "${r.id}"`);
      ids.add(r.id);
    }
  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: input.body },
    action: { button: input.button_text, sections: input.sections },
  };
  if (input.header) interactive.header = { type: "text", text: input.header };
  if (input.footer) interactive.footer = { text: input.footer };
  return { ...envelope(input.to, opts), type: "interactive", interactive };
}

export function buildMarkAsRead(input: MarkAsReadInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: input.message_id,
  };
  if (input.show_typing) payload.typing_indicator = { type: "text" };
  return payload;
}
