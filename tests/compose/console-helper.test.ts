import { describe, expect, it } from "vitest";

import { monitorPage } from "../e2e/helpers/console.js";

type Handler = (...arguments_: never[]) => void;

class FakePage {
  private readonly handlers = new Map<string, Handler[]>();

  public on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  public emit(event: string, value: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(value as never);
  }
}

function request(path: string, method = "GET", failure = "net::ERR_ABORTED") {
  return {
    url: () => `http://127.0.0.1:8080${path}`,
    method: () => method,
    failure: () => ({ errorText: failure }),
  };
}

describe("browser diagnostics", () => {
  it("ignores Chromium network noise only when correlated with expected or successful responses", () => {
    const page = new FakePage();
    const diagnostics = monitorPage(page as never, {
      expectedHttpErrors: [{ method: "POST", path: "/api/v1/auth/login", status: 429 }],
    });
    const anonymousRequest = request("/api/v1/me");
    const successfulMutation = request("/api/v1/auth/password", "PUT");
    const rateLimitedLogin = request("/api/v1/auth/login", "POST");

    page.emit("response", {
      request: () => anonymousRequest,
      status: () => 401,
      statusText: () => "Unauthorized",
      ok: () => false,
    });
    page.emit("console", {
      type: () => "error",
      text: () =>
        "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    });
    page.emit("response", {
      request: () => successfulMutation,
      status: () => 204,
      statusText: () => "No Content",
      ok: () => true,
    });
    page.emit("requestfailed", successfulMutation);
    page.emit("response", {
      request: () => rateLimitedLogin,
      status: () => 429,
      statusText: () => "Too Many Requests",
      ok: () => false,
    });
    page.emit("console", {
      type: () => "error",
      text: () =>
        "Failed to load resource: the server responded with a status of 429 (Too Many Requests)",
    });

    expect(() => {
      diagnostics.assertClean();
    }).not.toThrow();
  });

  it("still rejects unexpected console output and transport failures", () => {
    const page = new FakePage();
    const diagnostics = monitorPage(page as never);

    page.emit("console", { type: () => "warning", text: () => "unexpected warning" });
    page.emit("requestfailed", request("/assets/app.js", "GET", "net::ERR_FAILED"));

    expect(() => {
      diagnostics.assertClean();
    }).toThrow();
  });
});
