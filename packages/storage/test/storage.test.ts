import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { MinioObjectStorage } from "../src/index.js";

function storage(): MinioObjectStorage {
  return new MinioObjectStorage({
    endpoint: new URL("http://localhost:9000"),
    accessKey: "test",
    secretKey: "test",
    bucket: "bucket",
    useSsl: false,
  });
}

describe("MinioObjectStorage stream boundaries", () => {
  it("hashes and counts bytes while forwarding a stream", async () => {
    const objectStorage = storage();
    const received: Buffer[] = [];
    objectStorage.client.putObject = async (_bucket, _key, stream) => {
      for await (const chunk of stream as AsyncIterable<Buffer>) received.push(chunk);
      return { etag: "test" } as never;
    };
    const result = await objectStorage.putStream({
      objectKey: "tmp/test",
      stream: Readable.from([Buffer.from("hello"), Buffer.from(" world")]),
      mediaType: "application/xmind",
    });
    expect(Buffer.concat(received).toString()).toBe("hello world");
    expect(result.byteSize).toBe(11);
    expect(result.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("rejects an object as soon as the hard limit is crossed", async () => {
    const objectStorage = storage();
    objectStorage.client.putObject = async (_bucket, _key, stream) => {
      let byteCount = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) byteCount += chunk.byteLength;
      expect(byteCount).toBeGreaterThan(0);
      return { etag: "test" } as never;
    };
    await expect(
      objectStorage.putStream({
        objectKey: "tmp/too-large",
        stream: Readable.from([Buffer.from("123456")]),
        mediaType: "application/xmind",
        maxBytes: 5,
      }),
    ).rejects.toMatchObject({ name: "ObjectTooLargeError" });
  });
});
