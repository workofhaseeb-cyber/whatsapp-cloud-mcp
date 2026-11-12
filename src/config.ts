/**
 * Runtime configuration, read from environment variables.
 */
export const DEFAULT_API_VERSION = "v27.0";
export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";

export interface WhatsAppConfig {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  apiVersion: string;
  baseUrl: string;
  dryRun: boolean;
  defaultCountryCode?: string;
  timeoutMs: number;
  /**
   * Directory that local files must live inside to be uploadable via
   * `upload_media`'s `file_path`. When unset, `file_path` uploads are disabled
   * (only `url` uploads are allowed). Guards against an LLM reading arbitrary
   * local files.
   */
  uploadDir?: string;
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isTruthy(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const apiVersion = (env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION).trim();
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error(`WHATSAPP_API_VERSION must look like "v27.0" (got "${apiVersion}")`);
  }
  const cc = env.WHATSAPP_DEFAULT_COUNTRY_CODE?.replace(/\D/g, "") || undefined;
  const timeout = Number(env.WHATSAPP_TIMEOUT_MS ?? 15000);
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || undefined,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || undefined,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || undefined,
    apiVersion,
    baseUrl: (env.WHATSAPP_GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL).replace(/\/+$/, ""),
    dryRun: isTruthy(env.WHATSAPP_DRY_RUN),
    defaultCountryCode: cc,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
    uploadDir: env.WHATSAPP_UPLOAD_DIR?.trim() || undefined,
  };
}
