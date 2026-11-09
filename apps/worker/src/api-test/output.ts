/** 报告里最多保留这么多字符的 pytest 输出。 */
export const OUTPUT_LIMIT = 8 * 1024;

/** 先多留一截，最后再按行裁到 OUTPUT_LIMIT，避免反复截断丢行首。 */
export const OUTPUT_HOLD = 64 * 1024;

/**
 * 截到 limit 个字符，并把截断点推到行首。
 * 直接从尾部切会从行中间下刀，第一行只剩半截（例如 `ght`），展示出来没有意义。
 */
export function clipTail(text: string, limit: number = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  const tail = text.slice(-limit);
  const newline = tail.indexOf("\n");
  return newline === -1 ? tail : tail.slice(newline + 1);
}
