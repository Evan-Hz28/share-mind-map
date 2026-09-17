import { z } from "zod";

const uuidSchema = z.uuid();
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const extensionKeySchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/);
const extensionsSchema = z.record(extensionKeySchema, z.json());

const nodeStyleSchema = z
  .object({
    textColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    fontFamily: z.string().min(1).max(100).optional(),
    fontSize: z.number().min(6).max(144).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
  })
  .strict();

const relationshipStyleSchema = z
  .object({
    color: colorSchema.optional(),
    width: z.number().positive().max(100).optional(),
    pattern: z.enum(["solid", "dashed", "dotted"]).optional(),
  })
  .strict();

export const cloudNodeV1Schema = z
  .object({
    id: uuidSchema,
    parentId: uuidSchema.nullable(),
    childIds: z.array(uuidSchema),
    title: z.string().max(20_000),
    priority: z.enum(["P0", "P1", "P2"]).nullable(),
    notes: z
      .object({ format: z.literal("plain"), text: z.string().max(1_000_000) })
      .strict()
      .nullable(),
    labels: z.array(z.string().max(255)).max(1_000),
    icons: z.array(z.string().max(255)).max(1_000),
    style: nodeStyleSchema,
    imageAssetId: uuidSchema.nullable(),
    extensions: extensionsSchema,
  })
  .strict();

export const cloudRelationshipV1Schema = z
  .object({
    id: uuidSchema,
    sourceNodeId: uuidSchema,
    targetNodeId: uuidSchema,
    title: z.string().max(20_000).nullable(),
    style: relationshipStyleSchema.nullable(),
    extensions: extensionsSchema,
  })
  .strict();

export const cloudSheetV1Schema = z
  .object({
    id: uuidSchema,
    title: z.string().max(20_000),
    rootNodeId: uuidSchema,
    nodes: z.record(uuidSchema, cloudNodeV1Schema),
    relationships: z.array(cloudRelationshipV1Schema),
    extensions: extensionsSchema,
  })
  .strict();

export const cloudDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: uuidSchema,
    version: z.number().int().nonnegative(),
    sheets: z.array(cloudSheetV1Schema).min(1).max(100),
    extensions: extensionsSchema,
  })
  .strict();
