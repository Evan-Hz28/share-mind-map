/**
 * 把「拖进弹窗的东西」和「选中的目录」统一展开成一批待导入文件。
 *
 * 两条入口共用同一套展开结果,组件只负责把 entries 变成 importRows:
 * - 拖拽:走 DataTransferItem.webkitGetAsEntry(),需要自行递归目录。
 * - 目录选择:<input webkitdirectory>,浏览器只给一份扁平 File 列表,
 *   层次信息藏在 File.webkitRelativePath 里。
 *
 * **不要用 showDirectoryPicker / getAsFileSystemHandle**。线上是明文 HTTP,
 * 不是 secure context,那两个 API 在那个 origin 上根本不存在(和 crypto.randomUUID
 * 一样)。webkitGetAsEntry 和 webkitdirectory 在 HTTP 下可用,实测过。
 */

import { isXmindFileName } from "./import-validation.js";

/** 递归深度上限,纯粹是防御性的:正常用例库不可能有这么深。 */
export const DROP_MAX_DEPTH = 8;

/** readEntries 是分页的(一次最多 100 条),但要防住「永远不返回空数组」的病态实现。 */
const READ_ENTRIES_MAX_ROUNDS = 1000;

export interface DroppedItem {
  readonly kind: string;
  webkitGetAsEntry(): FileSystemEntry | null;
  getAsFile(): File | null;
}

/**
 * DataTransfer 的结构化子集,方便在 jsdom 里塞假对象做单测
 * (jsdom 没有 DataTransfer / DataTransferItem)。
 */
export interface DroppedDataTransfer {
  readonly items?: ArrayLike<DroppedItem> | undefined;
  readonly files?: ArrayLike<File> | undefined;
}

/** 展开出来的一个文件;path 是相对拖入根的完整路径,如 "用例集/子目录/a.xmind"。 */
export interface CollectedEntry {
  file: File;
  path: string;
  /**
   * 用户是不是直接点/拖的这个文件(而不是从目录里翻出来的)。
   *
   * 两者的宽容度不一样:目录里的东西可以静默忽略,用户亲手挑的那一个必须
   * 原样变成一行——扩展名不对就让它显示成红色报错行,而不是悄悄消失。
   */
  direct: boolean;
}

export interface SkippedCounts {
  /** 扩展名不是 .xmind。 */
  notXmind: number;
  /** 隐藏文件 / 系统垃圾文件(.DS_Store、__MACOSX、~$ 开头)。 */
  ignored: number;
  /** 目录层级超过 DROP_MAX_DEPTH。 */
  tooDeep: number;
  /** 本批已经满了,这些没进来。 */
  overflow: number;
  /** 单个条目的 file() / readEntries() 回调报错。 */
  errored: number;
}

export interface CollectedFiles {
  entries: CollectedEntry[];
  /** 拖入/选入的顶层名字,可能不止一个(一次拖两个文件夹 + 几个散文件)。 */
  roots: string[];
  skipped: SkippedCounts;
}

/**
 * macOS 打包和解压常见的一堆垃圾。目录层也要判,__MACOSX 整个目录都不用往下走。
 */
export function isIgnoredName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("~$") || name === "__MACOSX";
}

interface Collector {
  entries: CollectedEntry[];
  skipped: SkippedCounts;
  limit: number;
}

function createCollector(limit: number): Collector {
  return {
    entries: [],
    skipped: { notXmind: 0, ignored: 0, tooDeep: 0, overflow: 0, errored: 0 },
    limit: Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0,
  };
}

/** 目录 API 返回的顺序是乱的,统一按路径排一下,让结果稳定可预期。 */
function finish(collector: Collector, roots: string[]): CollectedFiles {
  collector.entries.sort((left, right) => left.path.localeCompare(right.path, "zh"));
  return { entries: collector.entries, roots, skipped: collector.skipped };
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // 必须同时给 error 回调:只给成功回调的话,目录在遍历中途被删掉会让 Promise 永远挂着,
  // 表现是整个拖拽静默失效。
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function acceptFile(
  collector: Collector,
  file: File,
  path: string,
  name: string,
  direct: boolean,
): void {
  // 目录里翻出来的:不是 .xmind 就当没看见,名额满了也只是记个数。
  // 用户亲手挑的:照单全收,让行校验去显示红色报错 / 让超量提示去提示。
  if (!direct && !isXmindFileName(name)) {
    collector.skipped.notXmind += 1;
    return;
  }
  if (!direct && collector.entries.length >= collector.limit) {
    collector.skipped.overflow += 1;
    return;
  }
  collector.entries.push({ file, path, direct });
}

async function acceptFileEntry(
  collector: Collector,
  entry: FileSystemFileEntry,
  path: string,
  direct: boolean,
): Promise<void> {
  // 扩展名和名额先判,免得为了一个必然被丢掉的条目去把 File 读出来。
  if (!direct && !isXmindFileName(entry.name)) {
    collector.skipped.notXmind += 1;
    return;
  }
  if (!direct && collector.entries.length >= collector.limit) {
    collector.skipped.overflow += 1;
    return;
  }
  let file: File;
  try {
    file = await readFile(entry);
  } catch {
    collector.skipped.errored += 1;
    return;
  }
  collector.entries.push({ file, path, direct });
}

async function walk(
  collector: Collector,
  entry: FileSystemEntry,
  path: string,
  depth: number,
  direct: boolean,
): Promise<void> {
  if (entry.isFile) {
    await acceptFileEntry(collector, entry as FileSystemFileEntry, path, direct);
    return;
  }
  if (!entry.isDirectory) return;
  if (depth >= DROP_MAX_DEPTH) {
    collector.skipped.tooDeep += 1;
    return;
  }
  // 复用同一个 reader:每次 createReader() 都是从头开始读,会读出重复项。
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (let round = 0; round < READ_ENTRIES_MAX_ROUNDS; round += 1) {
    let children: FileSystemEntry[];
    try {
      children = await readEntries(reader);
    } catch {
      collector.skipped.errored += 1;
      return;
    }
    if (children.length === 0) return;
    for (const child of children) {
      if (isIgnoredName(child.name)) {
        collector.skipped.ignored += 1;
        continue;
      }
      await walk(collector, child, `${path}/${child.name}`, depth + 1, false);
    }
  }
  collector.skipped.errored += 1;
}

/**
 * 展开一次拖拽。
 *
 * 必须在同步阶段就把 items / files 快照下来:DataTransfer 在事件处理器返回之后
 * 就失效了,第一个 await 之后再读只能读到空。
 */
export async function collectDroppedFiles(
  dataTransfer: DroppedDataTransfer,
  limit: number,
): Promise<CollectedFiles> {
  const rawItems = Array.from(dataTransfer.items ?? []);
  const rawFiles = Array.from(dataTransfer.files ?? []);
  const collector = createCollector(limit);
  const roots: string[] = [];
  const entries: FileSystemEntry[] = [];
  const looseFiles: File[] = [];

  for (const item of rawItems) {
    // kind === "string" 是拖进来的选中文本 / URL,不是「老浏览器」。
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry !== null) {
      entries.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file !== null) looseFiles.push(file);
  }

  if (entries.length === 0 && looseFiles.length === 0) {
    // 完全没有可用的 entry API(老浏览器):退回扁平的 dt.files,拿不到目录层次。
    // 这条路上拿到的一律当作用户直接拖的文件。
    for (const file of rawFiles) {
      roots.push(file.name);
      acceptFile(collector, file, file.name, file.name, true);
    }
    return finish(collector, roots);
  }

  for (const entry of entries) {
    roots.push(entry.name);
    if (isIgnoredName(entry.name)) {
      collector.skipped.ignored += 1;
      continue;
    }
    // 顶层条目是文件时就是「单独拖了一个文件」,当直接的;是目录才往下翻。
    await walk(collector, entry, entry.name, 0, entry.isFile);
  }
  for (const file of looseFiles) {
    roots.push(file.name);
    if (isIgnoredName(file.name)) {
      collector.skipped.ignored += 1;
      continue;
    }
    acceptFile(collector, file, file.name, file.name, true);
  }
  return finish(collector, roots);
}

/**
 * 展开 <input webkitdirectory> 的结果。
 *
 * 同步实现:组件在 @change 里要立刻把 input.files 消费掉,才能安全地清空原生控件。
 * 普通多选(非目录)时 webkitRelativePath 是空串,退化成 file.name。
 */
export function collectPickedFiles(list: ArrayLike<File>, limit: number): CollectedFiles {
  const collector = createCollector(limit);
  const roots: string[] = [];
  for (const file of Array.from(list)) {
    const relativePath = typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : "";
    const path = relativePath === "" ? file.name : relativePath;
    const segments = path.split("/").filter((segment) => segment !== "");
    // 目录名同样要过忽略名单:__MACOSX/xxx.xmind、.git/... 都不该进来。
    if (segments.slice(0, -1).some((segment) => isIgnoredName(segment))) {
      collector.skipped.ignored += 1;
      continue;
    }
    const base = segments.at(-1) ?? file.name;
    if (isIgnoredName(base)) {
      collector.skipped.ignored += 1;
      continue;
    }
    const root = segments.at(0);
    // 顶层目录名进 roots(普通多选没有顶层目录,roots 为空)。
    if (segments.length > 1 && root !== undefined && !roots.includes(root)) roots.push(root);
    // 有 webkitRelativePath 说明是从目录里来的;普通多选则是用户直接挑的。
    acceptFile(collector, file, segments.join("/"), base, relativePath === "");
  }
  return finish(collector, roots);
}

/** 一次展开的摘要文案;没有任何可说的返回 null。 */
export function describeCollected(
  result: CollectedFiles,
  counts: { added: number; duplicate: number; limit: number },
): string | null {
  const { skipped } = result;
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`已加入 ${String(counts.added)} 个文件`);
  if (counts.duplicate > 0) parts.push(`跳过 ${String(counts.duplicate)} 个重复选择`);
  if (skipped.notXmind > 0) parts.push(`忽略 ${String(skipped.notXmind)} 个非 .xmind 文件`);
  if (skipped.ignored > 0) parts.push(`忽略 ${String(skipped.ignored)} 个隐藏或系统文件`);
  if (skipped.tooDeep > 0) parts.push(`忽略 ${String(skipped.tooDeep)} 个层级过深的目录`);
  if (skipped.errored > 0) parts.push(`${String(skipped.errored)} 个文件读取失败`);
  if (parts.length === 0 && skipped.overflow === 0) return null;
  let summary = parts.length === 0 ? "" : `${parts.join("，")}。`;
  if (skipped.overflow > 0) {
    summary += `本批最多 ${String(counts.limit)} 个，另有 ${String(skipped.overflow)} 个未加入。`;
  }
  return summary;
}
