import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverSuites,
  suiteForNode,
  suiteKey,
  type DiscoveredSuite,
} from "../src/api-test/sync.js";

const created: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "api-test-sync-"));
  created.push(root);
  return root;
}

async function touchTests(root: string, path: string, files: string[]): Promise<void> {
  await mkdir(join(root, path), { recursive: true });
  for (const file of files) {
    await writeFile(join(root, path, file), "def test_ok():\n    assert True\n", "utf8");
  }
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("api test repository discovery", () => {
  it("treats every top-level directory under testcases as one suite", async () => {
    const root = await workspace();
    await touchTests(root, "testcases/kaka", ["test_a.py", "test_b.py"]);
    await touchTests(root, "testcases/checkout/preorder", ["test_c.py"]);
    await touchTests(root, "testcases/基础", ["test_health.py"]);
    // 只有 __init__.py 的目录不构成套件
    await touchTests(root, "testcases/empty", ["__init__.py"]);

    const found: DiscoveredSuite[] = [];
    await discoverSuites(root, found);

    expect(found.map((suite) => suite.path).sort()).toEqual([
      "testcases/checkout",
      "testcases/kaka",
      "testcases/基础",
    ]);
    // 名字就是目录名，子目录不再拼进名字
    expect(found.find((suite) => suite.path === "testcases/checkout")?.name).toBe("checkout");
  });

  it("skips caches and hidden directories", async () => {
    const root = await workspace();
    await touchTests(root, "testcases/kaka", ["test_a.py"]);
    await touchTests(root, "testcases/__pycache__", ["test_cached.py"]);
    await touchTests(root, "testcases/.hidden", ["test_secret.py"]);

    const found: DiscoveredSuite[] = [];
    await discoverSuites(root, found);

    expect(found.map((suite) => suite.path)).toEqual(["testcases/kaka"]);
  });

  it("attaches each node id to the longest matching suite", () => {
    const suites = [
      { path: "testcases/checkout" },
      { path: "testcases/checkout/preorder" },
      { path: "testcases/kaka" },
    ];

    expect(suiteForNode("testcases/checkout/test_order.py", suites)?.path).toBe(
      "testcases/checkout",
    );
    // 子目录 fixture 文件不能误挂到外层套件。
    expect(
      suiteForNode("testcases/checkout/preorder/test_preorder.py::TestPay::test_ok", suites)?.path,
    ).toBe("testcases/checkout/preorder");
    // 前缀相同但不是子目录的不算匹配。
    expect(suiteForNode("testcases/checkout2/test_x.py", suites)).toBeNull();
  });

  it("builds a stable key that survives non-ascii paths", () => {
    const key = suiteKey("testcases/基础");
    expect(key).toBe(suiteKey("testcases/基础"));
    // 中文段会被剥掉，只留 ascii 前缀，靠摘要后缀保证跨路径唯一
    expect(key).toMatch(/^testcases-[0-9a-f]{6}$/);
    expect(suiteKey("testcases/checkout/preorder")).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(suiteKey("testcases/checkout/preorder").length).toBeLessThanOrEqual(56);
  });
});
