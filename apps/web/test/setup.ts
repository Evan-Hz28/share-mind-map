import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/vue";
import { afterEach, vi } from "vitest";

class TestResizeObserver implements ResizeObserver {
  public disconnect(): void {}
  public observe(): void {}
  public unobserve(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;
HTMLElement.prototype.scrollIntoView = () => undefined;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    addListener: () => undefined,
    removeListener: () => undefined,
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
