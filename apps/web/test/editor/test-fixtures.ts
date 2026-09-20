import type { CloudDocumentV1 } from "@share-mind-map/document-model";

export function sampleDocument(): CloudDocumentV1 {
  const documentId = "00000000-0000-7000-8000-000000000101";
  const sheetId = "00000000-0000-7000-8000-000000000102";
  const nodeId = "00000000-0000-7000-8000-000000000103";
  return {
    schemaVersion: 1,
    documentId,
    version: 1,
    sheets: [
      {
        id: sheetId,
        title: "Sheet",
        rootNodeId: nodeId,
        nodes: {
          [nodeId]: {
            id: nodeId,
            parentId: null,
            childIds: [],
            title: "根节点",
            priority: null,
            notes: null,
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
}
