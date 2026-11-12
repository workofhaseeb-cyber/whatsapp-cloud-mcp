import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  handleVerificationRequest,
  parseWebhookPayload,
} from "../src/webhook.js";

const SECRET = "app-secret";
function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("hex");
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a Buffer body", () => {
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + " ", sign(body), SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body), "other")).toBe(false);
  });

  it("rejects a malformed header (no sha256= prefix)", () => {
    expect(verifyWebhookSignature(body, "deadbeef", SECRET)).toBe(false);
  });

  it("rejects a length-mismatched signature", () => {
    expect(verifyWebhookSignature(body, "sha256=abcd", SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
  });
});

describe("handleVerificationRequest", () => {
  it("returns the challenge on a correct token (object)", () => {
    const r = handleVerificationRequest(
      { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1234" },
      "tok",
    );
    expect(r).toBe("1234");
  });

  it("returns the challenge on a correct token (URLSearchParams)", () => {
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "9" });
    expect(handleVerificationRequest(params, "tok")).toBe("9");
  });

  it("returns null on a wrong token", () => {
    const r = handleVerificationRequest(
      { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1234" },
      "tok",
    );
    expect(r).toBeNull();
  });

  it("returns null when mode is not subscribe", () => {
    expect(handleVerificationRequest({ "hub.verify_token": "tok", "hub.challenge": "1" }, "tok")).toBeNull();
  });
});

function envelope(value: unknown) {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value }] }] };
}
const metadata = { display_phone_number: "15550000000", phone_number_id: "PHONE_ID" };

describe("parseWebhookPayload", () => {
  it("returns [] for malformed input", () => {
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload({})).toEqual([]);
    expect(parseWebhookPayload({ entry: "nope" })).toEqual([]);
    expect(parseWebhookPayload("garbage")).toEqual([]);
  });

  it("parses a text message with contact name and timestamp", () => {
    const events = parseWebhookPayload(
      envelope({
        messaging_product: "whatsapp",
        metadata,
        contacts: [{ wa_id: "971501234567", profile: { name: "Haseeb" } }],
        messages: [{ from: "971501234567", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "hi" } }],
      }),
    );
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe("message");
    if (ev.kind !== "message") return;
    expect(ev).toMatchObject({ phoneNumberId: "PHONE_ID", from: "971501234567", contactName: "Haseeb", text: "hi" });
    expect(ev.timestamp.getTime()).toBe(1700000000 * 1000);
  });

  it("parses a button reply", () => {
    const events = parseWebhookPayload(
      envelope({
        metadata,
        messages: [
          {
            from: "971501234567",
            id: "wamid.2",
            timestamp: "1700000001",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } },
          },
        ],
      }),
    );
    const ev = events[0]!;
    if (ev.kind !== "message") throw new Error("expected message");
    expect(ev.buttonReply).toEqual({ id: "yes", title: "Yes" });
  });

  it("parses a list reply with description", () => {
    const events = parseWebhookPayload(
      envelope({
        metadata,
        messages: [
          {
            from: "971501234567",
            id: "wamid.3",
            timestamp: "1700000002",
            type: "interactive",
            interactive: { type: "list_reply", list_reply: { id: "r1", title: "Row 1", description: "d" } },
          },
        ],
      }),
    );
    const ev = events[0]!;
    if (ev.kind !== "message") throw new Error("expected message");
    expect(ev.listReply).toEqual({ id: "r1", title: "Row 1", description: "d" });
  });

  it("parses an image message", () => {
    const events = parseWebhookPayload(
      envelope({
        metadata,
        messages: [
          {
            from: "971501234567",
            id: "wamid.4",
            timestamp: "1700000003",
            type: "image",
            image: { id: "MEDIA_ID", mime_type: "image/jpeg", caption: "look" },
          },
        ],
      }),
    );
    const ev = events[0]!;
    if (ev.kind !== "message") throw new Error("expected message");
    expect(ev.media).toEqual({ id: "MEDIA_ID", mimeType: "image/jpeg", caption: "look", filename: undefined });
  });

  it("parses a status event", () => {
    const events = parseWebhookPayload(
      envelope({
        metadata,
        statuses: [{ id: "wamid.5", status: "delivered", timestamp: "1700000004", recipient_id: "971501234567" }],
      }),
    );
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe("status");
    if (ev.kind !== "status") return;
    expect(ev).toMatchObject({ id: "wamid.5", status: "delivered", recipientId: "971501234567" });
  });

  it("ignores malformed messages but keeps valid ones", () => {
    const events = parseWebhookPayload(
      envelope({
        metadata,
        messages: [{ nonsense: true }, { from: "971501234567", id: "wamid.6", timestamp: "1", type: "text", text: { body: "ok" } }],
      }),
    );
    expect(events).toHaveLength(1);
  });
});
