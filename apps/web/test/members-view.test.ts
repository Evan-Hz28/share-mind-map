import { render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MembersView from "../src/admin/MembersView.vue";
import { useAuthStore } from "../src/auth/auth.store.js";
import { apiError, jsonResponse, member, sessionResponse } from "./helpers.js";

function renderMembers() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({
    state: "authenticated",
    session: sessionResponse("admin"),
    csrfToken: "csrf",
  });
  return render(MembersView, { global: { plugins: [pinia] } });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("member administration", () => {
  it("renders loading, empty, and failure states", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const first = renderMembers();
    expect(screen.getByText("正在加载成员")).toBeInTheDocument();
    await waitFor(() => {
      expect(resolveRequest).toBeTypeOf("function");
    });
    resolveRequest?.(jsonResponse({ members: [] }));
    expect(await screen.findByText("暂无成员")).toBeInTheDocument();
    first.unmount();

    vi.stubGlobal("fetch", () =>
      Promise.resolve(apiError("DEPENDENCY_UNAVAILABLE", "unsafe", 503)),
    );
    renderMembers();
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时不可用，请稍后再试。");
  });

  it("creates a Reader, copies its one-time password, and forgets it on close", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", (request: Request) => {
      requests.push(request);
      if (request.method === "POST") {
        return Promise.resolve(
          jsonResponse({ member: member(), temporaryPassword: "Temporary-Reader-123" }, 201),
        );
      }
      return Promise.resolve(jsonResponse({ members: requests.length > 1 ? [member()] : [] }));
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderMembers();
    await screen.findByText("暂无成员");

    await userEvent.click(screen.getByRole("button", { name: "创建成员" }));
    await userEvent.type(screen.getByLabelText("登录名"), "reader.one");
    await userEvent.type(screen.getByLabelText("显示名称"), "Reader One");
    await userEvent.click(screen.getByRole("button", { name: "创建 Reader" }));

    expect(await screen.findByText("Temporary-Reader-123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "复制临时密码" }));
    expect(writeText).toHaveBeenCalledWith("Temporary-Reader-123");
    expect(screen.getByText("已复制")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("Temporary-Reader-123")).not.toBeInTheDocument();

    const createBody: unknown = JSON.parse(
      (await requests.find((request) => request.method === "POST")?.text()) ?? "{}",
    );
    expect(createBody).toEqual({ loginName: "reader.one", displayName: "Reader One" });
  });

  it("shows a reset password once and clears it on close", async () => {
    vi.stubGlobal("fetch", (request: Request) =>
      Promise.resolve(
        request.method === "GET"
          ? jsonResponse({ members: [member()] })
          : jsonResponse({ temporaryPassword: "Reset-Reader-Password-1" }, 201),
      ),
    );
    renderMembers();
    await screen.findByText("Reader One");

    await userEvent.click(screen.getByRole("button", { name: "打开 Reader One 的操作菜单" }));
    await userEvent.click(screen.getByRole("button", { name: "重置 Reader One 的密码" }));

    expect(await screen.findByText("Reset-Reader-Password-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("Reset-Reader-Password-1")).not.toBeInTheDocument();
  });

  it("confirms disable and revoke-all actions and refreshes the member list", async () => {
    const calls: string[] = [];
    let disabled = false;
    vi.stubGlobal("fetch", (request: Request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      if (request.method === "PATCH") {
        disabled = true;
        return Promise.resolve(jsonResponse(member({ accountStatus: "disabled" })));
      }
      if (request.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        jsonResponse({ members: [member({ accountStatus: disabled ? "disabled" : "active" })] }),
      );
    });
    renderMembers();
    await screen.findByText("Reader One");

    await userEvent.click(screen.getByRole("button", { name: "打开 Reader One 的操作菜单" }));
    await userEvent.click(screen.getByRole("button", { name: "禁用 Reader One" }));
    expect(screen.getByText("禁用后，该成员的全部会话将立即失效。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认禁用" }));
    expect(await screen.findByText("已禁用")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "打开 Reader One 的操作菜单" }));
    await userEvent.click(screen.getByRole("button", { name: "撤销 Reader One 的全部会话" }));
    await userEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => {
      expect(calls).toContain(
        "POST /api/v1/admin/members/00000000-0000-7000-8000-000000000011/sessions/revoke",
      );
    });
  });

  it("shows the final-Admin protection error", async () => {
    const administrator = member({ displayName: "Admin One", role: "admin" });
    vi.stubGlobal("fetch", (request: Request) =>
      Promise.resolve(
        request.method === "GET"
          ? jsonResponse({ members: [administrator] })
          : apiError("LAST_ACTIVE_ADMIN", "unsafe", 409),
      ),
    );
    renderMembers();
    await screen.findByText("Admin One");

    await userEvent.click(screen.getByRole("button", { name: "打开 Admin One 的操作菜单" }));
    await userEvent.click(screen.getByRole("button", { name: "禁用 Admin One" }));
    await userEvent.click(screen.getByRole("button", { name: "确认禁用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("必须保留至少一个有效管理员。");
  });
});
