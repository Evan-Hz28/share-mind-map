/** worker 存报告时只保留日志尾部 8 KB，这个常量要和它保持一致。 */
const OUTPUT_LIMIT = 8 * 1024;

// 半截行最多这么长；再长就不像被截断的残片了。
const FRAGMENT_MAX_LENGTH = 12;

// pytest 自己的短行（进度点、E/F 标记、分隔线等）即使很短也不能丢。
const PYTEST_LINE =
  /^(?:[.EFsxXP]+|ERROR|ERRORS|FAILED|FAILURES|PASSED|SKIPPED|warnings summary|=.*|_.*|-.*)$/;

/**
 * 日志按尾部截断时可能从行中间切一刀，第一行只剩半截（例如 `ght`），展示出来没有意义。
 * 整段几乎顶满存储上限、首行又短得不像日志开头时，按半截行处理并丢掉。
 */
export function trimCutFragment(message: string): string {
  if (message.length < OUTPUT_LIMIT - 64) return message;
  const newline = message.indexOf("\n");
  if (newline === -1) return message;
  const first = message.slice(0, newline).trim();
  if (first === "" || first.length > FRAGMENT_MAX_LENGTH || /\s/.test(first)) return message;
  if (PYTEST_LINE.test(first)) return message;
  return message.slice(newline + 1);
}
