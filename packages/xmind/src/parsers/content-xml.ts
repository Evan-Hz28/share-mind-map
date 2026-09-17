import { XMLParser } from "fast-xml-parser";

import { XMindError } from "../errors.js";
import type { CompatibilityIssue, XMindNode, XMindRelationship, XMindSheet } from "../types.js";
import type { ParsedXMindContent } from "./content-json.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  maxNestedTags: 20_100,
});

function invalid(path: string): never {
  throw new XMindError("CONTENT_INVALID", `Invalid legacy XMind XML structure at ${path}.`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(path);
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  const valueRecord = record(value, path);
  const content = valueRecord["#text"];
  if (typeof content !== "string") return invalid(path);
  return content;
}

function requiredAttribute(value: Record<string, unknown>, name: string, path: string): string {
  const attribute = value[`@${name}`];
  if (typeof attribute !== "string" || attribute.length === 0) return invalid(`${path}.@${name}`);
  return attribute;
}

function attachedTopics(topic: Record<string, unknown>, path: string): Record<string, unknown>[] {
  if (topic.children === undefined) return [];
  const children = record(topic.children, `${path}.children`);
  const groups = array(children.topics).map((entry, index) =>
    record(entry, `${path}.children.topics[${String(index)}]`),
  );
  return groups.flatMap((group, groupIndex) => {
    const type = group["@type"];
    if (type !== undefined && type !== "attached") return [];
    return array(group.topic).map((entry, topicIndex) =>
      record(entry, `${path}.children.topics[${String(groupIndex)}].topic[${String(topicIndex)}]`),
    );
  });
}

function topicNotes(topic: Record<string, unknown>, path: string): string | null {
  if (topic.notes === undefined) return null;
  const notes = record(topic.notes, `${path}.notes`);
  return notes.plain === undefined ? null : text(notes.plain, `${path}.notes.plain`);
}

function topicLabels(topic: Record<string, unknown>, path: string): string[] {
  if (topic.labels === undefined) return [];
  const labels = record(topic.labels, `${path}.labels`);
  return array(labels.label).map((entry, index) =>
    text(entry, `${path}.labels.label[${String(index)}]`),
  );
}

function topicMarkers(
  topic: Record<string, unknown>,
  path: string,
): { priority: "P0" | "P1" | "P2" | null; icons: string[] } {
  if (topic.markerRefs === undefined) return { priority: null, icons: [] };
  const refs = record(topic.markerRefs, `${path}.marker-refs`);
  const markerIds = array(refs.markerRef).map((entry, index) =>
    requiredAttribute(
      record(entry, `${path}.marker-refs.marker-ref[${String(index)}]`),
      "marker-id",
      `${path}.marker-refs.marker-ref[${String(index)}]`,
    ),
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
  };
}

function parseNodes(root: Record<string, unknown>, sheetPath: string) {
  const nodes: Record<string, XMindNode> = {};
  const pending: {
    topic: Record<string, unknown>;
    parentSourceId: string | null;
    path: string;
  }[] = [{ topic: root, parentSourceId: null, path: `${sheetPath}.topic` }];

  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    const sourceId = requiredAttribute(item.topic, "id", item.path);
    if (nodes[sourceId] !== undefined) {
      throw new XMindError("XMIND_STRUCTURE_INVALID", "Legacy XMind topic IDs must be unique.");
    }
    const children = attachedTopics(item.topic, item.path);
    const childSourceIds = children.map((child, index) =>
      requiredAttribute(child, "id", `${item.path}.children[${String(index)}]`),
    );
    const markerData = topicMarkers(item.topic, item.path);
    const image =
      item.topic.image === undefined
        ? null
        : requiredAttribute(
            record(item.topic.image, `${item.path}.image`),
            "src",
            `${item.path}.image`,
          );
    nodes[sourceId] = {
      sourceId,
      parentSourceId: item.parentSourceId,
      childSourceIds,
      title: text(item.topic.title, `${item.path}.title`),
      priority: markerData.priority,
      notes: topicNotes(item.topic, item.path),
      labels: topicLabels(item.topic, item.path),
      icons: markerData.icons,
      style: {},
      imagePath: image?.startsWith("xap:") === true ? image.slice(4) : image,
      extensions: {},
    };
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({
          topic: child,
          parentSourceId: sourceId,
          path: `${item.path}.children[${String(index)}]`,
        });
      }
    }
  }
  return { rootSourceId: requiredAttribute(root, "id", `${sheetPath}.topic`), nodes };
}

function relationships(sheet: Record<string, unknown>, path: string): XMindRelationship[] {
  if (sheet.relationships === undefined) return [];
  const container = record(sheet.relationships, `${path}.relationships`);
  return array(container.relationship).map((entry, index) => {
    const relationshipPath = `${path}.relationships.relationship[${String(index)}]`;
    const relationship = record(entry, relationshipPath);
    return {
      sourceId: requiredAttribute(relationship, "id", relationshipPath),
      sourceNodeId: requiredAttribute(relationship, "end1", relationshipPath),
      targetNodeId: requiredAttribute(relationship, "end2", relationshipPath),
      title:
        relationship.title === undefined
          ? null
          : text(relationship.title, `${relationshipPath}.title`),
      style: null,
      extensions: {},
    };
  });
}

export function parseContentXml(content: Buffer): ParsedXMindContent {
  const xml = content.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new XMindError("XML_UNSAFE", "XML document types and entities are not accepted.");
  }

  let value: unknown;
  try {
    value = parser.parse(xml) as unknown;
  } catch {
    throw new XMindError("CONTENT_INVALID", "content.xml is not valid XML.");
  }
  const root = record(value, "content.xml");
  const contentRoot = record(root["xmap-content"], "content.xml.xmap-content");
  const sheetValues = array(contentRoot.sheet);
  if (sheetValues.length === 0) return invalid("content.xml.xmap-content.sheet");

  const compatibility: CompatibilityIssue[] = [
    {
      featurePath: "content.xml",
      disposition: "normalized",
      message: "Legacy XML was normalized into the canonical XMind intermediate model.",
    },
  ];
  const sheets = sheetValues.map((entry, index): XMindSheet => {
    const path = `sheets[${String(index)}]`;
    const sheet = record(entry, path);
    const rootTopic = record(sheet.topic, `${path}.topic`);
    const parsedNodes = parseNodes(rootTopic, path);
    return {
      sourceId: requiredAttribute(sheet, "id", path),
      title: text(sheet.title, `${path}.title`),
      rootSourceId: parsedNodes.rootSourceId,
      nodes: parsedNodes.nodes,
      relationships: relationships(sheet, path),
      extensions: {},
    };
  });
  return { sheets, compatibility };
}
