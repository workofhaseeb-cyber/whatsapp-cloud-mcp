/**
 * Phone number normalization to E.164.
 *
 * WhatsApp Cloud API expects the recipient in international format. Users (and LLMs)
 * type numbers in many shapes: "+971 50 123 4567", "00971501234567", "(050) 123-4567".
 * These helpers turn all of them into "+971501234567".
 */
export class PhoneNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNumberError";
  }
}

export interface NormalizeOptions {
  /** Country calling code (digits only, e.g. "971") used for numbers in national format ("050..."). */
  defaultCountryCode?: string;
}

/** Normalize a phone number to E.164 ("+<country><number>"). Throws PhoneNumberError if invalid. */
export function normalizePhoneNumber(input: string, opts: NormalizeOptions = {}): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new PhoneNumberError("Phone number is empty");
  }
  let raw = input.trim();
  // Strip WhatsApp JID suffixes and tel: prefixes.
  raw = raw.replace(/^tel:/i, "").replace(/@(s\.whatsapp\.net|c\.us)$/i, "");
  if (/[a-z]/i.test(raw)) {
    throw new PhoneNumberError(`Phone number "${input}" contains letters`);
  }
  if (/[^\d+\s().\-/]/.test(raw)) {
    throw new PhoneNumberError(`Phone number "${input}" contains invalid characters`);
  }
  const hasPlus = raw.startsWith("+");
  if (raw.lastIndexOf("+") > 0) {
    throw new PhoneNumberError(`Phone number "${input}" has a misplaced "+"`);
  }
  let digits = raw.replace(/\D/g, "");

  if (!hasPlus) {
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.startsWith("0")) {
      const cc = opts.defaultCountryCode?.replace(/\D/g, "");
      if (!cc) {
        throw new PhoneNumberError(
          `Phone number "${input}" is in national format. Use international format (e.g. +971501234567) or set WHATSAPP_DEFAULT_COUNTRY_CODE.`,
        );
      }
      digits = cc + digits.replace(/^0+/, "");
    }
  }

  if (digits.startsWith("0")) {
    throw new PhoneNumberError(`Phone number "${input}" has an invalid country code`);
  }
  if (digits.length < 8 || digits.length > 15) {
    throw new PhoneNumberError(
      `Phone number "${input}" must have 8–15 digits in international format (got ${digits.length})`,
    );
  }
  return `+${digits}`;
}

/** The "to" value for the Cloud API: E.164 digits without the leading "+". */
export function toWhatsAppId(input: string, opts: NormalizeOptions = {}): string {
  return normalizePhoneNumber(input, opts).slice(1);
}
