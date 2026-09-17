import type { CanvasCandidate, MindMapAdapter } from "../types.js";
import { JsMindAdapter } from "./jsmind.js";
import { MindElixirAdapter } from "./mind-elixir.js";
import { SimpleMindMapAdapter } from "./simple-mind-map.js";

export function createAdapter(candidate: CanvasCandidate, host: HTMLElement): MindMapAdapter {
  switch (candidate) {
    case "simple-mind-map":
      return new SimpleMindMapAdapter(host);
    case "mind-elixir":
      return new MindElixirAdapter(host);
    case "jsmind":
      return new JsMindAdapter(host);
  }
}
