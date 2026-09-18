import { createHash } from "node:crypto";
import { posix } from "node:path";

import { openPromise, type Entry, type ZipFile } from "yauzl";

import { inspectArchive } from "./archive.js";
import { XMindError } from "./errors.js";
import { DEFAULT_XMIND_LIMITS, type XMindLimits } from "./limits.js";

export interface XMindAssetBytes {
  path: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
  sha256: string;
}

function mediaTypeForPath(path: string): XMindAssetBytes["mediaType"] | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

function canonicalPath(fileName: string): string {
  const canonical = posix.normalize(fileName.normalize("NFC"));
  if (
    fileName.includes("\0") ||
    fileName.includes("\\") ||
    canonical.startsWith("/") ||
    canonical === ".." ||
    canonical.startsWith("../") ||
    /^[A-Za-z]:/.test(canonical)
  ) {
    throw new XMindError("IMAGE_PATH_UNSAFE", "The XMind image path is unsafe.");
  }
  return canonical;
}

function assertSignature(bytes: Buffer, mediaType: XMindAssetBytes["mediaType"]): void {
  const valid =
    (mediaType === "image/png" &&
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (mediaType === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (mediaType === "image/webp" &&
      bytes.subarray(0, 4).equals(Buffer.from("52494646", "hex")) &&
      bytes.subarray(8, 12).equals(Buffer.from("57454250", "hex")));
  if (!valid) {
    throw new XMindError("FILE_DAMAGED", "An image asset has an invalid media signature.");
  }
}

async function readEntry(zip: ZipFile, entry: Entry, limits: XMindLimits): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limits.maxEntryUncompressedBytes || size > entry.uncompressedSize) {
      stream.destroy();
      throw new XMindError("ARCHIVE_LIMIT_EXCEEDED", "An image asset exceeded its size limit.");
    }
    chunks.push(chunk);
  }
  if (size !== entry.uncompressedSize) {
    throw new XMindError("FILE_DAMAGED", "An image asset size did not match its archive header.");
  }
  return Buffer.concat(chunks, size);
}

export async function* extractXMindAssets(
  path: string,
  overrides: Partial<XMindLimits> = {},
): AsyncGenerator<XMindAssetBytes> {
  const limits = { ...DEFAULT_XMIND_LIMITS, ...overrides };
  const inspected = await inspectArchive(path, limits);
  let zip: ZipFile | undefined;
  try {
    zip = await openPromise(path, {
      autoClose: true,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    for await (const entry of zip.eachEntry()) {
      const canonical = canonicalPath(entry.fileName);
      if (inspected.assets[canonical] === undefined) continue;
      const mediaType = mediaTypeForPath(canonical);
      if (mediaType === undefined) continue;
      const bytes = await readEntry(zip, entry, limits);
      assertSignature(bytes, mediaType);
      yield {
        path: canonical,
        mediaType,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
  } finally {
    if (zip?.isOpen === true) zip.close();
  }
}
