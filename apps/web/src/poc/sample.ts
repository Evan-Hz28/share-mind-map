import {
  parseCloudDocument,
  type CloudDocumentV1,
  type CloudNodeV1,
} from "@share-mind-map/document-model";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const SHEET_ID = "00000000-0000-4000-8000-000000000002";
const ROOT_ID = nodeId(0);
const BRANCHING_FACTOR = 4;

function nodeId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function createNode(index: number, parentId: string | null): CloudNodeV1 {
  return {
    id: nodeId(index),
    parentId,
    childIds: [],
    title: index === 0 ? "Canvas evaluation" : `Synthetic node ${String(index)}`,
    priority: index > 0 && index % 29 === 0 ? "P1" : null,
    notes:
      index > 0 && index % 31 === 0 ? { format: "plain", text: `Note ${String(index)}` } : null,
    labels: index > 0 && index % 17 === 0 ? [`Label ${String(index % 5)}`] : [],
    icons: index > 0 && index % 23 === 0 ? ["star"] : [],
    style:
      index > 0 && index % 19 === 0
        ? { textColor: "#15314b", backgroundColor: "#dceef8", fontWeight: 600 }
        : {},
    imageAssetId: null,
    extensions: {},
  };
}

export function sampleDocument(nodeCount: number): CloudDocumentV1 {
  if (!Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > 20_000) {
    throw new RangeError("nodeCount must be an integer from 1 through 20,000.");
  }

  const nodes: Record<string, CloudNodeV1> = {};
  for (let index = 0; index < nodeCount; index += 1) {
    const parentIndex = index === 0 ? null : Math.floor((index - 1) / BRANCHING_FACTOR);
    const parentId = parentIndex === null ? null : nodeId(parentIndex);
    const node = createNode(index, parentId);
    nodes[node.id] = node;
    if (parentId !== null) {
      const parent = nodes[parentId];
      if (parent === undefined) throw new Error("Sample generation lost a parent node.");
      parent.childIds.push(node.id);
    }
  }

  return parseCloudDocument({
    schemaVersion: 1,
    documentId: DOCUMENT_ID,
    version: 1,
    sheets: [
      {
        id: SHEET_ID,
        title: "Synthetic canvas evaluation",
        rootNodeId: ROOT_ID,
        nodes,
        relationships: [],
        extensions: { "share-mind-map": { synthetic: true, nodeCount } },
      },
    ],
    extensions: { "share-mind-map": { synthetic: true } },
  });
}
