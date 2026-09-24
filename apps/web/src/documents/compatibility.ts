import type { DocumentDetailDto } from "@share-mind-map/api-client";

export type CompatibilityStatus = DocumentDetailDto["compatibilityStatus"];

export interface CompatibilityMeta {
  label: string;
  description: string;
}

const COMPATIBILITY_META: Record<CompatibilityStatus, CompatibilityMeta> = {
  full: {
    label: "完全兼容",
    description: "导入内容与在线编辑器及导出格式完全兼容。",
  },
  partial: {
    label: "部分兼容",
    description: "部分内容已标准化或无法在线完整编辑，导出时可能存在差异。",
  },
  unsupported_online: {
    label: "不支持在线编辑",
    description: "该文档包含当前编辑器不支持在线编辑的内容，请保留原始 XMind 文件。",
  },
};

export function getCompatibilityMeta(
  status: CompatibilityStatus | null | undefined,
): CompatibilityMeta {
  return status === undefined || status === null
    ? { label: "未知", description: "暂未获取文档兼容性信息。" }
    : COMPATIBILITY_META[status];
}
