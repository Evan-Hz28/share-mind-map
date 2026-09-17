import { stat } from "node:fs/promises";
import { posix } from "node:path";

import { openPromise, type Entry, type ZipFile } from "yauzl";

import { XMindError } from "./errors.js";
import { DEFAULT_XMIND_LIMITS, type XMindLimits } from "./limits.js";
import type { XMindAsset } from "./types.js";

export interface XMindArchive {
  contentJson?: Buffer;
  contentXml?: Buffer;
  entries: string[];
  assets: Record<string, XMindAsset>;
}

function assertDeadline(startedAt: number, limits: XMindLimits) {
  if (Date.now() - startedAt > limits.deadlineMs) {
    throw new XMindError("PROCESSING_TIMEOUT", "XMind processing exceeded its deadline.");
  }
}

function canonicalEntryPath(fileName: string): string {
  if (fileName.includes("\0") || fileName.includes("\\")) {
    throw new XMindError("ARCHIVE_PATH_UNSAFE", "The archive contains an unsafe path.");
  }
  const canonical = posix.normalize(fileName.normalize("NFC"));
  if (
    canonical.startsWith("/") ||
    /^[A-Za-z]:/.test(canonical) ||
    canonical === ".." ||
    canonical.startsWith("../")
  ) {
    throw new XMindError("ARCHIVE_PATH_UNSAFE", "The archive contains an unsafe path.");
  }
  return canonical;
}

function mediaTypeForPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

async function consumeEntry(
  zip: ZipFile,
  entry: Entry,
  keep: boolean,
  startedAt: number,
  limits: XMindLimits,
): Promise<Buffer | undefined> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let actualSize = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    assertDeadline(startedAt, limits);
    actualSize += chunk.length;
    if (actualSize > limits.maxEntryUncompressedBytes || actualSize > entry.uncompressedSize) {
      stream.destroy();
      throw new XMindError("ARCHIVE_LIMIT_EXCEEDED", "An archive entry exceeded its limit.");
    }
    if (keep) chunks.push(chunk);
  }
  if (actualSize !== entry.uncompressedSize) {
    throw new XMindError("FILE_DAMAGED", "An archive entry size did not match its header.");
  }
  return keep ? Buffer.concat(chunks, actualSize) : undefined;
}

function mapArchiveError(error: unknown): XMindError {
  if (error instanceof XMindError) return error;
  const message = error instanceof Error ? error.message : "Unknown ZIP error";
  if (
    message.startsWith("invalid relative path:") ||
    message.startsWith("absolute path:") ||
    message.startsWith("invalid characters in fileName:")
  ) {
    return new XMindError("ARCHIVE_PATH_UNSAFE", "The archive contains an unsafe path.");
  }
  return new XMindError("FILE_DAMAGED", "The XMind archive is damaged or unreadable.");
}

export async function inspectArchive(
  path: string,
  overrides: Partial<XMindLimits> = {},
): Promise<XMindArchive> {
  const limits = { ...DEFAULT_XMIND_LIMITS, ...overrides };
  const startedAt = Date.now();
  const file = await stat(path).catch((error: unknown) => {
    throw mapArchiveError(error);
  });
  if (!file.isFile()) throw new XMindError("FILE_DAMAGED", "The XMind input is not a file.");
  if (file.size > limits.maxCompressedBytes) {
    throw new XMindError("ARCHIVE_LIMIT_EXCEEDED", "The compressed XMind file is too large.");
  }

  let zip: ZipFile | undefined;
  try {
    zip = await openPromise(path, {
      autoClose: true,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    if (zip.entryCount > limits.maxEntries) {
      throw new XMindError("ARCHIVE_LIMIT_EXCEEDED", "The archive contains too many entries.");
    }

    const archive: XMindArchive = { entries: [], assets: {} };
    const seenPaths = new Set<string>();
    let totalUncompressed = 0;
    for await (const entry of zip.eachEntry()) {
      assertDeadline(startedAt, limits);
      const entryPath = canonicalEntryPath(entry.fileName);
      if (seenPaths.has(entryPath)) {
        throw new XMindError(
          "ARCHIVE_DUPLICATE_PATH",
          "The archive contains duplicate canonical paths.",
        );
      }
      seenPaths.add(entryPath);
      archive.entries.push(entryPath);

      if (entry.isEncrypted()) {
        throw new XMindError("ARCHIVE_ENCRYPTED", "Encrypted XMind entries are not supported.");
      }
      if (!entry.canDecodeFileData()) {
        throw new XMindError(
          "ARCHIVE_UNSUPPORTED",
          "The archive uses an unsupported compression method.",
        );
      }
      totalUncompressed += entry.uncompressedSize;
      const entryRatio =
        entry.uncompressedSize === 0
          ? 0
          : entry.compressedSize === 0
            ? Number.POSITIVE_INFINITY
            : entry.uncompressedSize / entry.compressedSize;
      if (
        entry.uncompressedSize > limits.maxEntryUncompressedBytes ||
        totalUncompressed > limits.maxTotalUncompressedBytes ||
        entryRatio > limits.maxCompressionRatio ||
        (file.size > 0 && totalUncompressed / file.size > limits.maxCompressionRatio)
      ) {
        throw new XMindError("ARCHIVE_LIMIT_EXCEEDED", "The archive expansion limit was exceeded.");
      }

      const isContentJson = entryPath === "content.json";
      const isContentXml = entryPath === "content.xml";
      const content = await consumeEntry(
        zip,
        entry,
        isContentJson || isContentXml,
        startedAt,
        limits,
      );
      if (isContentJson && content !== undefined) archive.contentJson = content;
      if (isContentXml && content !== undefined) archive.contentXml = content;

      const mediaType = mediaTypeForPath(entryPath);
      if (mediaType !== undefined) {
        archive.assets[entryPath] = {
          path: entryPath,
          mediaType,
          uncompressedSize: entry.uncompressedSize,
        };
      }
    }
    archive.entries.sort();
    return archive;
  } catch (error) {
    throw mapArchiveError(error);
  } finally {
    if (zip?.isOpen === true) zip.close();
  }
}
