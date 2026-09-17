import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateApiClient } from "./generate-api-client.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiClientDirectory = join(rootDirectory, "packages/api-client");
const artifactRoots = ["openapi.json", "src/generated"] as const;

async function collectFiles(root: string, relativePath: string): Promise<string[]> {
  const fullPath = join(root, relativePath);
  let details;
  try {
    details = await stat(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (details.isFile()) return [relativePath];
  if (!details.isDirectory()) return [];

  const entries = await readdir(fullPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => collectFiles(root, posix.join(relativePath, entry.name))),
  );
  return nested.flat();
}

export async function findApiClientDrift(
  expectedRoot: string,
  actualRoot: string,
): Promise<string[]> {
  const [expectedFiles, actualFiles] = await Promise.all([
    Promise.all(artifactRoots.map((path) => collectFiles(expectedRoot, path))).then((items) =>
      items.flat(),
    ),
    Promise.all(artifactRoots.map((path) => collectFiles(actualRoot, path))).then((items) =>
      items.flat(),
    ),
  ]);
  const paths = [...new Set([...expectedFiles, ...actualFiles])].sort((left, right) =>
    left.localeCompare(right),
  );
  const drift: string[] = [];
  for (const path of paths) {
    if (!expectedFiles.includes(path) || !actualFiles.includes(path)) {
      drift.push(path);
      continue;
    }
    const [expected, actual] = await Promise.all([
      readFile(join(expectedRoot, path)),
      readFile(join(actualRoot, path)),
    ]);
    if (!expected.equals(actual)) drift.push(path);
  }
  return drift;
}

export async function checkApiClient(expectedRoot = apiClientDirectory): Promise<void> {
  const generatedRoot = await mkdtemp(join(tmpdir(), "share-mind-map-api-client-check-"));
  try {
    await generateApiClient({
      openApiPath: join(generatedRoot, "openapi.json"),
      outputPath: join(generatedRoot, "src/generated"),
    });
    const drift = await findApiClientDrift(expectedRoot, generatedRoot);
    if (drift.length > 0) {
      throw new Error(
        `Generated API client drift detected:\n${drift.map((path) => `- ${path}`).join("\n")}\nRun pnpm api:generate.`,
      );
    }
  } finally {
    await rm(generatedRoot, { recursive: true, force: true });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await checkApiClient();
  process.stdout.write("OpenAPI and generated TypeScript client are current.\n");
}
