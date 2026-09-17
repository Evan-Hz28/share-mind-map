import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import yargs from "yargs";

import { createApp } from "../main.js";
import { AdminOperationsService } from "../operations/admin-operations.service.js";
import { parseAppConfig } from "../platform/config/app-config.js";
import type { AdminCommandIO } from "./admin-command-io.js";

export class ConsoleAdminCommandIO implements AdminCommandIO {
  private readonly readline = createInterface({ input: stdin, output: stdout });

  public input(label: string): Promise<string> {
    return this.readline.question(`${label}: `);
  }

  public async confirm(label: string): Promise<boolean> {
    const answer = await this.readline.question(`${label} [y/N]: `);
    return answer.trim().toLowerCase() === "y";
  }

  public secretOnce(label: string, value: string): Promise<void> {
    stdout.write(`${label}: ${value}\n`);
    return Promise.resolve();
  }

  public close(): void {
    this.readline.close();
  }
}

export async function runInitAdminCli(
  argv: string[],
  operations: AdminOperationsService,
  io: AdminCommandIO,
): Promise<void> {
  await yargs(argv)
    .scriptName("admin:init")
    .strict()
    .exitProcess(false)
    .help(false)
    .version(false)
    .fail((_message, error) => {
      throw error;
    })
    .parseAsync();
  await operations.initialize(io);
}

async function main(): Promise<void> {
  const config = parseAppConfig(process.env);
  const app = await createApp({ config });
  const io = new ConsoleAdminCommandIO();
  try {
    await runInitAdminCli(process.argv.slice(2), app.get(AdminOperationsService), io);
  } finally {
    io.close();
    await app.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
