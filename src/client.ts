/**
 * Thin HTTP client for the WhatsApp Cloud (Graph) API.
 *
 * Uses the global `fetch` (Node 18+) with an AbortController-based timeout.
 * In dry-run mode it never touches the network and instead returns a redacted
 * description of the request it *would* have made — ideal for demos and tests.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { WhatsAppConfig } from "./config.js";
import { ConfigError, WhatsAppApiError } from "./errors.js";

export type FetchLike = typeof fetch;

/** The object returned by any client method when `config.dryRun` is true. */
export interface DryRunResult {
  dry_run: true;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface UploadMediaInput {
  filePath?: string;
  url?: string;
  mimeType?: string;
}

export interface ListTemplatesOptions {
  limit?: number;
  status?: string;
  name?: string;
}

const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".amr": "audio/amr",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
};

const PLACEHOLDER_PHONE_ID = "<PHONE_NUMBER_ID>";
const PLACEHOLDER_WABA_ID = "<BUSINESS_ACCOUNT_ID>";

export interface WhatsAppClientOptions {
  /** Injectable fetch implementation (defaults to global fetch) — handy for tests. */
  fetch?: FetchLike;
}

export class WhatsAppClient {
  private readonly config: WhatsAppConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: WhatsAppConfig, options: WhatsAppClientOptions = {}) {
    this.config = config;
    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== "function") {
      throw new ConfigError("No global fetch available. Use Node 18+ or pass a fetch implementation.");
    }
    this.fetchImpl = impl;
  }

  /** The phone-number id, or a placeholder when dry-running without one. */
  private phoneId(): string {
    if (this.config.phoneNumberId) return this.config.phoneNumberId;
    if (this.config.dryRun) return PLACEHOLDER_PHONE_ID;
    throw new ConfigError(
      "WHATSAPP_PHONE_NUMBER_ID is required to send messages. Set it in your environment (see .env.example).",
    );
  }

  /** The WhatsApp Business Account id, or a placeholder when dry-running without one. */
  private wabaId(): string {
    if (this.config.businessAccountId) return this.config.businessAccountId;
    if (this.config.dryRun) return PLACEHOLDER_WABA_ID;
    throw new ConfigError(
      "WHATSAPP_BUSINESS_ACCOUNT_ID is required to list templates. Set it in your environment (see .env.example).",
    );
  }

  private token(): string {
    if (this.config.accessToken) return this.config.accessToken;
    if (this.config.dryRun) return "<ACCESS_TOKEN>";
    throw new ConfigError(
      "WHATSAPP_ACCESS_TOKEN is required. Set it in your environment (see .env.example).",
    );
  }

  private graphUrl(path: string): string {
    return `${this.config.baseUrl}/${this.config.apiVersion}/${path}`;
  }

  // --- JSON request plumbing -------------------------------------------------

  private async requestJson(
    method: string,
    url: string,
    body: unknown,
  ): Promise<unknown> {
    const token = this.token();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new WhatsAppApiError(408, undefined, `Request to ${url} timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    }
    clearTimeout(timer);
    return this.parseResponse(res, url);
  }

  private async parseResponse(res: Response, url: string): Promise<unknown> {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      throw WhatsAppApiError.fromGraph(res.status, parsed, `Request to ${url} failed with HTTP ${res.status}: ${text}`);
    }
    return parsed ?? {};
  }

  private redactedHeaders(): Record<string, string> {
    return { Authorization: "Bearer ***" };
  }

  // --- Public API ------------------------------------------------------------

  /** POST a message payload to `/{phone-number-id}/messages`. */
  async sendMessage(payload: Record<string, unknown>): Promise<unknown> {
    const url = this.graphUrl(`${this.phoneId()}/messages`);
    if (this.config.dryRun) {
      return this.dryRun("POST", url, payload);
    }
    return this.requestJson("POST", url, payload);
  }

  /** POST a mark-as-read / typing-indicator payload. */
  async markAsRead(payload: Record<string, unknown>): Promise<unknown> {
    const url = this.graphUrl(`${this.phoneId()}/messages`);
    if (this.config.dryRun) {
      return this.dryRun("POST", url, payload);
    }
    return this.requestJson("POST", url, payload);
  }

  /** GET message templates for the configured WhatsApp Business Account. */
  async listTemplates(opts: ListTemplatesOptions = {}): Promise<unknown> {
    const params = new URLSearchParams({
      fields: "name,status,category,language,components",
    });
    params.set("limit", String(opts.limit ?? 25));
    if (opts.status) params.set("status", opts.status);
    if (opts.name) params.set("name", opts.name);
    const url = this.graphUrl(`${this.wabaId()}/message_templates?${params.toString()}`);
    if (this.config.dryRun) {
      return this.dryRun("GET", url, undefined);
    }
    return this.requestJson("GET", url, undefined);
  }

  /** GET the WhatsApp business profile for the configured phone number. */
  async getBusinessProfile(): Promise<unknown> {
    const params = new URLSearchParams({
      fields: "about,address,description,email,profile_picture_url,websites,vertical",
    });
    const url = this.graphUrl(`${this.phoneId()}/whatsapp_business_profile?${params.toString()}`);
    if (this.config.dryRun) {
      return this.dryRun("GET", url, undefined);
    }
    return this.requestJson("GET", url, undefined);
  }

  /** Upload media (from a local file path or a remote URL) to `/{phone-number-id}/media`. */
  async uploadMedia(input: UploadMediaInput): Promise<unknown> {
    if (!!input.filePath === !!input.url) {
      throw new ConfigError("Provide exactly one of `filePath` or `url` to upload_media");
    }
    const url = this.graphUrl(`${this.phoneId()}/media`);
    const sourceName = input.filePath ? basename(input.filePath) : basename(new URL(input.url!).pathname) || "upload";
    const mimeType = input.mimeType ?? inferMime(sourceName);
    if (!mimeType) {
      throw new ConfigError(
        `Could not infer a MIME type for "${sourceName}". Pass mimeType explicitly (e.g. image/jpeg).`,
      );
    }

    if (this.config.dryRun) {
      // Never download or read the file in dry-run — just describe the request.
      return this.dryRun("POST", url, {
        messaging_product: "whatsapp",
        type: mimeType,
        file: input.filePath
          ? { source: "file", path: input.filePath, name: sourceName }
          : { source: "url", url: input.url, name: sourceName, note: "not downloaded in dry-run" },
      });
    }

    const bytes = input.filePath ? await readLocalFile(input.filePath) : await downloadUrl(this.fetchImpl, input.url!);
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new ConfigError(
        `Media is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, which exceeds the 100MB Cloud API limit.`,
      );
    }

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }), sourceName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token()}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new WhatsAppApiError(408, undefined, `Upload to ${url} timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    }
    clearTimeout(timer);
    return this.parseResponse(res, url);
  }

  private dryRun(method: string, url: string, body: unknown): DryRunResult {
    return {
      dry_run: true,
      method,
      url,
      headers: this.redactedHeaders(),
      body,
    };
  }
}

/** Infer a MIME type from a file name's extension, for common WhatsApp media types. */
export function inferMime(name: string): string | undefined {
  return MIME_BY_EXT[extname(name).toLowerCase()];
}

async function readLocalFile(filePath: string): Promise<Uint8Array> {
  const buf = await readFile(filePath);
  return new Uint8Array(buf);
}

async function downloadUrl(fetchImpl: FetchLike, url: string): Promise<Uint8Array> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new WhatsAppApiError(res.status, undefined, `Failed to download media from ${url} (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
