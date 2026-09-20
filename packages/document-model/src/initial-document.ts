import type { CloudDocumentV1 } from "./types.js";
import { parseCloudDocument } from "./index.js";

function randomUUID(): string {
  if (globalThis.crypto?.randomUUID === undefined) {
    throw new Error("A Web Crypto implementation is required to create a document.");
  }
  return globalThis.crypto.randomUUID();
}

export function createInitialCloudDocument(documentId: string): CloudDocumentV1 {
  const sheetId = randomUUID();
  const rootNodeId = randomUUID();
  const document: CloudDocumentV1 = {
    schemaVersion: 1,
    documentId,
    version: 1,
    sheets: [
      {
        id: sheetId,
        title: "未命名画布",
        rootNodeId,
        nodes: {
          [rootNodeId]: {
            id: rootNodeId,
            parentId: null,
            childIds: [],
            title: "根节点",
            priority: null,
            notes: { format: "plain", text: "" },
            labels: [],
            icons: [],
            style: {},
            imageAssetId: null,
            extensions: {},
          },
        },
        relationships: [],
        extensions: {},
      },
    ],
    extensions: {},
  };
  return parseCloudDocument(document);
}
