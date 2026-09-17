import { render, screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChangePasswordView from "../src/auth/ChangePasswordView.vue";
import LoginView from "../src/auth/LoginView.vue";
import { useAuthStore } from "../src/auth/auth.store.js";
import { createAppRouter } from "../src/router.js";
import { apiError, jsonResponse, loginResponse, sessionResponse } from "./helpers.js";

function renderView(component: typeof LoginView) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({ state: "anonymous", session: null, csrfToken: null });
  const router = createAppRouter({ pinia, history: createMemoryHistory() });
  return { pinia, router, ...render(component, { global: { plugins: [pinia, router] } }) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("login view", () => {
  it.each([
    ["AUTH_INVALID_CREDENTIALS", 401, "账号或密码错误。"],
    ["RATE_LIMITED", 429, "登录尝试过于频繁，请稍后再试。"],
    ["DEPENDENCY_UNAVAILABLE", 503, "服务暂时不可用，请稍后再试。"],
  ] as const)("shows a safe %s failure", async (code, status, expected) => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(apiError(code, "unsafe upstream message", status)),
    );
    renderView(LoginView);

    await userEvent.type(screen.getByLabelText("登录名"), "reader.one");
    await userEvent.type(screen.getByLabelText("密码"), "Temporary-123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.queryByText("unsafe upstream message")).not.toBeInTheDocument();
  });

  it("shows loading and routes a temporary-password login to password change", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { router } = renderView(LoginView);

    await userEvent.type(screen.getByLabelText("登录名"), "reader.one");
    await userEvent.type(screen.getByLabelText("密码"), "Temporary-123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByRole("button", { name: "正在登录" })).toBeDisabled();

    resolveRequest?.(jsonResponse(loginResponse("reader", true), 201));
    await waitFor(() => {
      expect(router.currentRoute.value.path).toBe("/change-password");
    });
  });
});

describe("mandatory password change view", () => {
  it("validates confirmation without sending a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { pinia } = renderView(ChangePasswordView);
    const auth = useAuthStore(pinia);
    auth.$patch({
      state: "authenticated",
      session: sessionResponse("reader", true),
      csrfToken: "csrf",
    });

    await userEvent.type(screen.getByLabelText("当前密码"), "Temporary-123");
    await userEvent.type(screen.getByLabelText("新密码"), "Permanent-Password-123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "Different-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的新密码不一致。");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a safe current-password error", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(apiError("AUTH_CURRENT_PASSWORD_INVALID", "unsafe", 400)),
    );
    const { pinia } = renderView(ChangePasswordView);
    useAuthStore(pinia).$patch({
      state: "authenticated",
      session: sessionResponse("reader", true),
      csrfToken: "csrf",
    });

    await userEvent.type(screen.getByLabelText("当前密码"), "Wrong-Password-123");
    await userEvent.type(screen.getByLabelText("新密码"), "Permanent-Password-123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "Permanent-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前密码错误。");
  });

  it("clears authentication and requires login after a successful change", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
    const { pinia, router } = renderView(ChangePasswordView);
    useAuthStore(pinia).$patch({
      state: "authenticated",
      session: sessionResponse("reader", true),
      csrfToken: "csrf",
    });

    await userEvent.type(screen.getByLabelText("当前密码"), "Temporary-123");
    await userEvent.type(screen.getByLabelText("新密码"), "Permanent-Password-123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "Permanent-Password-123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => {
      expect(router.currentRoute.value.path).toBe("/login");
    });
    expect(useAuthStore(pinia).state).toBe("anonymous");
  });
});
