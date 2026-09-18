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
  if (archive.contentJson === undefined && archive.contentXml === undefined) {
    throw new XMindError("CONTENT_MISSING", "The archive has no supported XMind content root.");
  }

  let format: XMindInspection["format"];
  let parsed;
  if (archive.contentJson !== undefined) {
    try {
      parsed = parseContentJson(archive.contentJson);
      format = "content-json";
      if (archive.contentXml !== undefined) {
        parsed.compatibility.unshift({
          featurePath: "content.xml",
          disposition: "normalized",
          message: "Both current JSON and legacy XML roots were found; current JSON was selected.",
        });
      }
    } catch (error) {
      if (archive.contentXml === undefined || !(error instanceof XMindError)) throw error;
      parsed = parseContentXml(archive.contentXml);
      parsed.compatibility.unshift({
        featurePath: "content.json",
        disposition: "normalized",
        message: "Current JSON was invalid; legacy XML was selected.",
      });
      format = "content-xml";
    }
  } else {
    parsed = parseContentXml(archive.contentXml as Buffer);
    format = "content-xml";
  }
  return {
    format,
    entries: archive.entries,
    sheets: parsed.sheets,
    assets: archive.assets,
    compatibility: parsed.compatibility,
  };
}
