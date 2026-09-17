import { inspectArchive } from "./archive.js";
import { XMindError } from "./errors.js";
import type { XMindLimits } from "./limits.js";
import { parseContentJson } from "./parsers/content-json.js";
import { parseContentXml } from "./parsers/content-xml.js";
import type { XMindInspection } from "./types.js";

export async function inspectXMindFile(
  path: string,
  options: Partial<XMindLimits> = {},
): Promise<XMindInspection> {
  const archive = await inspectArchive(path, options);
  if (archive.contentJson !== undefined && archive.contentXml !== undefined) {
    throw new XMindError(
      "ARCHIVE_UNSUPPORTED",
      "An XMind archive cannot contain both current and legacy content roots.",
    );
  }
  if (archive.contentJson === undefined && archive.contentXml === undefined) {
    throw new XMindError("CONTENT_MISSING", "The archive has no supported XMind content root.");
  }

  const parsed =
    archive.contentJson === undefined
      ? parseContentXml(archive.contentXml as Buffer)
      : parseContentJson(archive.contentJson);
  return {
    format: archive.contentJson === undefined ? "content-xml" : "content-json",
    entries: archive.entries,
    sheets: parsed.sheets,
    assets: archive.assets,
    compatibility: parsed.compatibility,
  };
}
