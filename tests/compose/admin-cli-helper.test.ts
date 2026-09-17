import { describe, expect, it } from "vitest";

import { runInteractiveProcess } from "../e2e/helpers/admin-cli.js";

describe("administrator CLI process helper", () => {
  it("waits for each readline prompt before sending its answer", async () => {
    const script = [
      'import { createInterface } from "node:readline/promises";',
      'import { stdin, stdout } from "node:process";',
      "const io = createInterface({ input: stdin, output: stdout });",
      'const first = await io.question("First value: ");',
      'const second = await io.question("Continue? [y/N]: ");',
      "io.close();",
      "stdout.write(`received:${first}:${second}\\n`);",
    ].join("\n");

    const result = await runInteractiveProcess(
      "node",
      ["--input-type=module", "-e", script],
      [
        { prompt: "First value: ", answer: "alpha" },
        { prompt: "Continue? [y/N]: ", answer: "y" },
      ],
    );

    expect(result.stdout).toContain("received:alpha:y");
  });

  it("allows an idempotent command to exit successfully before its first prompt", async () => {
    const result = await runInteractiveProcess(
      "node",
      ["--input-type=module", "-e", 'process.stdout.write("already initialized\\n")'],
      [{ prompt: "Organization name: ", answer: "unused" }],
      { allowNoPrompts: true },
    );

    expect(result.stdout).toBe("already initialized\n");
  });
});
