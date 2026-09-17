export interface XMindLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxNodes: number;
  deadlineMs: number;
}

export const DEFAULT_XMIND_LIMITS: Readonly<XMindLimits> = Object.freeze({
  maxCompressedBytes: 20 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxNodes: 20_000,
  deadlineMs: 5 * 60 * 1_000,
});
