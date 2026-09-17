import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { ApiError } from "../../platform/errors/api-error.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const digestPattern = /^[0-9a-f]{64}$/;

export interface IssuedCsrf {
  value: string;
  digest: string;
}

export class CsrfService {
  public issue(): IssuedCsrf {
    const value = randomBytes(32).toString("base64url");
    return { value, digest: this.digest(value) };
  }

  public digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  public verify(value: string, expectedDigest: string): boolean {
    if (!digestPattern.test(expectedDigest)) return false;
    const actual = Buffer.from(this.digest(value), "hex");
    const expected = Buffer.from(expectedDigest, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  public assertRequest(method: string, value: string | undefined, expectedDigest: string): void {
    if (safeMethods.has(method.toUpperCase())) return;
    if (value === undefined || !this.verify(value, expectedDigest)) {
      throw new ApiError("CSRF_INVALID");
    }
  }
}
