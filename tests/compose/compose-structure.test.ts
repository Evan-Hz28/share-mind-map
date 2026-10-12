import { describe, expect, it } from "vitest";

import { composeConfig, dependencyCondition, hostBindings } from "./helpers.js";

const requiredServices = [
  "web",
  "api",
  "worker",
  "postgres",
  "redis",
  "minio",
  "minio-init",
  "mailpit",
] as const;

describe("production Compose structure", () => {
  it("defines the complete runtime and health boundaries", async () => {
    const config = await composeConfig();

    expect(Object.keys(config.services).sort()).toEqual([...requiredServices].sort());
    for (const service of ["web", "api", "worker", "postgres", "redis", "minio", "mailpit"]) {
      expect(config.services[service]?.healthcheck, `${service} healthcheck`).toBeDefined();
    }
    for (const service of ["web", "api", "worker"]) {
      expect(config.services[service]?.build, `${service} image build`).toBeDefined();
    }
  });

  it("keeps internal host ports on loopback and publishes only the web front door", async () => {
    const config = await composeConfig();

    for (const service of ["api", "worker", "postgres", "redis", "minio", "mailpit"]) {
      const bindings = hostBindings(config.services[service]);
      expect(bindings.length, `${service} published ports`).toBeGreaterThan(0);
      expect(bindings.every((binding) => binding.host_ip === "127.0.0.1")).toBe(true);
    }

    const webBindings = hostBindings(config.services.web);
    expect(webBindings.length, "web published ports").toBeGreaterThan(0);
    expect(webBindings.every((binding) => binding.host_ip === "0.0.0.0")).toBe(true);
  });

  it("health-gates application services and the bucket initializer", async () => {
    const config = await composeConfig();

    for (const dependency of ["postgres", "redis", "minio", "mailpit"]) {
      expect(dependencyCondition(config.services.api, dependency)).toBe("service_healthy");
    }
    for (const dependency of ["postgres", "redis", "minio"]) {
      expect(dependencyCondition(config.services.worker, dependency)).toBe("service_healthy");
    }
    expect(dependencyCondition(config.services.api, "minio-init")).toBe(
      "service_completed_successfully",
    );
    expect(dependencyCondition(config.services.worker, "minio-init")).toBe(
      "service_completed_successfully",
    );
    expect(dependencyCondition(config.services.web, "api")).toBe("service_healthy");
  });

  it("retains all persistent volumes and keeps the MinIO bucket private", async () => {
    const config = await composeConfig();

    expect(Object.keys(config.volumes ?? {}).sort()).toEqual(
      ["postgres-data", "redis-data", "minio-data", "mailpit-data"].sort(),
    );
    expect(config.services["minio-init"]?.entrypoint?.join("\n")).toContain(
      'mc anonymous set none "local/$${MINIO_BUCKET}"',
    );
    expect(config.services["minio-init"]?.healthcheck).toBeUndefined();
  });
});
