/**
 * Helpers for receiving WhatsApp Cloud API webhooks: signature verification,
 * the GET verification handshake, and normalizing the (deeply nested) event
 * payload into a flat, discriminated union that is pleasant to consume.
 *
 * None of these functions throw on bad input — they return `false`/`null`/`[]`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify the `X-Hub-Signature-256` header (`sha256=<hex>`) for a raw request body
 * using HMAC-SHA256 and the app secret. Returns false on any malformation.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1]!, "hex");
  if (provided.length === 0) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  const expected = createHmac("sha256", appSecret).update(body).digest();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

type VerificationQuery =
  | {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    }
  | URLSearchParams;

/**
 * Handle the GET verification request Meta sends when you subscribe a webhook.
 * Returns the challenge string to echo back on success, or null otherwise.
 */
export function handleVerificationRequest(query: VerificationQuery, verifyToken: string): string | null {
  const get = (key: string): string | undefined =>
    query instanceof URLSearchParams ? (query.get(key) ?? undefined) : (query as Record<string, string | undefined>)[key];
  const mode = get("hub.mode");
  const token = get("hub.verify_token");
  const challenge = get("hub.challenge");
  if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}

export interface ButtonReply {
  id: string;
  title: string;
}
export interface ListReply {
  id: string;
  title: string;
  description?: string;
}
export interface WebhookMedia {
  id?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}
export interface WebhookLocation {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
}
export interface MessageContext {
  from?: string;
  id?: string;
}

export interface MessageEvent {
  kind: "message";
  phoneNumberId?: string;
  from: string;
  contactName?: string;
  id: string;
  timestamp: Date;
  type: string;
  text?: string;
  buttonReply?: ButtonReply;
  listReply?: ListReply;
  media?: WebhookMedia;
  location?: WebhookLocation;
  context?: MessageContext;
  raw: unknown;
}

export interface StatusEvent {
  kind: "status";
  phoneNumberId?: string;
  id: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errors?: unknown[];
  raw: unknown;
}

export type WebhookEvent = MessageEvent | StatusEvent;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toDate(ts: unknown): Date {
  const n = typeof ts === "string" ? Number(ts) : typeof ts === "number" ? ts : NaN;
  // WhatsApp timestamps are seconds since epoch.
  return Number.isFinite(n) ? new Date(n * 1000) : new Date(0);
}

/** Normalize a raw webhook POST body into a flat list of events. Never throws. */
export function parseWebhookPayload(body: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  if (!isObject(body)) return events;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isObject(change)) continue;
      const value = change.value;
      if (!isObject(value)) continue;
      const metadata = isObject(value.metadata) ? value.metadata : undefined;
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : undefined;

      const contactsById = new Map<string, string>();
      if (Array.isArray(value.contacts)) {
        for (const c of value.contacts) {
          if (isObject(c) && typeof c.wa_id === "string") {
            const profile = isObject(c.profile) ? c.profile : undefined;
            if (typeof profile?.name === "string") contactsById.set(c.wa_id, profile.name);
          }
        }
      }

      if (Array.isArray(value.messages)) {
        for (const m of value.messages) {
          const ev = parseMessage(m, phoneNumberId, contactsById);
          if (ev) events.push(ev);
        }
      }
      if (Array.isArray(value.statuses)) {
        for (const s of value.statuses) {
          const ev = parseStatus(s, phoneNumberId);
          if (ev) events.push(ev);
        }
      }
    }
  }
  return events;
}

function parseMessage(
  m: unknown,
  phoneNumberId: string | undefined,
  contacts: Map<string, string>,
): MessageEvent | null {
  if (!isObject(m)) return null;
  const from = typeof m.from === "string" ? m.from : undefined;
  const id = typeof m.id === "string" ? m.id : undefined;
  const type = typeof m.type === "string" ? m.type : undefined;
  if (!from || !id || !type) return null;

  const ev: MessageEvent = {
    kind: "message",
    phoneNumberId,
    from,
    contactName: contacts.get(from),
    id,
    timestamp: toDate(m.timestamp),
    type,
    raw: m,
  };

  if (isObject(m.context)) {
    ev.context = {
      from: typeof m.context.from === "string" ? m.context.from : undefined,
      id: typeof m.context.id === "string" ? m.context.id : undefined,
    };
  }

  if (isObject(m.text) && typeof m.text.body === "string") {
    ev.text = m.text.body;
  }

  if (isObject(m.interactive)) {
    const interactive = m.interactive;
    if (isObject(interactive.button_reply)) {
      const br = interactive.button_reply;
      if (typeof br.id === "string" && typeof br.title === "string") {
        ev.buttonReply = { id: br.id, title: br.title };
      }
    }
    if (isObject(interactive.list_reply)) {
      const lr = interactive.list_reply;
      if (typeof lr.id === "string" && typeof lr.title === "string") {
        ev.listReply = {
          id: lr.id,
          title: lr.title,
          description: typeof lr.description === "string" ? lr.description : undefined,
        };
      }
    }
  }

  // Legacy quick-reply buttons arrive as `button` with { payload, text }.
  if (!ev.buttonReply && isObject(m.button)) {
    const b = m.button;
    if (typeof b.payload === "string" || typeof b.text === "string") {
      ev.buttonReply = {
        id: typeof b.payload === "string" ? b.payload : "",
        title: typeof b.text === "string" ? b.text : "",
      };
    }
  }

  // Media types (image/video/audio/document/sticker) share a similar object.
  for (const mt of ["image", "video", "audio", "document", "sticker"]) {
    const media = (m as Record<string, unknown>)[mt];
    if (isObject(media)) {
      ev.media = {
        id: typeof media.id === "string" ? media.id : undefined,
        mimeType: typeof media.mime_type === "string" ? media.mime_type : undefined,
        caption: typeof media.caption === "string" ? media.caption : undefined,
        filename: typeof media.filename === "string" ? media.filename : undefined,
      };
      break;
    }
  }

  if (isObject(m.location)) {
    const loc = m.location;
    ev.location = {
      latitude: typeof loc.latitude === "number" ? loc.latitude : undefined,
      longitude: typeof loc.longitude === "number" ? loc.longitude : undefined,
      name: typeof loc.name === "string" ? loc.name : undefined,
      address: typeof loc.address === "string" ? loc.address : undefined,
    };
  }

  return ev;
}

function parseStatus(s: unknown, phoneNumberId: string | undefined): StatusEvent | null {
  if (!isObject(s)) return null;
  const id = typeof s.id === "string" ? s.id : undefined;
  const status = typeof s.status === "string" ? s.status : undefined;
  const recipientId = typeof s.recipient_id === "string" ? s.recipient_id : undefined;
  if (!id || !status || !recipientId) return null;
  return {
    kind: "status",
    phoneNumberId,
    id,
    recipientId,
    status,
    timestamp: toDate(s.timestamp),
    errors: Array.isArray(s.errors) ? s.errors : undefined,
    raw: s,
  };
}
