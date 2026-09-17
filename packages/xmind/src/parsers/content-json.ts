import type { JsonValue } from "@share-mind-map/document-model";
import { z } from "zod";

import { XMindError } from "../errors.js";
import type {
  CompatibilityIssue,
  XMindNode,
  XMindNodeStyle,
  XMindRelationship,
  XMindRelationshipStyle,
  XMindSheet,
} from "../types.js";

const topLevelSchema = z.array(z.record(z.string(), z.unknown())).min(1);
const knownTopicKeys = new Set([
  "id",
  "title",
  "children",
  "notes",
  "labels",
  "markers",
  "style",
  "image",
]);

export interface ParsedXMindContent {
  sheets: XMindSheet[];
  compatibility: CompatibilityIssue[];
}

function invalid(path: string): never {
  throw new XMindError("CONTENT_INVALID", `Invalid XMind JSON structure at ${path}.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(path);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) return invalid(path);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return invalid(path);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return invalid(path);
  }
  return [...value];
}

function records(value: unknown, path: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return invalid(path);
  return value.map((entry, index) => record(entry, `${path}[${String(index)}]`));
}

function asJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => asJsonValue(entry, `${path}[${String(index)}]`));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, asJsonValue(entry, `${path}.${key}`)]),
    );
  }
  return invalid(path);
}

function notes(topic: Record<string, unknown>, path: string): string | null {
  if (topic.notes === undefined) return null;
  const notesObject = record(topic.notes, `${path}.notes`);
  if (notesObject.plain === undefined) return null;
  const plain = record(notesObject.plain, `${path}.notes.plain`);
  return optionalString(plain.content, `${path}.notes.plain.content`) ?? null;
}

function markers(topic: Record<string, unknown>, path: string) {
  const markerIds = records(topic.markers, `${path}.markers`).map((marker, index) =>
    requiredString(marker.markerId, `${path}.markers[${String(index)}].markerId`),
  );
  const priorityMarker = markerIds.find((marker) => /^priority-[1-3]$/.test(marker));
  const priority =
    priorityMarker === "priority-1"
      ? "P0"
      : priorityMarker === "priority-2"
        ? "P1"
        : priorityMarker === "priority-3"
          ? "P2"
          : null;
  return {
    priority,
    icons: markerIds.filter((marker) => !marker.startsWith("priority-")),
  } as const;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nodeStyle(topic: Record<string, unknown>, path: string): XMindNodeStyle {
  if (topic.style === undefined) return {};
  const style = record(topic.style, `${path}.style`);
  const properties =
    style.properties === undefined ? style : record(style.properties, `${path}.style.properties`);
  const textColor = optionalString(properties["fo:color"], `${path}.style.fo:color`);
  const backgroundColor = optionalString(
    properties["fo:background-color"],
    `${path}.style.fo:background-color`,
  );
  const fontFamily = optionalString(properties["fo:font-family"], `${path}.style.fo:font-family`);
  const fontSize = parseNumber(properties["fo:font-size"]);
  const fontWeight = parseNumber(properties["fo:font-weight"]);
  return {
    ...(textColor === undefined ? {} : { textColor }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(fontWeight === undefined ? {} : { fontWeight }),
  };
}

function imagePath(topic: Record<string, unknown>, path: string): string | null {
  if (topic.image === undefined) return null;
  const image = record(topic.image, `${path}.image`);
  const source = requiredString(image.src, `${path}.image.src`);
  return source.startsWith("xap:") ? source.slice(4) : source;
}

function childTopics(topic: Record<string, unknown>, path: string): Record<string, unknown>[] {
  if (topic.children === undefined) return [];
  const children = record(topic.children, `${path}.children`);
  return records(children.attached, `${path}.children.attached`);
}

function unknownExtensions(
  topic: Record<string, unknown>,
  path: string,
  compatibility: CompatibilityIssue[],
): Record<string, JsonValue> {
  const unknown = Object.fromEntries(
    Object.entries(topic)
      .filter(([key]) => !knownTopicKeys.has(key))
      .map(([key, value]) => {
        compatibility.push({
          featurePath: `${path}.${key}`,
          disposition: "preserved",
          message: "Unknown safe XMind JSON data was preserved under xmind.unknown.",
        });
        return [key, asJsonValue(value, `${path}.${key}`)];
      }),
  );
  return Object.keys(unknown).length === 0 ? {} : { "xmind.unknown": unknown };
}

function parseNodes(
  rootTopic: Record<string, unknown>,
  sheetPath: string,
  compatibility: CompatibilityIssue[],
): { rootSourceId: string; nodes: Record<string, XMindNode> } {
  const nodes: Record<string, XMindNode> = {};
  const pending: {
    topic: Record<string, unknown>;
    parentSourceId: string | null;
    path: string;
  }[] = [{ topic: rootTopic, parentSourceId: null, path: `${sheetPath}.rootTopic` }];

  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    const sourceId = requiredString(item.topic.id, `${item.path}.id`);
    if (nodes[sourceId] !== undefined) {
      throw new XMindError("XMIND_STRUCTURE_INVALID", "XMind topic IDs must be unique per sheet.");
    }
    const children = childTopics(item.topic, item.path);
    const childSourceIds = children.map((child, index) =>
      requiredString(child.id, `${item.path}.children.attached[${String(index)}].id`),
    );
    const markerData = markers(item.topic, item.path);
    nodes[sourceId] = {
      sourceId,
      parentSourceId: item.parentSourceId,
      childSourceIds,
      title: optionalString(item.topic.title, `${item.path}.title`) ?? "",
      priority: markerData.priority,
      notes: notes(item.topic, item.path),
      labels: stringArray(item.topic.labels, `${item.path}.labels`),
      icons: markerData.icons,
      style: nodeStyle(item.topic, item.path),
      imagePath: imagePath(item.topic, item.path),
      extensions: unknownExtensions(item.topic, item.path, compatibility),
    };
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({
          topic: child,
          parentSourceId: sourceId,
          path: `${item.path}.children.attached[${String(index)}]`,
        });
      }
    }
  }

  return {
    rootSourceId: requiredString(rootTopic.id, `${sheetPath}.rootTopic.id`),
    nodes,
  };
}

function relationshipStyle(
  relationship: Record<string, unknown>,
  path: string,
): XMindRelationshipStyle | null {
  if (relationship.style === undefined) return null;
  const style = record(relationship.style, `${path}.style`);
  const properties =
    style.properties === undefined ? style : record(style.properties, `${path}.style.properties`);
  const color = optionalString(properties["line-color"], `${path}.style.line-color`);
  const width = parseNumber(properties["line-width"]);
  const rawPattern = optionalString(properties["line-pattern"], `${path}.style.line-pattern`);
  const pattern =
    rawPattern === "solid" || rawPattern === "dashed" || rawPattern === "dotted"
      ? rawPattern
      : undefined;
  return {
    ...(color === undefined ? {} : { color }),
    ...(width === undefined ? {} : { width }),
    ...(pattern === undefined ? {} : { pattern }),
  };
}

function parseRelationships(sheet: Record<string, unknown>, path: string): XMindRelationship[] {
  return records(sheet.relationships, `${path}.relationships`).map((relationship, index) => {
    const relationshipPath = `${path}.relationships[${String(index)}]`;
    return {
      sourceId: requiredString(relationship.id, `${relationshipPath}.id`),
      sourceNodeId: requiredString(relationship.end1Id, `${relationshipPath}.end1Id`),
      targetNodeId: requiredString(relationship.end2Id, `${relationshipPath}.end2Id`),
      title: optionalString(relationship.title, `${relationshipPath}.title`) ?? null,
      style: relationshipStyle(relationship, relationshipPath),
      extensions: {},
    };
  });
}

export function parseContentJson(content: Buffer): ParsedXMindContent {
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    throw new XMindError("CONTENT_INVALID", "content.json is not valid JSON.");
  }
  const parsed = topLevelSchema.safeParse(value);
  if (!parsed.success) throw new XMindError("CONTENT_INVALID", "content.json has no valid sheets.");

  const compatibility: CompatibilityIssue[] = [];
  const sheets = parsed.data.map((sheet, sheetIndex): XMindSheet => {
    const path = `sheets[${String(sheetIndex)}]`;
    const rootTopic = record(sheet.rootTopic, `${path}.rootTopic`);
    const parsedNodes = parseNodes(rootTopic, path, compatibility);
    return {
      sourceId: requiredString(sheet.id, `${path}.id`),
      title: optionalString(sheet.title, `${path}.title`) ?? "",
      rootSourceId: parsedNodes.rootSourceId,
      nodes: parsedNodes.nodes,
      relationships: parseRelationships(sheet, path),
      extensions: {},
    };
  });
  return { sheets, compatibility };
}
