const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageInspection {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}

export class InvalidImageError extends Error {
  public constructor(message = "Image bytes are invalid or unsupported.") {
    super(message);
    this.name = "InvalidImageError";
  }
}

export class ImageTooLargeError extends Error {
  public constructor(public readonly maxBytes = MAX_IMAGE_BYTES) {
    super(`Image exceeds the ${String(maxBytes)}-byte limit.`);
    this.name = "ImageTooLargeError";
  }
}

export function inspectImage(bytes: Uint8Array): ImageInspection {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
  if (isPng(bytes)) return inspectPng(bytes);
  if (isJpeg(bytes)) return inspectJpeg(bytes);
  if (isWebp(bytes)) return inspectWebp(bytes);
  throw new InvalidImageError();
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP";
}

function inspectPng(bytes: Uint8Array): ImageInspection {
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = text(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new InvalidImageError("PNG chunk is truncated.");
    if (type === "IHDR") {
      if (length < 13) throw new InvalidImageError("PNG header is truncated.");
      width = readUint32BE(bytes, offset + 8);
      height = readUint32BE(bytes, offset + 12);
    }
    if (type === "IEND") {
      hasEnd = true;
      break;
    }
    offset = end;
  }
  if (!hasEnd || width === 0 || height === 0) throw new InvalidImageError("PNG is incomplete.");
  return { mediaType: "image/png", width, height };
}

function inspectJpeg(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new InvalidImageError("JPEG signature is invalid.");
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new InvalidImageError("JPEG marker is invalid.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) throw new InvalidImageError("JPEG marker is truncated.");
    if (marker === 0xd9) throw new InvalidImageError("JPEG dimensions are missing.");
    if (marker === 0xda) throw new InvalidImageError("JPEG dimensions are missing.");
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) throw new InvalidImageError("JPEG segment is truncated.");
    const length = readUint16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length)
      throw new InvalidImageError("JPEG segment is truncated.");
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) throw new InvalidImageError("JPEG frame header is truncated.");
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      if (width === 0 || height === 0) throw new InvalidImageError("JPEG dimensions are invalid.");
      return { mediaType: "image/jpeg", width, height };
    }
    offset += length;
  }
  throw new InvalidImageError("JPEG is incomplete.");
}

function inspectWebp(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 20 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WEBP")
    throw new InvalidImageError("WebP signature is invalid.");
  const riffSize = readUint32LE(bytes, 4);
  if (riffSize + 8 > bytes.length) throw new InvalidImageError("WebP is truncated.");
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = text(bytes, offset, 4);
    const size = readUint32LE(bytes, offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > bytes.length) throw new InvalidImageError("WebP chunk is truncated.");
    if (type === "VP8X" && size >= 10) {
      const width = readUint24LE(bytes, data + 4) + 1;
      const height = readUint24LE(bytes, data + 7) + 1;
      return { mediaType: "image/webp", width, height };
    }
    if (
      type === "VP8 " &&
      size >= 10 &&
      byte(bytes, data + 3) === 0x9d &&
      byte(bytes, data + 4) === 0x01 &&
      byte(bytes, data + 5) === 0x2a
    ) {
      const width = readUint16LE(bytes, data + 6) & 0x3fff;
      const height = readUint16LE(bytes, data + 8) & 0x3fff;
      if (width > 0 && height > 0) return { mediaType: "image/webp", width, height };
    }
    if (type === "VP8L" && size >= 5 && byte(bytes, data) === 0x2f) {
      const bits =
        byte(bytes, data + 1) |
        (byte(bytes, data + 2) << 8) |
        (byte(bytes, data + 3) << 16) |
        (byte(bytes, data + 4) << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      return { mediaType: "image/webp", width, height };
    }
    offset = data + size + (size % 2);
  }
  throw new InvalidImageError("WebP dimensions are missing.");
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (byte(bytes, offset) << 8) | byte(bytes, offset + 1);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    byte(bytes, offset) * 2 ** 24 +
    byte(bytes, offset + 1) * 2 ** 16 +
    byte(bytes, offset + 2) * 2 ** 8 +
    byte(bytes, offset + 3)
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8) | (byte(bytes, offset + 2) << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    byte(bytes, offset) +
    byte(bytes, offset + 1) * 2 ** 8 +
    byte(bytes, offset + 2) * 2 ** 16 +
    byte(bytes, offset + 3) * 2 ** 24
  );
}

function byte(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) throw new InvalidImageError("Image bytes are truncated.");
  return value;
}
