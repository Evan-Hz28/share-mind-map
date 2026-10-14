import { describe, expect, it } from "vitest";

import {
  DROP_MAX_DEPTH,
  collectDroppedFiles,
  collectPickedFiles,
  describeCollected,
  isIgnoredName,
  type CollectedFiles,
  type DroppedDataTransfer,
  type DroppedItem,
} from "../src/workspace/drop-collect.js";

/**
 * jsdom 里没有 DataTransfer / DataTransferItem / FileSystemEntry,
 * 只能造结构一致的假对象再断言。这也是 drop-collect 用结构化类型的原因。
 */
function xmind(name: string): File {
  return new File(["x"], name);
}

function fileEntry(file: File, fail = false): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (success: (file: File) => void, error?: (error: Error) => void): void => {
      if (fail) error?.(new Error("file is gone"));
      else success(file);
    },
  } as unknown as FileSystemFileEntry;
}

/**
 * 分页的目录条目。每次 createReader() 都返回一个**全新的** reader,
 * 光标也从头开始——真实的浏览器就是这样,所以「有没有复用同一个 reader」
 * 这件事能被这个假对象测出来。
 */
function dirEntry(
  name: string,
  children: FileSystemEntry[],
  options: { pageSize?: number; failOnRound?: number } = {},
): FileSystemDirectoryEntry {
  const pageSize = options.pageSize ?? 100;
  let cursor = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: (): FileSystemDirectoryReader => {
      cursor = 0;
      return {
        readEntries: (
          success: (entries: FileSystemEntry[]) => void,
          error?: (error: Error) => void,
        ): void => {
          if (options.failOnRound === cursor) {
            error?.(new Error("directory is gone"));
            return;
          }
          const page = children.slice(cursor, cursor + pageSize);
          cursor += page.length;
          success(page);
        },
      } as unknown as FileSystemDirectoryReader;
    },
  } as unknown as FileSystemDirectoryEntry;
}

function entryItem(entry: FileSystemEntry | null, file: File | null = null): DroppedItem {
  return { kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => file };
}

function transfer(items: DroppedItem[], files: File[] = []): DroppedDataTransfer {
  return { items, files };
}

function paths(result: CollectedFiles): string[] {
  return result.entries.map((entry) => entry.path);
}

describe("isIgnoredName", () => {
  it("认出隐藏文件和系统垃圾", () => {
    expect(isIgnoredName(".DS_Store")).toBe(true);
    expect(isIgnoredName("~$临时.xmind")).toBe(true);
    expect(isIgnoredName("__MACOSX")).toBe(true);
  });

  it("普通文件名不忽略", () => {
    expect(isIgnoredName("登录用例.xmind")).toBe(false);
    expect(isIgnoredName("_notes")).toBe(false);
  });
});

describe("collectDroppedFiles", () => {
  it("递归展开嵌套目录,并把结果按路径排序", () => {
    // 同一段路径里只混 ASCII 名字,免得断言依赖 ICU 对中英文的排序偏好。
    const tree = dirEntry("用例集", [
      fileEntry(xmind("b.xmind")),
      fileEntry(xmind("a.xmind")),
      dirEntry("sub", [fileEntry(xmind("c.xmind"))]),
    ]);

    return collectDroppedFiles(transfer([entryItem(tree)]), 100).then((result) => {
      expect(result.roots).toEqual(["用例集"]);
      expect(paths(result)).toEqual(["用例集/a.xmind", "用例集/b.xmind", "用例集/sub/c.xmind"]);
      expect(result.skipped).toEqual({
        notXmind: 0,
        ignored: 0,
        tooDeep: 0,
        overflow: 0,
        errored: 0,
      });
    });
  });

  it("readEntries 分页时必须复用同一个 reader 才能读全", async () => {
    // 每页 2 条、共 5 条:只有一路读到空数组才会拿到 5 个。
    const tree = dirEntry(
      "批量",
      [1, 2, 3, 4, 5].map((index) => fileEntry(xmind(`用例-${String(index)}.xmind`))),
      { pageSize: 2 },
    );

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 100);
    expect(paths(result)).toEqual([
      "批量/用例-1.xmind",
      "批量/用例-2.xmind",
      "批量/用例-3.xmind",
      "批量/用例-4.xmind",
      "批量/用例-5.xmind",
    ]);
    expect(result.skipped.errored).toBe(0);
  });

  it("单个文件读失败只记账,不会把整次拖拽挂死", async () => {
    const tree = dirEntry("用例集", [
      fileEntry(xmind("坏的.xmind"), true),
      fileEntry(xmind("好的.xmind")),
    ]);

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 100);
    expect(paths(result)).toEqual(["用例集/好的.xmind"]);
    expect(result.skipped.errored).toBe(1);
  });

  it("readEntries 报错时整次拖拽仍然返回,并计入 errored", async () => {
    const tree = dirEntry("用例集", [], { failOnRound: 0 });

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 100);
    expect(paths(result)).toEqual([]);
    expect(result.skipped.errored).toBe(1);
  });

  it("忽略隐藏文件和系统垃圾,__MACOSX 整个目录不下钻", async () => {
    const tree = dirEntry("用例集", [
      fileEntry(xmind(".DS_Store")),
      fileEntry(xmind("~$临时.xmind")),
      dirEntry("__MACOSX", [fileEntry(xmind("影子.xmind"))]),
      fileEntry(xmind("正常.xmind")),
    ]);

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 100);
    expect(paths(result)).toEqual(["用例集/正常.xmind"]);
    // 两个垃圾文件 + __MACOSX 目录本身(整棵子树都不下钻)。
    expect(result.skipped.ignored).toBe(3);
  });

  it("非 .xmind 只计数不报错", async () => {
    const tree = dirEntry("用例集", [
      fileEntry(xmind("readme.txt")),
      fileEntry(xmind("笔记.md")),
      fileEntry(xmind("真的.xmind")),
    ]);

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 100);
    expect(paths(result)).toEqual(["用例集/真的.xmind"]);
    expect(result.skipped.notXmind).toBe(2);
  });

  it("kind 是 string 的条目(选中的文本/URL)被跳过", async () => {
    const text: DroppedItem = {
      kind: "string",
      webkitGetAsEntry: () => null,
      getAsFile: () => null,
    };

    const result = await collectDroppedFiles(transfer([text]), 100);
    expect(result.entries).toEqual([]);
    expect(result.roots).toEqual([]);
  });

  it("没有 entry API 时退回 getAsFile,并当作直接拖进来的文件", async () => {
    const result = await collectDroppedFiles(
      transfer(
        [entryItem(null, xmind("散文件.xmind")), entryItem(null, xmind("说明.txt"))],
        [xmind("散文件.xmind")],
      ),
      100,
    );

    // 直接拖的文件不做扩展名过滤:说明.txt 也要变成一行,让行校验去标红。
    expect(paths(result)).toEqual(["散文件.xmind", "说明.txt"]);
    expect(result.entries.every((entry) => entry.direct)).toBe(true);
    expect(result.skipped.notXmind).toBe(0);
  });

  it("单独拖一个非 .xmind 文件仍然会变成一行(交给行校验报错)", async () => {
    const result = await collectDroppedFiles(
      transfer([entryItem(fileEntry(xmind("readme.txt")))]),
      100,
    );

    expect(paths(result)).toEqual(["readme.txt"]);
    expect(result.entries[0]?.direct).toBe(true);
  });

  it("连 item 都没有时用 dt.files 兜底", async () => {
    const result = await collectDroppedFiles(
      transfer([], [xmind("a.xmind"), xmind("b.xmind")]),
      100,
    );
    expect(paths(result)).toEqual(["a.xmind", "b.xmind"]);
  });

  it("超过深度上限的目录被跳过,浅一层正常", async () => {
    // DROP_MAX_DEPTH 层目录里放一个文件是可以的。
    let shallow: FileSystemEntry = fileEntry(xmind("深.xmind"));
    for (let level = 0; level < DROP_MAX_DEPTH - 1; level += 1) {
      shallow = dirEntry(`第${String(level)}层`, [shallow]);
    }
    const shallowResult = await collectDroppedFiles(transfer([entryItem(shallow)]), 100);
    expect(shallowResult.entries).toHaveLength(1);
    expect(shallowResult.skipped.tooDeep).toBe(0);

    let deep: FileSystemEntry = fileEntry(xmind("够不着.xmind"));
    for (let level = 0; level < DROP_MAX_DEPTH + 2; level += 1) {
      deep = dirEntry(`第${String(level)}层`, [deep]);
    }
    const deepResult = await collectDroppedFiles(transfer([entryItem(deep)]), 100);
    expect(deepResult.entries).toEqual([]);
    expect(deepResult.skipped.tooDeep).toBe(1);
  });

  it("超过本批剩余名额的部分计进 overflow,不会多给行", async () => {
    const tree = dirEntry(
      "用例集",
      [1, 2, 3, 4, 5].map((index) => fileEntry(xmind(`用例-${String(index)}.xmind`))),
    );

    const result = await collectDroppedFiles(transfer([entryItem(tree)]), 2);
    expect(paths(result)).toEqual(["用例集/用例-1.xmind", "用例集/用例-2.xmind"]);
    expect(result.skipped.overflow).toBe(3);
  });

  it("一次拖入多个根时 roots 会有多个", async () => {
    const result = await collectDroppedFiles(
      transfer([
        entryItem(dirEntry("dirA", [fileEntry(xmind("a.xmind"))])),
        entryItem(dirEntry("dirB", [fileEntry(xmind("b.xmind"))])),
        entryItem(null, xmind("solo.xmind")),
      ]),
      100,
    );

    expect(result.roots).toEqual(["dirA", "dirB", "solo.xmind"]);
    expect(paths(result)).toEqual(["dirA/a.xmind", "dirB/b.xmind", "solo.xmind"]);
  });
});

describe("collectPickedFiles", () => {
  function picked(name: string, relativePath: string): File {
    const file = new File(["x"], name);
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    return file;
  }

  it("普通多选(没有相对路径)退化成文件名,而且不过滤扩展名", () => {
    const result = collectPickedFiles([xmind("a.xmind"), new File(["x"], "b.txt")], 100);
    // 用户亲手挑的文件一律成行;b.txt 会由行校验显示成红色报错。
    expect(paths(result)).toEqual(["a.xmind", "b.txt"]);
    expect(result.roots).toEqual([]);
    expect(result.entries.every((entry) => entry.direct)).toBe(true);
  });

  it("目录选择用 webkitRelativePath 还原层次", () => {
    const result = collectPickedFiles(
      [
        picked("a.xmind", "用例集/a.xmind"),
        picked("c.xmind", "用例集/sub/c.xmind"),
        picked("readme.txt", "用例集/readme.txt"),
      ],
      100,
    );

    expect(paths(result)).toEqual(["用例集/a.xmind", "用例集/sub/c.xmind"]);
    expect(result.roots).toEqual(["用例集"]);
    expect(result.skipped.notXmind).toBe(1);
  });

  it("忽略名单在目录层也生效", () => {
    const result = collectPickedFiles(
      [
        picked("a.xmind", "用例集/.DS_Store"),
        picked("影子.xmind", "用例集/__MACOSX/影子.xmind"),
        picked("真.xmind", "用例集/真.xmind"),
      ],
      100,
    );

    expect(paths(result)).toEqual(["用例集/真.xmind"]);
    expect(result.skipped.ignored).toBe(2);
  });

  it("同样受本批剩余名额限制", () => {
    const result = collectPickedFiles(
      [1, 2, 3].map((index) =>
        picked(`用例${String(index)}.xmind`, `用例集/用例${String(index)}.xmind`),
      ),
      1,
    );

    expect(paths(result)).toEqual(["用例集/用例1.xmind"]);
    expect(result.skipped.overflow).toBe(2);
  });
});

describe("describeCollected", () => {
  const empty = {
    entries: [],
    roots: ["用例集"],
    skipped: { notXmind: 0, ignored: 0, tooDeep: 0, overflow: 0, errored: 0 },
  };

  it("什么都没发生时返回 null", () => {
    expect(describeCollected(empty, { added: 0, duplicate: 0, limit: 100 })).toBeNull();
  });

  it("把加入数、重复数和各类忽略数拼成一句话", () => {
    const summary = describeCollected(
      { ...empty, skipped: { ...empty.skipped, notXmind: 5, ignored: 1, errored: 1 } },
      { added: 32, duplicate: 2, limit: 100 },
    );
    expect(summary).toBe(
      "已加入 32 个文件，跳过 2 个重复选择，忽略 5 个非 .xmind 文件，忽略 1 个隐藏或系统文件，1 个文件读取失败。",
    );
  });

  it("被本批上限截断时补一句还有多少没进来", () => {
    const summary = describeCollected(
      { ...empty, skipped: { ...empty.skipped, overflow: 53 } },
      {
        added: 100,
        duplicate: 0,
        limit: 100,
      },
    );
    expect(summary).toBe("已加入 100 个文件。本批最多 100 个，另有 53 个未加入。");
  });
});
