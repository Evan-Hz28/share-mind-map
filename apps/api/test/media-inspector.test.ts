import { describe, expect, it } from "vitest";

import { inspectImage } from "../src/assets/media-inspector.js";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);
const jpeg1x1 = Buffer.from(
  "ffd8ffc0001108000100010301110002110003 1100 ffd9".replaceAll(" ", ""),
  "hex",
);
const webp1x1 = Buffer.alloc(30);
webp1x1.write("RIFF", 0, "ascii");
webp1x1.writeUInt32LE(22, 4);
webp1x1.write("WEBP", 8, "ascii");
webp1x1.write("VP8X", 12, "ascii");
webp1x1.writeUInt32LE(10, 16);

describe("inspectImage", () => {
  it.each([
    [png1x1, "image/png"],
    [jpeg1x1, "image/jpeg"],
    [webp1x1, "image/webp"],
  ])("accepts a valid %s image and reports dimensions", (bytes, mediaType) => {
    expect(inspectImage(bytes)).toMatchObject({ mediaType, width: 1, height: 1 });
  });

  it.each([
    [Buffer.from("<svg width=1 height=1></svg>"), "svg"],
    [Buffer.from("GIF89a"), "gif"],
    [Buffer.from("not an image"), "random bytes"],
    [png1x1.subarray(0, 20), "truncated png"],
    [jpeg1x1.subarray(0, 4), "truncated jpeg"],
    [webp1x1.subarray(0, 20), "truncated webp"],
  ])("rejects %s", (bytes) => {
    expect(() => inspectImage(bytes)).toThrow();
  });

  it("rejects zero dimensions and forged content types because it reads bytes", () => {
    const zeroWidth = Buffer.from(png1x1);
    zeroWidth.writeUInt32BE(0, 16);
    expect(() => inspectImage(zeroWidth)).toThrow();
  });
});
