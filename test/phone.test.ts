import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, toWhatsAppId, PhoneNumberError } from "../src/phone.js";

describe("normalizePhoneNumber", () => {
  it("handles international format with spaces and +", () => {
    expect(normalizePhoneNumber("+971 50 123 4567")).toBe("+971501234567");
  });

  it("handles 00 international prefix", () => {
    expect(normalizePhoneNumber("00971501234567")).toBe("+971501234567");
  });

  it("strips punctuation", () => {
    expect(normalizePhoneNumber("+1 (415) 555-0132")).toBe("+14155550132");
  });

  it("uses default country code for national numbers", () => {
    expect(normalizePhoneNumber("050 123 4567", { defaultCountryCode: "971" })).toBe("+971501234567");
  });

  it("drops the national trunk 0 when applying default cc", () => {
    expect(normalizePhoneNumber("0501234567", { defaultCountryCode: "971" })).toBe("+971501234567");
  });

  it("accepts a plain international number without +", () => {
    expect(normalizePhoneNumber("14155550132")).toBe("+14155550132");
  });

  it("strips WhatsApp JID suffixes", () => {
    expect(normalizePhoneNumber("971501234567@s.whatsapp.net")).toBe("+971501234567");
    expect(normalizePhoneNumber("14155550132@c.us")).toBe("+14155550132");
  });

  it("strips tel: prefixes", () => {
    expect(normalizePhoneNumber("tel:+971501234567")).toBe("+971501234567");
  });

  it("rejects national format without a default country code", () => {
    expect(() => normalizePhoneNumber("0501234567")).toThrow(PhoneNumberError);
  });

  it("rejects letters", () => {
    expect(() => normalizePhoneNumber("+1800CALLNOW")).toThrow(/letters/);
  });

  it("rejects empty input", () => {
    expect(() => normalizePhoneNumber("   ")).toThrow(PhoneNumberError);
  });

  it("rejects too short", () => {
    expect(() => normalizePhoneNumber("+12345")).toThrow(/8.{0,3}15 digits/);
  });

  it("rejects too long", () => {
    expect(() => normalizePhoneNumber("+1234567890123456")).toThrow(/8.{0,3}15 digits/);
  });

  it("rejects a misplaced +", () => {
    expect(() => normalizePhoneNumber("971+501234567")).toThrow(/misplaced/);
  });

  it("rejects stray symbols", () => {
    expect(() => normalizePhoneNumber("+971$501234567")).toThrow(/invalid characters/);
  });
});

describe("toWhatsAppId", () => {
  it("returns digits without the leading +", () => {
    expect(toWhatsAppId("+971 50 123 4567")).toBe("971501234567");
  });
});
