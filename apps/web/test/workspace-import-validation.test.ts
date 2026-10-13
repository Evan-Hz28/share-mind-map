import { describe, expect, it } from "vitest";

import {
  IMPORT_FILE_MAX_BYTES,
  IMPORT_FILE_MAX_NAME_LENGTH,
  isXmindFileName,
  normalizeImportName,
  validateImportFile,
  validateImportName,
} from "../src/workspace/import-validation.js";

/** jsdom 里造不出真的 20 MiB 文件，直接覆盖 size 取值器。 */
function fileOfSize(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size, writable: true, configurable: true });
  return file;
}

describe("isXmindFileName", () => {
  it("接受 .xmind 且不区分大小写", () => {
    expect(isXmindFileName("a.xmind")).toBe(true);
    expect(isXmindFileName("a.XMIND")).toBe(true);
    expect(isXmindFileName("用例.XMind")).toBe(true);
  });

  it("拒绝其它扩展名和只有前缀的名字", () => {
    expect(isXmindFileName("a.xmind.txt")).toBe(false);
    expect(isXmindFileName("a.txt")).toBe(false);
    expect(isXmindFileName("xmind")).toBe(false);
    expect(isXmindFileName(".xmind")).toBe(true); // 服务端也是只看后缀
  });
});

describe("normalizeImportName", () => {
  it("对齐服务端：NFC → trim → 空白折叠 → 小写", () => {
    expect(normalizeImportName("  View  History \n 客户端 ")).toBe("view history 客户端");
    expect(normalizeImportName("A.xmind")).toBe(normalizeImportName("a.XMIND"));
  });

  it("NFC 归一化让分解式与预组合式相等", () => {
    expect(normalizeImportName("é")).toBe(normalizeImportName("é"));
  });

  it("空或超长返回 null（服务端这两种情况会 500）", () => {
    expect(normalizeImportName("   ")).toBeNull();
    expect(normalizeImportName("a".repeat(IMPORT_FILE_MAX_NAME_LENGTH + 1))).toBeNull();
    expect(normalizeImportName("a".repeat(IMPORT_FILE_MAX_NAME_LENGTH))).not.toBeNull();
  });
});

describe("validateImportName", () => {
  it("空名字报错", () => {
    expect(validateImportName("")).toBe("目标文档名不能为空。");
    expect(validateImportName("　")).toBe("目标文档名不能为空。");
  });

  it("超长名字报错并带上上限", () => {
    expect(validateImportName("a".repeat(101))).toContain("100");
  });

  it("正常名字没有问题", () => {
    expect(validateImportName("  用例库  ")).toBeNull();
  });
});

describe("validateImportFile", () => {
  it("扩展名不对被拦", () => {
    expect(validateImportFile(new File(["x"], "a.txt"))).toContain(".xmind");
  });

  it("超过 20 MiB 被拦，边界值放行", () => {
    expect(validateImportFile(fileOfSize("a.xmind", IMPORT_FILE_MAX_BYTES + 1))).toContain("20 MB");
    expect(validateImportFile(fileOfSize("a.xmind", IMPORT_FILE_MAX_BYTES))).toBeNull();
  });

  it("合法的 .xmind 没有问题", () => {
    expect(validateImportFile(new File(["x"], "a.xmind"))).toBeNull();
  });
});
