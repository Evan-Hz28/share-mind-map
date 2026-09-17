import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../src/auth/auth.store.js";
import { apiError, jsonResponse, loginResponse, sessionResponse } from "./helpers.js";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("authentication store", () => {
  it("keeps session and CSRF state in memory only and preserves password whitespace", async () => {
    let request: Request | undefined;
    vi.stubGlobal("fetch", (value: Request) => {
      request = value;
      return Promise.resolve(jsonResponse(loginResponse("reader", true), 201));
    });
    const store = useAuthStore();

    expect(await store.login({ loginName: "reader.one", password: "  Temporary-123  " })).toBe(
      true,
    );

    expect(store.state).toBe("authenticated");
    expect(store.mustChangePassword).toBe(true);
    expect(store.csrfToken).toBe("csrf-from-login");
    expect(JSON.parse((await request?.text()) ?? "{}")).toEqual({
      loginName: "reader.one",
      password: "  Temporary-123  ",
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("treats an initial 401 as anonymous and an established-session 401 as expired", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(apiError("AUTH_REQUIRED", "请先登录。", 401)));
    const store = useAuthStore();

    await store.bootstrap();
    expect(store.state).toBe("anonymous");

    store.$patch({ state: "authenticated", session: sessionResponse(), csrfToken: "csrf" });
    await store.refreshSession();
    expect(store.state).toBe("expired");
    expect(store.session).toBeNull();
    expect(store.csrfToken).toBeNull();
  });

  it("clears all in-memory authentication after a successful password change", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
    const store = useAuthStore();
    store.$patch({
      state: "authenticated",
      session: sessionResponse("admin", true),
      csrfToken: "csrf",
    });

    expect(
      await store.changePassword({
        currentPassword: "Temporary-123",
        newPassword: "Permanent-Password-123",
      }),
    ).toBe(true);
    expect(store.state).toBe("anonymous");
    expect(store.session).toBeNull();
    expect(store.csrfToken).toBeNull();
  });
});
