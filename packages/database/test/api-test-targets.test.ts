import { describe, expect, it } from "vitest";

import {
  groupCollectionTargets,
  type ApiTestCollectionItemRecord,
} from "../src/repositories/api-test.repository.js";

function suiteItem(suiteId: string, path: string, position: number): ApiTestCollectionItemRecord {
  return {
    id: `item-suite-${suiteId}`,
    position,
    suiteId,
    suiteKey: suiteId,
    suiteName: suiteId,
    suitePath: path,
    suiteEnabled: true,
    caseId: null,
    caseNodeId: null,
    caseName: null,
    caseKind: null,
    caseEnabled: null,
    lastRunId: null,
    lastRunStatus: null,
    totalCount: 0,
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastRunAt: null,
  };
}

function caseItem(
  suiteId: string,
  path: string,
  caseId: string,
  nodeId: string,
  position: number,
  overrides: Partial<ApiTestCollectionItemRecord> = {},
): ApiTestCollectionItemRecord {
  return {
    ...suiteItem(suiteId, path, position),
    id: `item-case-${caseId}`,
    caseId,
    caseNodeId: nodeId,
    caseName: caseId,
    caseKind: "case",
    caseEnabled: true,
    ...overrides,
  };
}

describe("groupCollectionTargets", () => {
  it("groups cases by suite and keeps first-seen suite order", () => {
    const targets = groupCollectionTargets([
      caseItem("suite-b", "testcases/b", "case-b1", "testcases/b/test_a.py::test_a", 0),
      caseItem("suite-a", "testcases/a", "case-a1", "testcases/a/test_b.py::test_b", 1),
      caseItem("suite-b", "testcases/b", "case-b2", "testcases/b/test_a.py::test_c", 2),
    ]);

    expect(targets).toEqual([
      {
        suiteId: "suite-b",
        path: "testcases/b",
        nodeIds: ["testcases/b/test_a.py::test_a", "testcases/b/test_a.py::test_c"],
      },
      { suiteId: "suite-a", path: "testcases/a", nodeIds: ["testcases/a/test_b.py::test_b"] },
    ]);
  });

  it("lets a file item subsume the functions in that file", () => {
    const targets = groupCollectionTargets([
      caseItem("suite-a", "testcases/a", "case-a1", "testcases/a/test_b.py::test_b", 0),
      caseItem("suite-a", "testcases/a", "case-a2", "testcases/a/test_c.py::test_c", 1),
      caseItem("suite-a", "testcases/a", "file-a1", "testcases/a/test_b.py", 2, {
        caseKind: "file",
      }),
    ]);

    expect(targets).toEqual([
      {
        suiteId: "suite-a",
        path: "testcases/a",
        nodeIds: ["testcases/a/test_c.py::test_c", "testcases/a/test_b.py"],
      },
    ]);
  });

  it("lets a whole-suite item subsume the cases under it", () => {
    const targets = groupCollectionTargets([
      caseItem("suite-a", "testcases/a", "case-a1", "testcases/a/test_b.py::test_b", 0),
      suiteItem("suite-a", "testcases/a", 1),
    ]);

    expect(targets).toEqual([{ suiteId: "suite-a", path: "testcases/a", nodeIds: [] }]);
  });

  it("skips disabled suites and vanished cases", () => {
    const targets = groupCollectionTargets([
      caseItem("suite-a", "testcases/a", "case-a1", "testcases/a/test_b.py::test_b", 0, {
        caseEnabled: false,
      }),
      caseItem("suite-a", "testcases/a", "case-a2", "testcases/a/test_c.py::test_c", 1, {
        caseEnabled: null,
      }),
      suiteItem("suite-b", "testcases/b", 2),
      { ...suiteItem("suite-c", "testcases/c", 3), suiteEnabled: false },
    ]);

    expect(targets).toEqual([{ suiteId: "suite-b", path: "testcases/b", nodeIds: [] }]);
  });
});
