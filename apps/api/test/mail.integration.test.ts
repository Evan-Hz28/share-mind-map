import { describe, expect, it } from "vitest";

import { SmtpMailProvider } from "../src/mail/smtp-mail.provider.js";

describe("SMTP adapter with Mailpit", () => {
  it("verifies and sends through the local SMTP service", async () => {
    const provider = new SmtpMailProvider({
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      from: "share-mind-map@localhost",
    });

    await expect(provider.verify()).resolves.toBeUndefined();
    await expect(
      provider.send({
        to: ["operator@example.com"],
        subject: `Task 7 SMTP proof ${String(Date.now())}`,
        text: "Synthetic integration message.",
      }),
    ).resolves.toBeUndefined();
  });
});
