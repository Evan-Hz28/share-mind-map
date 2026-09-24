import { render, screen } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import EditorSideRail from "../../src/editor/EditorSideRail.vue";

describe("EditorSideRail", () => {
  it("emits view commands and keeps unfinished panels unavailable", async () => {
    const user = userEvent.setup();
    const rendered = render(EditorSideRail);

    await user.click(screen.getByRole("button", { name: "思维导图" }));
    await user.click(screen.getByRole("button", { name: "全屏" }));
    await user.click(screen.getByRole("button", { name: "适应画布" }));
    await user.click(screen.getByRole("button", { name: "放大" }));
    await user.click(screen.getByRole("button", { name: "缩小" }));

    expect(rendered.emitted("selectPanel")).toEqual([["mind-map"]]);
    expect(rendered.emitted("fullscreen")).toHaveLength(1);
    expect(rendered.emitted("fitToView")).toHaveLength(1);
    expect(rendered.emitted("zoomIn")).toHaveLength(1);
    expect(rendered.emitted("zoomOut")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "大纲" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "样式" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "主题" })).toBeDisabled();
  });
});
