export const ids = {
  document: "00000000-0000-7000-8000-000000000001",
  sheet: "00000000-0000-7000-8000-000000000002",
  secondSheet: "00000000-0000-7000-8000-000000000003",
  root: "00000000-0000-7000-8000-000000000010",
  childA: "00000000-0000-7000-8000-000000000011",
  childB: "00000000-0000-7000-8000-000000000012",
  relation: "00000000-0000-7000-8000-000000000020",
  missing: "00000000-0000-7000-8000-000000000099",
} as const;

function node(
  id: string,
  parentId: string | null,
  childIds: string[],
  patch: Record<string, unknown> = {},
): CloudNodeV1 {
  const value: CloudNodeV1 = {
    id,
    parentId,
    childIds,
    title: id === ids.root ? "Root" : "Child",
    priority: null,
    notes: null,
    labels: [],
    icons: [],
    style: {},
    imageAssetId: null,
    extensions: {},
  };
  return Object.assign(value, patch);
}

export function validDocument(
  options: {
    childIds?: string[];
    nodePatch?: Record<string, unknown>;
  } = {},
): CloudDocumentV1 {
  const childIds = options.childIds ?? [ids.childA, ids.childB];
  return {
    schemaVersion: 1,
    documentId: ids.document,
    version: 0,
    sheets: [
      {
        id: ids.sheet,
        title: "Test cases",
        rootNodeId: ids.root,
        nodes: {
          [ids.root]: node(ids.root, null, childIds, options.nodePatch),
          [ids.childA]: node(ids.childA, ids.root, []),
          [ids.childB]: node(ids.childB, ids.root, []),
        },
        relationships: [
          {
            id: ids.relation,
            sourceNodeId: ids.childA,
            targetNodeId: ids.childB,
            title: null,
            style: null,
            extensions: {},
          },
        ],
        extensions: {},
      },
    ],
    extensions: {},
  };
}

export function getSheet(document: CloudDocumentV1): CloudSheetV1 {
  const sheet = document.sheets[0];
  if (sheet === undefined) throw new Error("Expected the test document to contain a sheet.");
  return sheet;
}

export function getNode(sheet: CloudSheetV1, id: string): CloudNodeV1 {
  const value = sheet.nodes[id];
  if (value === undefined) throw new Error(`Expected test node ${id}.`);
  return value;
}

export function cycleDocument() {
  const document = validDocument();
  const sheet = getSheet(document);
  getNode(sheet, ids.root).childIds = [];
  getNode(sheet, ids.childA).parentId = ids.childB;
  getNode(sheet, ids.childA).childIds = [ids.childB];
  getNode(sheet, ids.childB).parentId = ids.childA;
  getNode(sheet, ids.childB).childIds = [ids.childA];
  return document;
}

export function orphanDocument() {
  const document = validDocument();
  getNode(getSheet(document), ids.root).childIds = [ids.childA];
  return document;
}

export function brokenRelationshipDocument() {
  const document = validDocument();
  const relationship = getSheet(document).relationships[0];
  if (relationship === undefined) {
    throw new Error("Expected the test document to contain a relationship.");
  }
  relationship.targetNodeId = ids.missing;
  return document;
}

export function generatedDocument(nodeCount: number) {
  const document = validDocument();
  const sheet = getSheet(document);
  sheet.nodes = {
    [ids.root]: node(ids.root, null, []),
  };
  for (let index = 1; index < nodeCount; index += 1) {
    const id = `00000000-0000-7000-8000-${(100_000_000_000 + index).toString()}`;
    sheet.nodes[id] = node(id, ids.root, []);
    getNode(sheet, ids.root).childIds.push(id);
  }
  sheet.relationships = [];
  return document;
}

export function generatedChainDocument(nodeCount: number) {
  const document = validDocument();
  const sheet = getSheet(document);
  sheet.nodes = {
    [ids.root]: node(ids.root, null, []),
  };
  let parentId: string = ids.root;
  for (let index = 1; index < nodeCount; index += 1) {
    const id = `00000000-0000-7000-8000-${(200_000_000_000 + index).toString()}`;
    sheet.nodes[id] = node(id, parentId, []);
    getNode(sheet, parentId).childIds.push(id);
    parentId = id;
  }
  sheet.relationships = [];
  return document;
}
import type { CloudDocumentV1, CloudNodeV1, CloudSheetV1 } from "../src/types.js";
