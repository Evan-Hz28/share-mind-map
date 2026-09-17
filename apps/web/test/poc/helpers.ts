class TestIntersectionObserver implements IntersectionObserver {
  public readonly root = null;
  public readonly rootMargin = "0px";
  public readonly thresholds = [0];

  public disconnect(): void {}
  public observe(): void {}
  public takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  public unobserve(): void {}
}

function installBrowserLayoutStubs(): void {
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
  globalThis.IntersectionObserver = TestIntersectionObserver;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  HTMLElement.prototype.scrollTo = () => undefined;
  const svgPrototype = SVGElement.prototype as SVGElement & {
    getBBox?: () => DOMRect;
    getComputedTextLength?: () => number;
  };
  svgPrototype.getBBox = () => DOMRect.fromRect({ width: 120, height: 32 });
  svgPrototype.getComputedTextLength = () => 80;
  SVGElement.prototype.getBoundingClientRect = () => DOMRect.fromRect({ width: 120, height: 32 });
}

export function createCanvasHost(): HTMLDivElement {
  installBrowserLayoutStubs();
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 1_024 },
    clientHeight: { configurable: true, value: 768 },
    getBoundingClientRect: {
      configurable: true,
      value: () => DOMRect.fromRect({ width: 1_024, height: 768 }),
    },
  });
  host.style.width = "1024px";
  host.style.height = "768px";
  document.body.append(host);
  return host;
}
