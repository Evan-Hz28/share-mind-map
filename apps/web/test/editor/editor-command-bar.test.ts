import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import EditorCommandBar from "../../src/editor/EditorCommandBar.vue";

describe("EditorCommandBar", () => {
  it("renders editor commands and emits the matching events", async () => {
    const user = userEvent.setup();
    const rendered = render(EditorCommandBar, {
      props: { canWrite: true, dirty: true, saving: false },
    });

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await user.click(screen.getByRole("button", { name: "重做" }));
    await user.click(screen.getByRole("button", { name: "添加子节点" }));
    await user.click(screen.getByRole("button", { name: "添加同级节点" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(screen.getByRole("button", { name: "导出 XMind" }));
    await user.click(screen.getByRole("button", { name: "全部展开" }));
    await user.click(screen.getByRole("button", { name: "全部收起" }));
    await user.click(screen.getByRole("button", { name: "适应画布" }));

    expect(rendered.emitted("undo")).toHaveLength(1);
    expect(rendered.emitted("redo")).toHaveLength(1);
    expect(rendered.emitted("addChild")).toHaveLength(1);
    expect(rendered.emitted("addSibling")).toHaveLength(1);
    expect(rendered.emitted("removeSelected")).toHaveLength(1);
    expect(rendered.emitted("save")).toHaveLength(1);
    expect(rendered.emitted("exportXMind")).toHaveLength(1);
    expect(rendered.emitted("allExpanded")).toEqual([[true], [false]]);
    expect(rendered.emitted("fitToView")).toHaveLength(1);
  });

  it("disables write commands for read-only users but keeps viewport commands available", () => {
    render(EditorCommandBar, {
      props: { canWrite: false, dirty: true, saving: false },
    });

    for (const name of ["撤销", "重做", "添加子节点", "添加同级节点", "删除", "保存"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "全部展开" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "全部收起" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "适应画布" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 XMind" })).toBeEnabled();
  });

  it("disables saving when the document is clean or already saving", async () => {
    const rendered = render(EditorCommandBar, {
      props: { canWrite: true, dirty: false, saving: false },
    });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    await rendered.rerender({ canWrite: true, dirty: true, saving: true });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
