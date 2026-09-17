import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const workspacePaths = [
  "apps/web",
  "apps/api",
  "apps/worker",
  "packages/database",
  "packages/document-model",
  "packages/xmind",
  "packages/api-client",
];

const allowedInternalDependencies = new Map([
  ["apps/web", new Set(["@share-mind-map/api-client", "@share-mind-map/document-model"])],
  ["apps/api", new Set(["@share-mind-map/database", "@share-mind-map/document-model"])],
  [
    "apps/worker",
    new Set([
      "@share-mind-map/database",
      "@share-mind-map/document-model",
      "@share-mind-map/xmind",
    ]),
  ],
  ["packages/database", new Set()],
  ["packages/document-model", new Set()],
  ["packages/xmind", new Set(["@share-mind-map/document-model"])],
  ["packages/api-client", new Set()],
]);

function internalDependencies(manifest) {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }).filter((name) => name.startsWith("@share-mind-map/"));
}

export function validateWorkspaceGraph(entries) {
  const packagePaths = new Map(entries.map(({ path, manifest }) => [manifest.name, path]));
  const errors = [];

  for (const { path, manifest } of entries) {
    const expectedName = `@share-mind-map/${path.split("/").at(-1)}`;
    if (manifest.name !== expectedName) {
      errors.push(
        `${path} must be named ${expectedName}; received ${manifest.name ?? "<missing>"}`,
      );
    }
    const allowed = allowedInternalDependencies.get(path) ?? new Set();
    for (const dependency of internalDependencies(manifest)) {
      const dependencyPath = packagePaths.get(dependency);
      if (dependencyPath?.startsWith("apps/")) {
        errors.push(`${path} may not depend on application ${dependency}`);
        continue;
      }
      if (!allowed.has(dependency)) {
        const allowedList = [...allowed].sort().join(", ") || "none";
        errors.push(
          `${path} may not depend on ${dependency}; allowed internal dependencies: ${allowedList}`,
        );
      }
    }
  }

  return errors.sort();
}

async function readWorkspaceManifests(rootUrl) {
  return Promise.all(
    workspacePaths.map(async (path) => ({
      path,
      manifest: JSON.parse(await readFile(new URL(`${path}/package.json`, rootUrl), "utf8")),
    })),
  );
}

async function main() {
  const rootUrl = new URL("../", import.meta.url);
  const entries = await readWorkspaceManifests(rootUrl);
  const errors = validateWorkspaceGraph(entries);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Workspace dependency graph valid (${entries.length} packages).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
