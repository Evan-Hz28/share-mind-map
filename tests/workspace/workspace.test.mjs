import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateWorkspaceGraph } from "../../scripts/check-workspace.mjs";

const root = new URL("../../", import.meta.url);
const expectedWorkspacePaths = [
  "apps/web",
  "apps/api",
  "apps/worker",
  "packages/database",
  "packages/document-model",
  "packages/xmind",
  "packages/api-client",
];

test("workspace declares every owned package and pins pnpm 11.5.0", async () => {
  const rootPackage = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(rootPackage.packageManager, "pnpm@11.5.0");

  const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");
  for (const path of expectedWorkspacePaths) {
    assert.match(workspace, new RegExp(path.replace("/", "\\/")));
  }
});

const validManifests = [
  {
    path: "apps/web",
    manifest: {
      name: "@share-mind-map/web",
      dependencies: {
        "@share-mind-map/api-client": "workspace:*",
        "@share-mind-map/document-model": "workspace:*",
      },
    },
  },
  {
    path: "apps/api",
    manifest: {
      name: "@share-mind-map/api",
      dependencies: {
        "@share-mind-map/database": "workspace:*",
        "@share-mind-map/document-model": "workspace:*",
      },
    },
  },
  {
    path: "apps/worker",
    manifest: {
      name: "@share-mind-map/worker",
      dependencies: {
        "@share-mind-map/database": "workspace:*",
        "@share-mind-map/document-model": "workspace:*",
        "@share-mind-map/xmind": "workspace:*",
      },
    },
  },
  {
    path: "packages/database",
    manifest: { name: "@share-mind-map/database" },
  },
  {
    path: "packages/document-model",
    manifest: { name: "@share-mind-map/document-model" },
  },
  {
    path: "packages/xmind",
    manifest: {
      name: "@share-mind-map/xmind",
      dependencies: { "@share-mind-map/document-model": "workspace:*" },
    },
  },
  {
    path: "packages/api-client",
    manifest: { name: "@share-mind-map/api-client" },
  },
];

function withDependency(path, name) {
  return validManifests.map((entry) =>
    entry.path === path
      ? {
          ...entry,
          manifest: {
            ...entry.manifest,
            dependencies: {
              ...entry.manifest.dependencies,
              [name]: "workspace:*",
            },
          },
        }
      : entry,
  );
}

function withPackageName(path, name) {
  return validManifests.map((entry) =>
    entry.path === path ? { ...entry, manifest: { ...entry.manifest, name } } : entry,
  );
}

test("accepts the documented workspace dependency directions", () => {
  assert.deepEqual(validateWorkspaceGraph(validManifests), []);
});

test("rejects a package name that does not match its owned path", () => {
  assert.deepEqual(
    validateWorkspaceGraph(withPackageName("packages/database", "@share-mind-map/data")),
    ["packages/database must be named @share-mind-map/database; received @share-mind-map/data"],
  );
});

test("rejects web depending directly on database", () => {
  assert.deepEqual(validateWorkspaceGraph(withDependency("apps/web", "@share-mind-map/database")), [
    "apps/web may not depend on @share-mind-map/database; allowed internal dependencies: @share-mind-map/api-client, @share-mind-map/document-model",
  ]);
});

test("rejects api depending directly on xmind", () => {
  assert.deepEqual(validateWorkspaceGraph(withDependency("apps/api", "@share-mind-map/xmind")), [
    "apps/api may not depend on @share-mind-map/xmind; allowed internal dependencies: @share-mind-map/database, @share-mind-map/document-model",
  ]);
});

test("rejects any package depending on an application", () => {
  assert.deepEqual(
    validateWorkspaceGraph(withDependency("packages/document-model", "@share-mind-map/api")),
    ["packages/document-model may not depend on application @share-mind-map/api"],
  );
});
