import { posix } from "node:path";

import {
  DocumentModelError,
  parseCloudDocument,
  type CloudDocumentV1,
  type CloudNodeV1,
  type CloudRelationshipV1,
  type CloudSheetV1,
} from "@share-mind-map/document-model";
import { validate as validateUuid, v5 as uuidv5 } from "uuid";

import { XMindError } from "./errors.js";
import { DEFAULT_XMIND_LIMITS } from "./limits.js";
import type { XMindDocumentIdentity, XMindInspection, XMindNode, XMindSheet } from "./types.js";

function structureInvalid(message: string): never {
  throw new XMindError("XMIND_STRUCTURE_INVALID", message);
}

function validateIdentity(identity: XMindDocumentIdentity) {
  if (
    !validateUuid(identity.documentId) ||
    !Number.isSafeInteger(identity.version) ||
    identity.version < 0
  ) {
    structureInvalid("The document identity must contain a UUID and non-negative integer version.");
  }
}

function stableId(sourceId: string, namespace: string, path: string): string {
  return validateUuid(sourceId) ? sourceId.toLowerCase() : uuidv5(path, namespace);
}

function validateSourceTree(sheet: XMindSheet) {
  const root = sheet.nodes[sheet.rootSourceId];
  if (root === undefined || root.parentSourceId !== null) {
    structureInvalid("Each XMind sheet must reference one root topic with no parent.");
  }
  const roots = Object.values(sheet.nodes).filter((node) => node.parentSourceId === null);
  if (roots.length !== 1 || roots[0]?.sourceId !== sheet.rootSourceId) {
    structureInvalid("Each XMind sheet must contain exactly one matching root topic.");
  }

  for (const [sourceKey, node] of Object.entries(sheet.nodes)) {
    if (sourceKey !== node.sourceId)
      structureInvalid("An XMind node map key does not match its ID.");
    if (new Set(node.childSourceIds).size !== node.childSourceIds.length) {
      structureInvalid("An XMind topic contains duplicate children.");
    }
    for (const childSourceId of node.childSourceIds) {
      const child = sheet.nodes[childSourceId];
      if (child === undefined || child.parentSourceId !== node.sourceId) {
        structureInvalid("An XMind parent and child link do not agree.");
      }
    }
    if (node.parentSourceId !== null) {
      const parent = sheet.nodes[node.parentSourceId];
      if (parent === undefined || !parent.childSourceIds.includes(node.sourceId)) {
        structureInvalid("An XMind child references a missing or inconsistent parent.");
      }
    }
  }
}

function canonicalImagePath(path: string, inspection: XMindInspection): string {
  if (
    path.includes("\0") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new XMindError("IMAGE_PATH_UNSAFE", "An XMind image path is unsafe.");
  }
  const canonical = posix.normalize(path.normalize("NFC"));
  if (canonical === "." || inspection.assets[canonical]?.mediaType.startsWith("image/") !== true) {
    throw new XMindError("IMAGE_PATH_UNSAFE", "An XMind image path is missing or unsupported.");
  }
  return canonical;
}

function convertNode(
  node: XMindNode,
  idBySource: ReadonlyMap<string, string>,
  inspection: XMindInspection,
  namespace: string,
): CloudNodeV1 {
  const id = idBySource.get(node.sourceId);
  if (id === undefined) return structureInvalid("An XMind node ID could not be resolved.");
  const parentId =
    node.parentSourceId === null
      ? null
      : (idBySource.get(node.parentSourceId) ??
        structureInvalid("An XMind parent ID could not be resolved."));
  const childIds = node.childSourceIds.map(
    (childSourceId) =>
      idBySource.get(childSourceId) ?? structureInvalid("An XMind child ID could not be resolved."),
  );
  const imagePath = node.imagePath === null ? null : canonicalImagePath(node.imagePath, inspection);
  return {
    id,
    parentId,
    childIds,
    title: node.title,
    priority: node.priority,
    notes: node.notes === null ? null : { format: "plain", text: node.notes },
    labels: [...node.labels],
    icons: [...node.icons],
    style: { ...node.style },
    imageAssetId: imagePath === null ? null : uuidv5(`asset/${imagePath}`, namespace),
    extensions: {
      ...structuredClone(node.extensions),
      ...(node.direction === undefined
        ? {}
        : { "share-mind-map.layout": { direction: node.direction } }),
    },
  };
}

function convertSheet(
  sheet: XMindSheet,
  sheetIndex: number,
  inspection: XMindInspection,
  namespace: string,
): CloudSheetV1 {
  validateSourceTree(sheet);
  const sheetPath = `sheet/${String(sheetIndex)}/${sheet.sourceId}`;
  const id = stableId(sheet.sourceId, namespace, sheetPath);
  const idBySource = new Map(
    Object.keys(sheet.nodes).map((sourceId) => [
      sourceId,
      stableId(sourceId, namespace, `${sheetPath}/node/${sourceId}`),
    ]),
  );
  const nodes = Object.fromEntries(
    Object.values(sheet.nodes).map((node) => {
      const converted = convertNode(node, idBySource, inspection, namespace);
      return [converted.id, converted];
    }),
  );
  const relationships: CloudRelationshipV1[] = sheet.relationships.map(
    (relationship, relationshipIndex) => {
      const sourceNodeId = idBySource.get(relationship.sourceNodeId);
      const targetNodeId = idBySource.get(relationship.targetNodeId);
      if (sourceNodeId === undefined || targetNodeId === undefined) {
        return structureInvalid("An XMind relationship endpoint is missing.");
      }
      return {
        id: stableId(
          relationship.sourceId,
          namespace,
          `${sheetPath}/relationship/${String(relationshipIndex)}/${relationship.sourceId}`,
        ),
        sourceNodeId,
        targetNodeId,
        title: relationship.title,
        style: relationship.style === null ? null : { ...relationship.style },
        extensions: structuredClone(relationship.extensions),
      };
    },
  );
  const rootNodeId = idBySource.get(sheet.rootSourceId);
  if (rootNodeId === undefined) return structureInvalid("The XMind root ID could not be resolved.");
  return {
    id,
    title: sheet.title,
    rootNodeId,
    nodes,
    relationships,
    extensions: structuredClone(sheet.extensions),
  };
}

export function convertXMindToCloudDocument(
  inspection: XMindInspection,
  identity: XMindDocumentIdentity,
): CloudDocumentV1 {
  validateIdentity(identity);
  const nodeCount = inspection.sheets.reduce(
    (total, sheet) => total + Object.keys(sheet.nodes).length,
    0,
  );
  if (nodeCount > DEFAULT_XMIND_LIMITS.maxNodes) {
    throw new DocumentModelError(
      "DOCUMENT_NODE_LIMIT_REACHED",
      "The XMind document exceeds the 20,000-node limit.",
      [
        {
          code: "DOCUMENT_NODE_LIMIT_REACHED",
          path: "sheets",
          message: "The XMind document exceeds the 20,000-node limit.",
        },
      ],
    );
  }
  const document: CloudDocumentV1 = {
    schemaVersion: 1,
    documentId: identity.documentId.toLowerCase(),
    version: identity.version,
    sheets: inspection.sheets.map((sheet, index) =>
      convertSheet(sheet, index, inspection, identity.documentId),
    ),
    extensions: { "xmind.format": inspection.format },
  };
  return parseCloudDocument(document);
}
