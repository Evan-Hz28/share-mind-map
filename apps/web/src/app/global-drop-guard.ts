/**
 * 浏览器默认会把「拖到页面上的文件」当成导航:松手之后整个 SPA 被换成那个文件,
 * 编辑器里没保存的内容就没了。
 *
 * 这里只 preventDefault,绝不 stopPropagation——弹窗的 drop zone 和编辑器里
 * 图片控件自己的 drop 处理器都在更内层,照样能收到事件。
 */
export function installGlobalDropGuard(target: Window = window): void {
  const swallow = (event: DragEvent): void => {
    event.preventDefault();
  };
  target.addEventListener("dragover", swallow);
  target.addEventListener("drop", swallow);
}
