import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ZipFile } from "yazl";

const FIXED_TIME = new Date("2000-01-01T00:00:00.000Z");
const FIXTURE_ROOT = fileURLToPath(new URL("../tests/fixtures/xmind/", import.meta.url));
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface ZipEntryInput {
  path: string;
  data: Buffer;
  compress?: boolean;
}

interface FixtureDefinition {
  file: string;
  bytes: Buffer;
  expected: {
    status: "accepted" | "rejected";
    nodeCount?: number;
    errorCode?: string;
  };
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

async function createZip(entries: ZipEntryInput[]): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolveOutput, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => {
      resolveOutput(Buffer.concat(chunks));
    });
  });

  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    zip.addBuffer(entry.data, entry.path, {
      compress: entry.compress ?? true,
      mtime: FIXED_TIME,
      mode: 0o100644,
    });
  }
  zip.end();
  return complete;
}

function topic(sourceId: string, title: string, children: unknown[] = []) {
  return {
    id: sourceId,
    title,
    children: { attached: children },
  };
}

function currentContent(options: { image?: boolean; unknown?: boolean } = {}) {
  const root = {
    ...topic("current-root", "Current root", [
      topic("00000000-0000-7000-8000-000000000011", "Stable child"),
      topic("current-child-b", "Second child"),
    ]),
    notes: { plain: { content: "Root notes" } },
    labels: ["alpha", "beta"],
    markers: [{ markerId: "priority-1" }, { markerId: "star-blue" }],
    style: {
      properties: {
        "fo:background-color": "#DDEEFF",
        "fo:color": "#112233",
        "fo:font-family": "Inter",
        "fo:font-size": "18pt",
        "fo:font-weight": "700",
      },
    },
    ...(options.image ? { image: { src: "xap:resources/pixel.png" } } : {}),
    ...(options.unknown ? { futureFlag: "synthetic-value" } : {}),
  };
  return [
    {
      id: "current-sheet",
      title: "Current sheet",
      rootTopic: root,
      relationships: [
        {
          id: "current-relationship",
          end1Id: "00000000-0000-7000-8000-000000000011",
          end2Id: "current-child-b",
          title: "Depends on",
        },
      ],
    },
  ];
}

function multiSheetContent() {
  return [
    { id: "sheet-first", title: "First", rootTopic: topic("first-root", "First root") },
    { id: "sheet-second", title: "Second", rootTopic: topic("second-root", "Second root") },
  ];
}

function largeContent(nodeCount: number) {
  const children = Array.from({ length: nodeCount - 1 }, (_, index) =>
    topic(`node-${String(index + 1)}`, `Node ${String(index + 1)}`),
  );
  return [
    {
      id: `large-sheet-${String(nodeCount)}`,
      title: `${String(nodeCount)} nodes`,
      rootTopic: topic(`large-root-${String(nodeCount)}`, "Large root", children),
    },
  ];
}

function legacyContent(): Buffer {
  return Buffer.from(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">',
      '  <sheet id="legacy-sheet">',
      "    <title>Legacy sheet</title>",
      '    <topic id="legacy-root">',
      "      <title>Legacy root</title>",
      "      <notes><plain>Legacy notes</plain></notes>",
      '      <children><topics type="attached">',
      '        <topic id="legacy-child"><title>Legacy child</title></topic>',
      "      </topics></children>",
      "    </topic>",
      "  </sheet>",
      "</xmap-content>",
      "",
    ].join("\n"),
    "utf8",
  );
}

function replaceAscii(buffer: Buffer, from: string, to: string): Buffer {
  const source = Buffer.from(from, "utf8");
  const replacement = Buffer.from(to, "utf8");
  if (source.length !== replacement.length)
    throw new Error("ZIP path patches must be equal length.");

  const result = Buffer.from(buffer);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(source, offset)) !== -1) {
    replacement.copy(result, offset);
    offset += replacement.length;
    replacements += 1;
  }
  if (replacements < 2) throw new Error(`ZIP path ${from} was not present in both headers.`);
  return result;
}

function markEntriesEncrypted(buffer: Buffer): Buffer {
  const result = Buffer.from(buffer);
  for (let offset = 0; offset <= result.length - 10; offset += 1) {
    const signature = result.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      result.writeUInt16LE(result.readUInt16LE(offset + 6) | 1, offset + 6);
    } else if (signature === 0x02014b50) {
      result.writeUInt16LE(result.readUInt16LE(offset + 8) | 1, offset + 8);
    }
  }
  return result;
}

async function fixtureDefinitions(): Promise<FixtureDefinition[]> {
  const current = jsonBuffer(currentContent());
  const safeTraversalZip = await createZip([{ path: "aa/content.json", data: current }]);
  const encryptedZip = await createZip([{ path: "content.json", data: current }]);

  const definitions: FixtureDefinition[] = [
    {
      file: "corrupt.xmind",
      bytes: Buffer.from("not a ZIP archive\n", "utf8"),
      expected: { status: "rejected", errorCode: "FILE_DAMAGED" },
    },
    {
      file: "current-json.xmind",
      bytes: await createZip([{ path: "content.json", data: current }]),
      expected: { status: "accepted", nodeCount: 3 },
    },
    {
      file: "duplicate-path.xmind",
      bytes: await createZip([
        { path: "content.json", data: current },
        { path: "content.json", data: current },
      ]),
      expected: { status: "rejected", errorCode: "ARCHIVE_DUPLICATE_PATH" },
    },
    {
      file: "encrypted.xmind",
      bytes: markEntriesEncrypted(encryptedZip),
      expected: { status: "rejected", errorCode: "ARCHIVE_ENCRYPTED" },
    },
    {
      file: "legacy-xml.xmind",
      bytes: await createZip([{ path: "content.xml", data: legacyContent() }]),
      expected: { status: "accepted", nodeCount: 2 },
    },
    {
      file: "multi-sheet.xmind",
      bytes: await createZip([{ path: "content.json", data: jsonBuffer(multiSheetContent()) }]),
      expected: { status: "accepted", nodeCount: 2 },
    },
    {
      file: "nodes-20000.xmind",
      bytes: await createZip([{ path: "content.json", data: jsonBuffer(largeContent(20_000)) }]),
      expected: { status: "accepted", nodeCount: 20_000 },
    },
    {
      file: "nodes-5000.xmind",
      bytes: await createZip([{ path: "content.json", data: jsonBuffer(largeContent(5_000)) }]),
      expected: { status: "accepted", nodeCount: 5_000 },
    },
    {
      file: "path-traversal.xmind",
      bytes: replaceAscii(safeTraversalZip, "aa/content.json", "../content.json"),
      expected: { status: "rejected", errorCode: "ARCHIVE_PATH_UNSAFE" },
    },
    {
      file: "unknown-extension.xmind",
      bytes: await createZip([
        { path: "content.json", data: jsonBuffer(currentContent({ unknown: true })) },
      ]),
      expected: { status: "accepted", nodeCount: 3 },
    },
    {
      file: "with-png.xmind",
      bytes: await createZip([
        { path: "content.json", data: jsonBuffer(currentContent({ image: true })) },
        { path: "resources/pixel.png", data: PNG_1X1 },
      ]),
      expected: { status: "accepted", nodeCount: 3 },
    },
    {
      file: "zip-bomb.xmind",
      bytes: await createZip([{ path: "content.json", data: Buffer.alloc(1_000_000) }]),
      expected: { status: "rejected", errorCode: "ARCHIVE_LIMIT_EXCEEDED" },
    },
  ];
  return definitions.sort((left, right) => left.file.localeCompare(right.file));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else output.push(relative(root, path));
    }
  };
  await visit(root);
  return output.sort();
}

export async function generateXMindFixtures(outputRoot = FIXTURE_ROOT): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const definitions = await fixtureDefinitions();
  for (const fixture of definitions) {
    await writeFile(join(outputRoot, fixture.file), fixture.bytes);
  }

  const manifest = {
    generatorVersion: 1,
    fixtures: definitions.map(({ file, bytes, expected }) => ({
      file,
      provenance: "synthetic",
      sha256: sha256(bytes),
      expected,
    })),
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputRoot, "README.md"),
    "# Synthetic XMind fixtures\n\nAll files in this directory are generated test data. No fixture is a representative company document.\n",
    "utf8",
  );
}

export async function checkXMindFixtures(expectedRoot = FIXTURE_ROOT): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "xmind-fixture-check-"));
  const generatedRoot = join(temporaryRoot, "xmind");
  try {
    await generateXMindFixtures(generatedRoot);
    const [expectedFiles, generatedFiles] = await Promise.all([
      listFiles(expectedRoot),
      listFiles(generatedRoot),
    ]);
    if (JSON.stringify(expectedFiles) !== JSON.stringify(generatedFiles)) {
      throw new Error("XMind fixture file list is out of date.");
    }
    for (const file of expectedFiles) {
      const [expected, generated] = await Promise.all([
        readFile(join(expectedRoot, file)),
        readFile(join(generatedRoot, file)),
      ]);
      if (!expected.equals(generated)) throw new Error(`XMind fixture ${file} is out of date.`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath)) {
  if (process.argv.includes("--check")) {
    await checkXMindFixtures();
    console.log("Synthetic XMind fixtures are current.");
  } else {
    await generateXMindFixtures();
    console.log(
      `Generated synthetic XMind fixtures in ${dirname(join(FIXTURE_ROOT, "manifest.json"))}`,
    );
  }
}
