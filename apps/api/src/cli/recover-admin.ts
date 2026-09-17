import { pathToFileURL } from "node:url";

import yargs from "yargs";

import { createApp } from "../main.js";
import { AdminOperationsService } from "../operations/admin-operations.service.js";
import { parseAppConfig } from "../platform/config/app-config.js";
import type { AdminCommandIO } from "./admin-command-io.js";
import { ConsoleAdminCommandIO } from "./init-admin.js";

export async function runRecoverAdminCli(
  argv: string[],
  operations: AdminOperationsService,
  io: AdminCommandIO,
): Promise<void> {
  await yargs(argv)
    .scriptName("admin:recover")
    .strict()
    .exitProcess(false)
    .help(false)
    .version(false)
    .fail((_message, error) => {
      throw error;
    })
    .parseAsync();
  await operations.recover(io);
}

async function main(): Promise<void> {
  const config = parseAppConfig(process.env);
  const app = await createApp({ config });
  const io = new ConsoleAdminCommandIO();
  try {
    await runRecoverAdminCli(process.argv.slice(2), app.get(AdminOperationsService), io);
  } finally {
    io.close();
    await app.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
