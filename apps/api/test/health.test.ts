import { describe, expect, it, vi } from "vitest";

import {
  HealthService,
  type HealthChecks,
  type HealthComponent,
} from "../src/health/health.service.js";

function healthyChecks(): HealthChecks {
  return {
    postgres: vi.fn().mockResolvedValue(undefined),
    redis: vi.fn().mockResolvedValue(undefined),
    minio: vi.fn().mockResolvedValue(undefined),
    smtp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("health service", () => {
  it("reports liveness without calling dependencies", () => {
    const checks = healthyChecks();
    const service = new HealthService(checks);

    expect(service.liveness()).toEqual({ status: "ok" });
    expect(Object.values(checks).every((check) => !vi.mocked(check).mock.calls.length)).toBe(true);
  });

  it("reports safe component names when every dependency is ready", async () => {
    const service = new HealthService(healthyChecks());

    await expect(service.readiness()).resolves.toEqual({
      status: "ok",
      components: { postgres: "ok", redis: "ok", minio: "ok", smtp: "ok" },
    });
  });

  it.each<HealthComponent>(["postgres", "redis", "minio", "smtp"])(
    "reports only the %s component unavailable when its check fails",
    async (component) => {
      const checks = healthyChecks();
      checks[component] = vi
        .fn()
        .mockRejectedValue(new Error(`${component}://secret@private-host`));
      const service = new HealthService(checks);

      const result = await service.readiness();

      expect(result.status).toBe("unavailable");
      expect(result.components).toEqual({
        postgres: component === "postgres" ? "unavailable" : "ok",
        redis: component === "redis" ? "unavailable" : "ok",
        minio: component === "minio" ? "unavailable" : "ok",
        smtp: component === "smtp" ? "unavailable" : "ok",
      });
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(JSON.stringify(result)).not.toContain("private-host");
    },
  );

  it("bounds a stalled dependency", async () => {
    const checks = healthyChecks();
    checks.minio = vi.fn(() => new Promise<void>(() => undefined));
    const service = new HealthService(checks, 10);

    const result = await service.readiness();

    expect(result).toEqual({
      status: "unavailable",
      components: {
        postgres: "ok",
        redis: "ok",
        minio: "unavailable",
        smtp: "ok",
      },
    });
  });
});
