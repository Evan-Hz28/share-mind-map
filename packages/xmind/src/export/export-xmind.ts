import type {
  CloudDocumentV1,
  CloudNodeV1,
  CloudRelationshipV1,
} from "@share-mind-map/document-model";
import { v5 as uuidv5 } from "uuid";
import { ZipFile } from "yazl";

import type { CompatibilityIssue } from "../types.js";

const EXPORTER_VERSION = "1.0.0";

export interface ExportAssetInput {
  assetId: string;
  path: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
}

export interface XMindExportCompatibility {
  status: "full" | "partial";
  issues: CompatibilityIssue[];
}

export interface XMindExportResult {
  bytes: Buffer;
  compatibility: XMindExportCompatibility;
}

function markerList(node: CloudNodeV1): { markerId: string }[] {
  const priority =
    node.priority === null
      ? []
      : [
          {
            markerId: `priority-${node.priority === "P0" ? "1" : node.priority === "P1" ? "2" : "3"}`,
          },
        ];
  return [...priority, ...node.icons.map((markerId) => ({ markerId }))];
}

function topicForNode(
  node: CloudNodeV1,
  nodes: Readonly<Record<string, CloudNodeV1>>,
  compatibility: CompatibilityIssue[],
  assets: ReadonlyMap<string, ExportAssetInput>,
): Record<string, unknown> {
  const topic: Record<string, unknown> = {
    id: node.id,
    title: node.title,
    children: {
      attached: node.childIds.map((childId) => {
        const child = nodes[childId];
        if (child === undefined) throw new Error(`CloudDocument child ${childId} is missing.`);
        return topicForNode(child, nodes, compatibility, assets);
      }),
    },
  };
  if (node.notes !== null) topic.notes = { plain: { content: node.notes.text } };
  if (node.labels.length > 0) topic.labels = [...node.labels];
  const markers = markerList(node);
  if (markers.length > 0) topic.markers = markers;

  const properties: Record<string, string | number> = {};
  if (node.style.backgroundColor !== undefined) {
    properties["fo:background-color"] = node.style.backgroundColor;
  }
  if (node.style.textColor !== undefined) properties["fo:color"] = node.style.textColor;
  if (node.style.fontFamily !== undefined) properties["fo:font-family"] = node.style.fontFamily;
  if (node.style.fontSize !== undefined)
    properties["fo:font-size"] = `${String(node.style.fontSize)}pt`;
  if (node.style.fontWeight !== undefined) properties["fo:font-weight"] = node.style.fontWeight;
  if (Object.keys(properties).length > 0) topic.style = { properties };

  if (node.imageAssetId !== null) {
    const asset = assets.get(node.imageAssetId);
    if (asset === undefined) {
      compatibility.push({
        featurePath: `node.${node.id}.imageAssetId`,
        disposition: "unsupported_online",
        message: "The referenced image asset was not available for export.",
      });
    } else {
      topic.image = { src: `xap:${asset.path}` };
    }
  }

  const unknown = node.extensions["xmind.unknown"];
  if (
    unknown !== undefined &&
    typeof unknown === "object" &&
    unknown !== null &&
    !Array.isArray(unknown)
  ) {
    Object.assign(topic, unknown);
  }
  return topic;
}

function relationshipForCloud(relationship: CloudRelationshipV1): Record<string, unknown> {
  const style = relationship.style;
  return {
    id: relationship.id,
    end1Id: relationship.sourceNodeId,
    end2Id: relationship.targetNodeId,
    ...(relationship.title === null ? {} : { title: relationship.title }),
    ...(style === null
      ? {}
      : {
          style: {
            properties: {
              ...(style.color === undefined ? {} : { "line-color": style.color }),
              ...(style.width === undefined ? {} : { "line-width": style.width }),
              ...(style.pattern === undefined ? {} : { "line-pattern": style.pattern }),
            },
          },
        }),
  };
}

function contentForDocument(
  document: CloudDocumentV1,
  compatibility: CompatibilityIssue[],
  assets: ReadonlyMap<string, ExportAssetInput>,
): Record<string, unknown>[] {
  return document.sheets.map((sheet) => {
    const root = sheet.nodes[sheet.rootNodeId];
    if (root === undefined) throw new Error(`CloudDocument root ${sheet.rootNodeId} is missing.`);
    const rootTopic = topicForNode(root, sheet.nodes, compatibility, assets);
    rootTopic.class = "topic";
    return {
      id: sheet.id,
      revisionId: uuidv5(`revision/${String(document.version)}/${sheet.id}`, document.documentId),
      class: "sheet",
      title: sheet.title,
      rootTopic,
      theme: {},
      arrangeableLayerOrder: [root.id],
      zones: [],
      relationships: sheet.relationships.map(relationshipForCloud),
    };
  });
}

function zipBytes(entries: Array<{ path: string; bytes: Buffer }>): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    zip.addBuffer(entry.bytes, entry.path, {
      compress: true,
      mtime: new Date("2000-01-01T00:00:00.000Z"),
      mode: 0o100644,
    });
  }
  zip.end();
  return complete;
}

export async function exportCloudDocumentToXMind(
  document: CloudDocumentV1,
  options: { assets?: readonly ExportAssetInput[] } = {},
): Promise<XMindExportResult> {
  const compatibility: CompatibilityIssue[] = [];
  const assets = new Map((options.assets ?? []).map((asset) => [asset.assetId, asset]));
  const content = Buffer.from(
    `${JSON.stringify(contentForDocument(document, compatibility, assets))}\n`,
    "utf8",
  );
  const metadata = Buffer.from(
    `${JSON.stringify({
      dataStructureVersion: "3",
      creator: { name: "Kitar", version: EXPORTER_VERSION },
      layoutEngineVersion: "5",
    })}\n`,
    "utf8",
  );
  const assetEntries = (options.assets ?? []).map((asset) => ({
    path: asset.path,
    bytes: asset.bytes,
  }));
  const manifestPaths = [
    "content.json",
    "metadata.json",
    ...assetEntries.map(({ path }) => path),
  ].sort();
  const manifest = Buffer.from(
    `${JSON.stringify({
      "file-entries": Object.fromEntries(manifestPaths.map((path) => [path, {}])),
    })}\n`,
    "utf8",
  );
  const entries: Array<{ path: string; bytes: Buffer }> = [
    { path: "content.json", bytes: content },
    { path: "metadata.json", bytes: metadata },
    { path: "manifest.json", bytes: manifest },
    ...assetEntries,
  ];
  return {
    bytes: await zipBytes(entries),
    compatibility: {
      status: compatibility.length === 0 ? "full" : "partial",
      issues: compatibility,
    },
  };
}
