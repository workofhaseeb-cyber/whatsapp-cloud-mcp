import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhatsAppClient, assertUploadPathAllowed, assertUploadUrlAllowed } from "../src/client.js";
import { WhatsAppApiError, ConfigError } from "../src/errors.js";
import type { WhatsAppConfig } from "../src/config.js";

function config(over: Partial<WhatsAppConfig> = {}): WhatsAppConfig {
  return {
    accessToken: "TOKEN",
    phoneNumberId: "PHONE_ID",
    businessAccountId: "WABA_ID",
    apiVersion: "v27.0",
    baseUrl: "https://graph.facebook.com",
    dryRun: false,
    defaultCountryCode: "971",
    timeoutMs: 5000,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("dry-run", () => {
  it("returns a redacted payload and never calls fetch", async () => {
    const fetchMock = vi.fn();
    const client = new WhatsAppClient(config({ dryRun: true }), { fetch: fetchMock as unknown as typeof fetch });
    const res = (await client.sendMessage({ messaging_product: "whatsapp", to: "971501234567", type: "text" })) as {
      dry_run: boolean;
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.dry_run).toBe(true);
    expect(res.method).toBe("POST");
    expect(res.url).toBe("https://graph.facebook.com/v27.0/PHONE_ID/messages");
    expect(res.headers.Authorization).toBe("Bearer ***");
  });

  it("uses placeholders when ids are missing", async () => {
    const client = new WhatsAppClient(config({ dryRun: true, phoneNumberId: undefined, accessToken: undefined }));
    const res = (await client.sendMessage({ messaging_product: "whatsapp" })) as { url: string };
    expect(res.url).toContain("<PHONE_NUMBER_ID>");
  });

  it("describes a url upload without downloading it", async () => {
    const fetchMock = vi.fn();
    const client = new WhatsAppClient(config({ dryRun: true }), { fetch: fetchMock as unknown as typeof fetch });
    const res = (await client.uploadMedia({ url: "https://example.com/menu.png" })) as { body: { type: string } };
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.body.type).toBe("image/png");
  });
});

describe("upload guards", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "wa-upload-"));
    await writeFile(join(dir, "ok.png"), "x");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("disables file_path uploads when WHATSAPP_UPLOAD_DIR is unset", async () => {
    await expect(assertUploadPathAllowed("/etc/passwd", undefined)).rejects.toBeInstanceOf(ConfigError);
  });

  it("allows files inside the upload dir", async () => {
    await expect(assertUploadPathAllowed(join(dir, "ok.png"), dir)).resolves.toMatch(/ok\.png$/);
  });

  it("rejects traversal outside the upload dir", async () => {
    await expect(assertUploadPathAllowed(join(dir, "..", "..", "etc", "hosts"), dir)).rejects.toThrow(/outside|not found/);
  });

  it("rejects symlinks that escape the upload dir", async () => {
    await symlink("/etc/hosts", join(dir, "escape.png"));
    await expect(assertUploadPathAllowed(join(dir, "escape.png"), dir)).rejects.toThrow(/outside/);
  });

  it.each([
    "http://example.com/a.png",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://10.0.0.5/a.png",
    "https://172.20.1.1/a.png",
    "https://192.168.1.1/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.png",
    "https://[fd00::1]/a.png",
  ])("rejects unsafe url %s", (u) => {
    expect(() => assertUploadUrlAllowed(u)).toThrow(ConfigError);
  });

  it("accepts a public https url", () => {
    expect(assertUploadUrlAllowed("https://cdn.example.com/a.png").hostname).toBe("cdn.example.com");
  });
});

describe("real mode", () => {
  it("POSTs to the messages URL with a Bearer header", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ messages: [{ id: "wamid.OK" }] }));
    const client = new WhatsAppClient(config(), { fetch: fetchMock as unknown as typeof fetch });
    const res = (await client.sendMessage({ messaging_product: "whatsapp", to: "971" })) as {
      messages: Array<{ id: string }>;
    };
    expect(res.messages[0]!.id).toBe("wamid.OK");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v27.0/PHONE_ID/messages");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
  });

  it("GETs templates with the right query and fields", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ data: [] }));
    const client = new WhatsAppClient(config(), { fetch: fetchMock as unknown as typeof fetch });
    await client.listTemplates({ limit: 10, status: "APPROVED", name: "hello" });
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v27.0/WABA_ID/message_templates?");
    expect(String(url)).toContain("limit=10");
    expect(String(url)).toContain("status=APPROVED");
    expect(String(url)).toContain("name=hello");
  });

  it("maps a Graph error into WhatsAppApiError with a hint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "token expired", code: 190, type: "OAuthException", fbtrace_id: "abc" } }, 401),
    );
    const client = new WhatsAppClient(config(), { fetch: fetchMock as unknown as typeof fetch });
    await expect(client.sendMessage({ messaging_product: "whatsapp" })).rejects.toMatchObject({
      name: "WhatsAppApiError",
      status: 401,
      code: 190,
      fbtraceId: "abc",
    });
    try {
      await client.sendMessage({ messaging_product: "whatsapp" });
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppApiError);
      expect((err as WhatsAppApiError).hint).toMatch(/expired|invalid/i);
    }
  });

  it("maps the 24h-window error (131047) to a template hint", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ error: { message: "re-engagement", code: 131047 } }, 400));
    const client = new WhatsAppClient(config(), { fetch: fetchMock as unknown as typeof fetch });
    try {
      await client.sendMessage({ messaging_product: "whatsapp" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as WhatsAppApiError).hint).toMatch(/template/i);
    }
  });
});

describe("missing config", () => {
  it("throws ConfigError when the phone id is missing (non-dry-run)", async () => {
    const client = new WhatsAppClient(config({ phoneNumberId: undefined }));
    await expect(client.sendMessage({ messaging_product: "whatsapp" })).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError when the waba id is missing for templates", async () => {
    const client = new WhatsAppClient(config({ businessAccountId: undefined }));
    await expect(client.listTemplates()).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError when the token is missing", async () => {
    const client = new WhatsAppClient(config({ accessToken: undefined }));
    await expect(client.getBusinessProfile()).rejects.toBeInstanceOf(ConfigError);
  });
});
