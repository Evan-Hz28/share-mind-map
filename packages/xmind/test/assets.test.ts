import { describe, expect, it } from "vitest";

import { extractXMindAssets } from "../src/index.js";
import { fixturePath } from "./helpers.js";

describe("XMind assets", () => {
  it("extracts supported image bytes with a verified media type and hash", async () => {
    const assets = [];
    for await (const asset of extractXMindAssets(fixturePath("with-png.xmind"))) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ path: "resources/pixel.png", mediaType: "image/png" });
    expect(assets[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(assets[0]?.bytes.length).toBeGreaterThan(0);
  });
});
