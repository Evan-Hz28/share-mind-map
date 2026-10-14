import { describe, expect, it } from "vitest";

import {
  IMPORT_BATCH_MAX_FILES,
  IMPORT_FILE_MAX_BYTES,
  IMPORT_FILE_MAX_NAME_LENGTH,
  defaultImportNames,
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

describe("defaultImportNames", () => {
  it("不撞名时就是去掉扩展名的文件名", () => {
    expect(defaultImportNames(["用例集/登录用例.xmind", "用例集/退出用例.XMIND"])).toEqual([
      "登录用例",
      "退出用例",
    ]);
  });

  it("撞名时退到最短的唯一路径后缀", () => {
    expect(defaultImportNames(["子目录A/登录用例.xmind", "子目录B/登录用例.xmind"])).toEqual([
      "子目录A/登录用例",
      "子目录B/登录用例",
    ]);
  });

  it("只有真正撞名的那几行才带上后缀", () => {
    expect(defaultImportNames(["用例集/独立用例.xmind", "A/重复.xmind", "B/重复.xmind"])).toEqual([
      "独立用例",
      "A/重复",
      "B/重复",
    ]);
  });

  it("既有行(taken)也算占用,但既有行自己不会被改名", () => {
    // 只有新来的那一行退到路径后缀;taken 只是比较用的,函数不返回它。
    expect(defaultImportNames(["子目录/登录用例.xmind"], ["登录用例"])).toEqual([
      "子目录/登录用例",
    ]);
  });

  it("连完整路径都已被占用时退回文件名,交给行校验标红", () => {
    expect(defaultImportNames(["a/同名.xmind"], ["同名", "a/同名"])).toEqual(["同名"]);
  });

  it("同一批里两条完全相同的路径也能各自拿到唯一名字", () => {
    expect(defaultImportNames(["a/同名.xmind", "a/同名.xmind"])).toEqual(["a/同名", "同名"]);
  });

  it("后缀超过 100 字符时保留结尾", () => {
    const longDir = "目录".repeat(60);
    const [first, second] = defaultImportNames([
      `${longDir}A/共用名.xmind`,
      `${longDir}B/共用名.xmind`,
    ]);
    expect(first).toContain("A/共用名");
    expect(first).toHaveLength(IMPORT_FILE_MAX_NAME_LENGTH);
    expect(first?.startsWith(longDir)).toBe(false);
    expect(second).toContain("B/共用名");
  });

  it("只有大小写不同也算撞名", () => {
    expect(defaultImportNames(["A/LOGIN.xmind", "B/login.xmind"])).toEqual(["A/LOGIN", "B/login"]);
  });

  it("空白折叠后相同也算撞名", () => {
    expect(defaultImportNames(["A/登录 用例.xmind", "B/登录  用例.xmind"])).toEqual([
      "A/登录 用例",
      "B/登录  用例",
    ]);
  });

  it("结果是确定性的,而且和输入顺序无关", () => {
    // 两次调用的下标含义不同(输入顺序变了),所以按路径对齐之后再比。
    const byPath = (paths: string[]): Record<string, string> => {
      const names = defaultImportNames(paths);
      return Object.fromEntries(paths.map((path, index) => [path, names[index] ?? ""]));
    };
    const paths = ["B/x.xmind", "A/x.xmind", "c.xmind"];
    expect(byPath(paths)).toEqual(byPath([...paths].reverse()));
    expect(byPath(paths)).toEqual({ "B/x.xmind": "B/x", "A/x.xmind": "A/x", "c.xmind": "c" });
  });
});

describe("批量上限", () => {
  it("单批上限是 100", () => {
    expect(IMPORT_BATCH_MAX_FILES).toBe(100);
  });
});
