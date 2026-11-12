/**
 * Minimal WhatsApp webhook receiver built on node:http.
 *
 *   - GET  /webhook  → verification handshake (echoes hub.challenge)
 *   - POST /webhook  → verifies the X-Hub-Signature-256 over the RAW body,
 *                      parses events, marks incoming messages as read, and
 *                      auto-replies "pong" to any message whose text is "ping".
 *
 * Run (after `npm run build`):
 *   WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... \
 *   WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=my-token \
 *   node --experimental-strip-types examples/webhook-server.ts
 *
 * This file imports from the built library (../src/lib.js).
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  loadConfig,
  WhatsAppClient,
  verifyWebhookSignature,
  handleVerificationRequest,
  parseWebhookPayload,
  buildTextMessage,
  buildMarkAsRead,
} from "../src/lib.js";

const config = loadConfig();
const client = new WhatsAppClient(config);
const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "change-me";
const port = Number(process.env.PORT ?? 3000);

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
  void handle(req, res).catch((err: unknown) => {
    console.error("handler error:", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/webhook") {
    const challenge = handleVerificationRequest(url.searchParams, verifyToken);
    if (challenge) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end();
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const raw = await readRawBody(req);
    const signature = req.headers["x-hub-signature-256"];
    if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature, appSecret)) {
      console.warn("rejected webhook: bad signature");
      res.writeHead(401);
      res.end();
      return;
    }

    // Always ACK fast; process afterwards.
    res.writeHead(200);
    res.end();

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    for (const event of parseWebhookPayload(body)) {
      if (event.kind === "status") {
        console.log(`status: ${event.id} → ${event.status} (to ${event.recipientId})`);
        continue;
      }
      console.log(`message from ${event.from} (${event.contactName ?? "unknown"}): ${event.type} ${event.text ?? ""}`);
      try {
        await client.markAsRead(buildMarkAsRead({ message_id: event.id }));
        if (event.text?.trim().toLowerCase() === "ping") {
          await client.sendMessage(buildTextMessage({ to: event.from, body: "pong" }));
          console.log(`auto-replied "pong" to ${event.from}`);
        }
      } catch (err) {
        console.error("reply error:", err);
      }
    }
    return;
  }

  res.writeHead(404);
  res.end();
}

httpServer.listen(port, () => {
  console.error(`webhook server listening on :${port}${config.dryRun ? " [DRY RUN]" : ""}`);
});
