import type {
  CloudDocumentV1,
  CloudSheetV1,
  DocumentInvariantIssue,
  DocumentModelErrorCode,
} from "./types.js";

const MAX_DOCUMENT_NODES = 20_000;
const MAX_ISSUES = 100;

function addIssue(
  issues: DocumentInvariantIssue[],
  code: DocumentModelErrorCode,
  path: string,
  message: string,
) {
  if (issues.length < MAX_ISSUES) issues.push({ code, path, message });
}

export function countDocumentNodes(document: CloudDocumentV1): number {
  return document.sheets.reduce((total, sheet) => total + Object.keys(sheet.nodes).length, 0);
}

function validateTree(sheet: CloudSheetV1, sheetPath: string, issues: DocumentInvariantIssue[]) {
  const nodes = sheet.nodes;
  const roots = Object.values(nodes).filter((node) => node.parentId === null);
  if (
    roots.length !== 1 ||
    roots[0]?.id !== sheet.rootNodeId ||
    nodes[sheet.rootNodeId] === undefined
  ) {
    addIssue(
      issues,
      "DOCUMENT_ROOT_INVALID",
      `${sheetPath}.rootNodeId`,
      "A sheet must have exactly one reachable root matching rootNodeId.",
    );
  }

  for (const [nodeKey, node] of Object.entries(nodes)) {
    const nodePath = `${sheetPath}.nodes.${nodeKey}`;
    if (nodeKey !== node.id) {
      addIssue(
        issues,
        "DOCUMENT_NODE_ID_MISMATCH",
        `${nodePath}.id`,
        "A node map key must equal node.id.",
      );
    }

    if (new Set(node.childIds).size !== node.childIds.length) {
      addIssue(
        issues,
        "DOCUMENT_PARENT_CHILD_MISMATCH",
        `${nodePath}.childIds`,
        "A node cannot contain duplicate child IDs.",
      );
    }

    for (const childId of node.childIds) {
      const child = nodes[childId];
      if (child === undefined || child.parentId !== node.id) {
        addIssue(
          issues,
          "DOCUMENT_PARENT_CHILD_MISMATCH",
          `${nodePath}.childIds`,
          `Child ${childId} must exist and reference parent ${node.id}.`,
        );
      }
    }

    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      if (parent === undefined || !parent.childIds.includes(node.id)) {
        addIssue(
          issues,
          "DOCUMENT_PARENT_CHILD_MISMATCH",
          `${nodePath}.parentId`,
          `Parent ${node.parentId} must exist and reference child ${node.id}.`,
        );
      }
    }
  }

  const states = new Map<string, "visiting" | "visited">();
  const reportedCycles = new Set<string>();
  for (const startingNodeId of Object.keys(nodes)) {
    if (states.has(startingNodeId)) continue;

    const stack: { nodeId: string; nextChildIndex: number }[] = [
      { nodeId: startingNodeId, nextChildIndex: 0 },
    ];
    states.set(startingNodeId, "visiting");

    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame === undefined) break;
      const childIds = nodes[frame.nodeId]?.childIds ?? [];
      const childId = childIds[frame.nextChildIndex];
      if (childId === undefined) {
        states.set(frame.nodeId, "visited");
        stack.pop();
        continue;
      }
      frame.nextChildIndex += 1;
      if (nodes[childId] === undefined) continue;

      const childState = states.get(childId);
      if (childState === "visiting") {
        if (!reportedCycles.has(childId)) {
          reportedCycles.add(childId);
          addIssue(
            issues,
            "DOCUMENT_CYCLE",
            `${sheetPath}.nodes.${childId}`,
            `Node ${childId} participates in a cycle.`,
          );
        }
      } else if (childState === undefined) {
        states.set(childId, "visiting");
        stack.push({ nodeId: childId, nextChildIndex: 0 });
      }
    }
  }

  const reachable = new Set<string>();
  const pending = nodes[sheet.rootNodeId] === undefined ? [] : [sheet.rootNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const childId of nodes[nodeId]?.childIds ?? []) pending.push(childId);
  }
  for (const nodeId of Object.keys(nodes)) {
    if (!reachable.has(nodeId)) {
      addIssue(
        issues,
        "DOCUMENT_NODE_UNREACHABLE",
        `${sheetPath}.nodes.${nodeId}`,
        `Node ${nodeId} is not reachable from root ${sheet.rootNodeId}.`,
      );
    }
  }
}

export function validateDocumentInvariants(document: CloudDocumentV1): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const nodeCount = countDocumentNodes(document);
  if (nodeCount > MAX_DOCUMENT_NODES) {
    addIssue(
      issues,
      "DOCUMENT_NODE_LIMIT_REACHED",
      "sheets",
      `Document has ${String(nodeCount)} nodes; maximum is ${String(MAX_DOCUMENT_NODES)}.`,
    );
  }

  const sheetIds = new Set<string>();
  const nodeIds = new Set<string>();
  const relationshipIds = new Set<string>();

  document.sheets.forEach((sheet, sheetIndex) => {
    const sheetPath = `sheets.${String(sheetIndex)}`;
    if (sheetIds.has(sheet.id)) {
      addIssue(
        issues,
        "DOCUMENT_SHEET_ID_DUPLICATE",
        `${sheetPath}.id`,
        `Sheet ID ${sheet.id} is duplicated.`,
      );
    }
    sheetIds.add(sheet.id);

    for (const node of Object.values(sheet.nodes)) {
      if (nodeIds.has(node.id)) {
        addIssue(
          issues,
          "DOCUMENT_NODE_ID_DUPLICATE",
          `${sheetPath}.nodes.${node.id}`,
          `Node ID ${node.id} must be unique across sheets.`,
        );
      }
      nodeIds.add(node.id);
    }

    for (const [relationshipIndex, relationship] of sheet.relationships.entries()) {
      const relationshipPath = `${sheetPath}.relationships.${String(relationshipIndex)}`;
      if (relationshipIds.has(relationship.id)) {
        addIssue(
          issues,
          "RELATIONSHIP_ID_DUPLICATE",
          `${relationshipPath}.id`,
          `Relationship ID ${relationship.id} is duplicated.`,
        );
      }
      relationshipIds.add(relationship.id);
      if (sheet.nodes[relationship.sourceNodeId] === undefined) {
        addIssue(
          issues,
          "RELATIONSHIP_SOURCE_MISSING",
          `${relationshipPath}.sourceNodeId`,
          `Relationship source ${relationship.sourceNodeId} is missing.`,
        );
      }
      if (sheet.nodes[relationship.targetNodeId] === undefined) {
        addIssue(
          issues,
          "RELATIONSHIP_TARGET_MISSING",
          `${relationshipPath}.targetNodeId`,
          `Relationship target ${relationship.targetNodeId} is missing.`,
        );
      }
    }

    validateTree(sheet, sheetPath, issues);
  });

  return issues;
}
