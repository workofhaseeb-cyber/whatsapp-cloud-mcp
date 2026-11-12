import { describe, it, expect } from "vitest";
import {
  buildTextMessage,
  buildTemplateMessage,
  buildMediaMessage,
  buildButtonsMessage,
  buildListMessage,
  buildMarkAsRead,
} from "../src/payloads.js";

const to = "+971501234567";
const wa = "971501234567";

describe("buildTextMessage", () => {
  it("builds a text envelope", () => {
    const p = buildTextMessage({ to, body: "hi", preview_url: true });
    expect(p).toMatchObject({
      messaging_product: "whatsapp",
      to: wa,
      type: "text",
      text: { body: "hi", preview_url: true },
    });
  });

  it("adds a quoted reply context", () => {
    const p = buildTextMessage({ to, body: "hi", reply_to_message_id: "wamid.X" });
    expect(p.context).toEqual({ message_id: "wamid.X" });
  });
});

describe("buildTemplateMessage", () => {
  it("builds body_parameters into a body component", () => {
    const p = buildTemplateMessage({ to, template_name: "hello", language_code: "en_US", body_parameters: ["A", "B"] });
    expect(p.template).toMatchObject({
      name: "hello",
      language: { code: "en_US" },
      components: [{ type: "body", parameters: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }],
    });
  });

  it("rejects both body_parameters and a body component", () => {
    expect(() =>
      buildTemplateMessage({
        to,
        template_name: "hello",
        body_parameters: ["A"],
        components: [{ type: "body", parameters: [{ type: "text", text: "A" }] }],
      }),
    ).toThrow(/either body_parameters or a body/);
  });
});

describe("buildMediaMessage", () => {
  it("builds a link image", () => {
    const p = buildMediaMessage({ to, media_type: "image", link: "https://x/y.jpg", caption: "c" });
    expect(p).toMatchObject({ type: "image", image: { link: "https://x/y.jpg", caption: "c" } });
  });

  it("builds an id document with filename", () => {
    const p = buildMediaMessage({ to, media_type: "document", media_id: "123", filename: "f.pdf" });
    expect(p).toMatchObject({ type: "document", document: { id: "123", filename: "f.pdf" } });
  });

  it("rejects both link and id", () => {
    expect(() => buildMediaMessage({ to, media_type: "image", link: "https://x/y.jpg", media_id: "1" })).toThrow(
      /exactly one/,
    );
  });

  it("rejects neither link nor id", () => {
    expect(() => buildMediaMessage({ to, media_type: "image" })).toThrow(/exactly one/);
  });

  it("rejects a non-https link", () => {
    expect(() => buildMediaMessage({ to, media_type: "image", link: "http://x/y.jpg" })).toThrow(/https/);
  });

  it("rejects a caption on audio", () => {
    expect(() => buildMediaMessage({ to, media_type: "audio", media_id: "1", caption: "no" })).toThrow(
      /not supported for audio/,
    );
  });

  it("rejects a filename on non-document", () => {
    expect(() => buildMediaMessage({ to, media_type: "image", media_id: "1", filename: "x.png" })).toThrow(
      /only supported for document/,
    );
  });
});

describe("buildButtonsMessage", () => {
  it("builds reply buttons", () => {
    const p = buildButtonsMessage({ to, body: "pick", buttons: [{ id: "a", title: "A" }, { id: "b", title: "B" }] });
    expect(p).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "pick" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "a", title: "A" } },
            { type: "reply", reply: { id: "b", title: "B" } },
          ],
        },
      },
    });
  });

  it("rejects duplicate button ids", () => {
    expect(() =>
      buildButtonsMessage({ to, body: "x", buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }),
    ).toThrow(/Duplicate button id/);
  });

  it("rejects duplicate button titles", () => {
    expect(() =>
      buildButtonsMessage({ to, body: "x", buttons: [{ id: "a", title: "A" }, { id: "b", title: "A" }] }),
    ).toThrow(/Duplicate button title/);
  });
});

describe("buildListMessage", () => {
  const row = (i: number) => ({ id: `r${i}`, title: `Row ${i}` });

  it("builds a list", () => {
    const p = buildListMessage({ to, body: "menu", button_text: "Open", sections: [{ title: "S", rows: [row(1)] }] });
    expect(p).toMatchObject({
      type: "interactive",
      interactive: { type: "list", action: { button: "Open" } },
    });
  });

  it("rejects more than 10 rows total", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(i));
    expect(() => buildListMessage({ to, body: "m", button_text: "Open", sections: [{ title: "S", rows }] })).toThrow(
      /at most 10 rows/,
    );
  });

  it("requires section titles when there is more than one section", () => {
    expect(() =>
      buildListMessage({
        to,
        body: "m",
        button_text: "Open",
        sections: [{ rows: [row(1)] }, { rows: [row(2)] }],
      }),
    ).toThrow(/needs a title/);
  });

  it("rejects duplicate row ids", () => {
    expect(() =>
      buildListMessage({
        to,
        body: "m",
        button_text: "Open",
        sections: [{ title: "S", rows: [row(1), row(1)] }],
      }),
    ).toThrow(/Duplicate row id/);
  });
});

describe("buildMarkAsRead", () => {
  it("builds a read receipt", () => {
    expect(buildMarkAsRead({ message_id: "wamid.X" })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.X",
    });
  });

  it("adds a typing indicator when requested", () => {
    const p = buildMarkAsRead({ message_id: "wamid.X", show_typing: true });
    expect(p.typing_indicator).toEqual({ type: "text" });
  });
});
