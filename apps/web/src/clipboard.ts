/**
 * `navigator.clipboard` 是 secure context 专属 API，明文 HTTP + 公网 IP 下它是 undefined，
 * 调用即抛 TypeError；这时退回到临时的 textarea + execCommand。
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文里没有 clipboard API（也可能只是权限被拒），继续走下面的兜底。
  }

  const host = document.createElement("textarea");
  host.value = text;
  host.setAttribute("readonly", "");
  host.style.position = "fixed";
  host.style.top = "-1000px";
  document.body.append(host);
  host.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- 非安全上下文没有替代方案。
    return document.execCommand("copy");
  } catch {
    // 个别环境（如 jsdom）没有实现 execCommand，复制失败即可，别让异常冒到调用方。
    return false;
  } finally {
    host.remove();
  }
}
