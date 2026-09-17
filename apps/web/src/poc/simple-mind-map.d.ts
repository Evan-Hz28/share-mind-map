declare module "simple-mind-map" {
  type SimpleNode = {
    data: Record<string, unknown> & { uid: string };
    children?: SimpleNode[];
  };

  type SimpleMindMapNode = {
    getData(key?: string): unknown;
  };

  type SimpleMindMapInstance = {
    setData(data: SimpleNode): void;
    setMode(mode: "readonly" | "edit"): void;
    execCommand(command: string, ...arguments_: unknown[]): void;
    getData(withConfig?: boolean): unknown;
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
    destroy(): void;
    renderer: {
      findNodeByUid(uid: string): SimpleMindMapNode | null | undefined;
      goTargetNode(node: string | SimpleMindMapNode, callback?: () => void): void;
      moveNodeToCenter(node: SimpleMindMapNode, resetScale?: boolean): void;
    };
    view: {
      getTransformData(): {
        state: { scale: number; x: number; y: number };
      };
      setScale(scale: number): void;
      translateXY(x: number, y: number): void;
    };
  };

  export default class SimpleMindMap {
    constructor(options: {
      el: HTMLElement;
      data: SimpleNode;
      readonly?: boolean;
      fit?: boolean;
      openPerformance?: boolean;
    });

    setData(data: SimpleNode): void;
    setMode(mode: "readonly" | "edit"): void;
    execCommand(command: string, ...arguments_: unknown[]): void;
    getData(withConfig?: boolean): unknown;
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
    destroy(): void;
    renderer: SimpleMindMapInstance["renderer"];
    view: SimpleMindMapInstance["view"];
  }
}
