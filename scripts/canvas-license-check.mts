import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDirectory = join(rootDirectory, "apps/web");
const allowedLicenses = new Set(["MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC"]);

export type LicenseFileEvidence = {
  path: string;
  sha256: string;
};

export type CanvasLicenseEvidence = {
  packageName: string;
  version: string;
  spdx: string;
  packageDirectory: string;
  licenseFiles: LicenseFileEvidence[];
  compatible: boolean;
  conclusion: "compatible" | "incompatible-spdx" | "missing-bundled-license";
};

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  license?: unknown;
};

export async function collectLicenseEvidence(
  expectedName: string,
  packageDirectory: string,
): Promise<CanvasLicenseEvidence> {
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  ) as PackageManifest;
  if (manifest.name !== expectedName || typeof manifest.version !== "string") {
    throw new Error(`Installed package manifest does not match ${expectedName}.`);
  }
  const spdx = typeof manifest.license === "string" ? manifest.license : "UNDECLARED";
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const licenseNames = entries
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)(\..*)?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const licenseFiles = await Promise.all(
    licenseNames.map(async (name): Promise<LicenseFileEvidence> => {
      const bytes = await readFile(join(packageDirectory, name));
      return { path: name, sha256: createHash("sha256").update(bytes).digest("hex") };
    }),
  );
  const compatible = allowedLicenses.has(spdx) && licenseFiles.length > 0;
  const conclusion =
    licenseFiles.length === 0
      ? "missing-bundled-license"
      : allowedLicenses.has(spdx)
        ? "compatible"
        : "incompatible-spdx";

  return {
    packageName: expectedName,
    version: manifest.version,
    spdx,
    packageDirectory: relative(rootDirectory, packageDirectory) || basename(packageDirectory),
    licenseFiles,
    compatible,
    conclusion,
  };
}

async function installedPackageDirectory(packageName: string): Promise<string> {
  return realpath(join(webDirectory, "node_modules", packageName));
}

export async function collectCanvasLicenses(): Promise<CanvasLicenseEvidence[]> {
  const candidates = ["simple-mind-map", "mind-elixir", "jsmind"];
  const evidence = await Promise.all(
    candidates.map(async (candidate) =>
      collectLicenseEvidence(candidate, await installedPackageDirectory(candidate)),
    ),
  );
  return evidence.sort((left, right) => left.packageName.localeCompare(right.packageName));
}

async function main(): Promise<void> {
  const evidence = await collectCanvasLicenses();
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, candidates: evidence }, null, 2)}\n`);
  if (evidence.some((candidate) => !candidate.compatible)) process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await main();
}
