import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";

import LockStatus from "../../src/editor/LockStatus.vue";

describe("LockStatus", () => {
  it("shows the public owner and end-edit action for an active lock", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { emitted } = render(LockStatus, {
      props: {
        state: "held",
        canEdit: true,
        mobile: false,
        lock: {
          occupied: true,
          editorDisplayName: "当前用户",
          expiresAt: "2026-09-20T12:00:00.000Z",
          generation: 2,
          ttlSeconds: 900,
        },
      },
    });

    expect(screen.getByText(/当前用户/)).toBeInTheDocument();
    screen.getByRole("button", { name: "结束编辑" }).click();
    expect(emitted("end")).toHaveLength(1);
  });

  it("offers recovery after a heartbeat loss and does not offer editing on mobile", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { emitted } = render(LockStatus, {
      props: {
        state: "lost",
        canEdit: true,
        mobile: false,
        lock: null,
      },
    });

    expect(screen.getByText("编辑锁已失效，当前修改已转为只读草稿。")).toBeInTheDocument();
    screen.getByRole("button", { name: "重新获取编辑锁" }).click();
    expect(emitted("begin")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "开始编辑" })).not.toBeInTheDocument();
  });
});
