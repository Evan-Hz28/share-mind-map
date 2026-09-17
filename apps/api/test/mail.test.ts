import { describe, expect, it } from "vitest";

import { RecordingMailProvider } from "../src/mail/recording-mail.provider.js";

describe("mail provider port", () => {
  it("records defensive copies for application tests", async () => {
    const provider = new RecordingMailProvider();
    const message = {
      to: ["admin@example.com"],
      subject: "Service alert",
      text: "A dependency is unavailable.",
    };

    await provider.send(message);
    message.to.push("mutated@example.com");

    expect(provider.messages).toEqual([
      {
        to: ["admin@example.com"],
        subject: "Service alert",
        text: "A dependency is unavailable.",
      },
    ]);
  });
});
