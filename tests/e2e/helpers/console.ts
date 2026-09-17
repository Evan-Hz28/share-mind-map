import { expect, type Page } from "@playwright/test";

export interface PageDiagnostics {
  assertClean(): void;
}

export interface ExpectedHttpError {
  method: string;
  path: string | RegExp;
  status: number;
}

export interface MonitorPageOptions {
  expectedHttpErrors?: ExpectedHttpError[];
}

function matchesPath(expected: string | RegExp, actual: string): boolean {
  return typeof expected === "string" ? expected === actual : expected.test(actual);
}

export function monitorPage(page: Page, options: MonitorPageOptions = {}): PageDiagnostics {
  const problems: string[] = [];
  const successfulRequests = new WeakSet<object>();
  const pendingHttpErrors = [...(options.expectedHttpErrors ?? [])];
  const expectedConsoleMessages = new Map<string, number>();

  const expectBrowserConsoleMessage = (status: number, statusText: string): void => {
    const message = `Failed to load resource: the server responded with a status of ${String(status)} (${statusText})`;
    expectedConsoleMessages.set(message, (expectedConsoleMessages.get(message) ?? 0) + 1);
  };

  page.on("response", (response) => {
    const request = response.request();
    if (response.ok()) successfulRequests.add(request);
    const path = new URL(request.url()).pathname;
    if (response.status() === 401 && request.method() === "GET" && path === "/api/v1/me") {
      expectBrowserConsoleMessage(response.status(), response.statusText());
      return;
    }
    const expectedIndex = pendingHttpErrors.findIndex(
      (expected) =>
        expected.status === response.status() &&
        expected.method === request.method() &&
        matchesPath(expected.path, path),
    );
    if (expectedIndex !== -1) {
      pendingHttpErrors.splice(expectedIndex, 1);
      expectBrowserConsoleMessage(response.status(), response.statusText());
    }
  });

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.type() === "error") {
        const expectedCount = expectedConsoleMessages.get(message.text()) ?? 0;
        if (expectedCount > 0) {
          expectedConsoleMessages.set(message.text(), expectedCount - 1);
          return;
        }
      }
      problems.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED" && successfulRequests.has(request)) {
      return;
    }
    problems.push(
      `requestfailed: ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  return {
    assertClean(): void {
      expect(problems).toEqual([]);
      expect(pendingHttpErrors).toEqual([]);
    },
  };
}
