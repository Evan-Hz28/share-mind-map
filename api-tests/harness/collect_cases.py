"""静态扫描 testcases 目录，输出用例编目（NDJSON）。

不做 import，所以不会执行模块级代码、不会发网络请求。扫描结果只用于平台选择器；
真正执行仍然以 pytest 的收集结果为准，动态生成的用例不在静态清单里是预期行为。
"""

import ast
import json
import os
import sys


def _iter_test_files(base):
    for directory, subdirectories, files in os.walk(base):
        subdirectories[:] = sorted(
            name for name in subdirectories if not name.startswith(".") and name != "__pycache__"
        )
        for name in sorted(files):
            if not name.startswith(".") and name.startswith("test_") and name.endswith(".py"):
                yield os.path.join(directory, name)


def _is_test_class(node):
    if not isinstance(node, ast.ClassDef):
        return False
    if node.name.startswith("Test"):
        return True
    # unittest.TestCase 的子类不要求 Test 前缀，pytest 一样会收集。
    return any(
        isinstance(base, ast.Attribute) and base.attr == "TestCase"
        or isinstance(base, ast.Name) and base.id == "TestCase"
        for base in node.bases
    )


def _functions(nodes):
    return [
        node
        for node in nodes
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")
    ]


def _emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")


def collect(root):
    base = os.path.join(root, "testcases")
    if not os.path.isdir(base):
        print(f"没有找到测试目录: {base}", file=sys.stderr)
        return 1

    for absolute in _iter_test_files(base):
        relative = os.path.relpath(absolute, root).replace(os.sep, "/")
        file_name = os.path.basename(absolute)
        _emit(
            {
                "file_path": relative,
                "node_id": relative,
                "name": file_name,
                "kind": "file",
                "ordinal": 0,
            }
        )

        try:
            with open(absolute, encoding="utf-8") as source:
                module = ast.parse(source.read(), filename=relative)
        except (OSError, SyntaxError, UnicodeDecodeError) as error:
            # 文件本身还是可以选的，只是拿不到函数清单。
            print(f"跳过 {relative}: {error}", file=sys.stderr)
            continue

        entries = [("", node) for node in _functions(module.body)]
        for node in module.body:
            if _is_test_class(node):
                entries.extend((node.name, method) for method in _functions(node.body))
        entries.sort(key=lambda item: item[1].lineno)

        for ordinal, (class_name, node) in enumerate(entries, start=1):
            node_id = f"{relative}::{node.name}" if class_name == "" else f"{relative}::{class_name}::{node.name}"
            _emit(
                {
                    "file_path": relative,
                    "node_id": node_id,
                    "name": node.name,
                    "kind": "case",
                    "ordinal": ordinal,
                }
            )

    return 0


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    return collect(os.path.abspath(root))


if __name__ == "__main__":
    sys.exit(main())
